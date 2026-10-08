//! Streaming ownership evidence, bounded disk shards and conservative subset recovery.
use super::*;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read, Write},
    time::{Duration, Instant},
};
const SHARDS: usize = 64;
const SHARD_ENTRIES: usize = 8192;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Manifest {
    pub version: u32,
    pub directory: String,
    pub digest: String,
    pub entry_count: u64,
    pub content_bytes: u64,
    pub root_identity: String,
    pub roots: Vec<String>,
    pub shards: Vec<String>,
}
#[derive(Clone, Copy)]
pub(super) struct Budgets {
    pub bytes: u64,
    pub entries: u64,
    pub manifest: u64,
    pub time: Duration,
}
impl Default for Budgets {
    fn default() -> Self {
        Self {
            bytes: 32 * 1024 * 1024 * 1024,
            entries: 500_000,
            manifest: 128 * 1024 * 1024,
            time: Duration::from_secs(600),
        }
    }
}
struct Budget {
    limits: Budgets,
    bytes: u64,
    entries: u64,
    manifest: u64,
    start: Instant,
}
impl Budget {
    fn check(&self, path: &Path) -> Result<(), String> {
        let kind = if self.bytes > self.limits.bytes {
            Some("content_bytes")
        } else if self.entries > self.limits.entries {
            Some("entries")
        } else if self.manifest > self.limits.manifest {
            Some("manifest_bytes")
        } else if self.start.elapsed() > self.limits.time {
            Some("time")
        } else {
            None
        };
        if let Some(kind) = kind {
            return Err(format!(
                "finish_artifact_budget: {kind}: {}",
                path.display()
            ));
        }
        Ok(())
    }
}
fn artifact_path(ctx: &Context, input: &str) -> Result<PathBuf, String> {
    let plain = local_path_from_input(input);
    let root = local_path_from_input(&path_to_git_arg(&ctx.target));
    let rel = plain
        .strip_prefix(&root)
        .map_err(|_| "finish_artifact_path")?;
    let rel = rel
        .to_str()
        .ok_or("finish_non_utf8_path")?
        .replace('\\', "/");
    if !safe_relative(&rel) {
        return Err("finish_artifact_path".into());
    }
    Ok(ctx.target.join(rel))
}
fn shard(path: &str) -> usize {
    Sha256::digest(path.as_bytes())[0] as usize % SHARDS
}
fn relative(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|_| "finish_artifact_path")?
        .to_str()
        .ok_or("finish_non_utf8_path")?
        .replace('\\', "/"))
}
fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && !Path::new(path).is_absolute()
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != ".." && p != ".git")
}
fn io_error(e: std::io::Error) -> String {
    format!("finish_artifact_io: {e}")
}
fn hash_file(path: &Path, budget: &mut Budget) -> Result<String, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let identity = receipt::entry_identity(path)?;
    let mut file = options.open(path).map_err(io_error)?;
    let before = file.metadata().map_err(io_error)?;
    if receipt::unsafe_link(&before) || !before.is_file() {
        return Err("finish_artifact_changed".into());
    }
    // Metadata is a pre-read rejection only, never charged again to the content budget.
    if before.len() > budget.limits.bytes.saturating_sub(budget.bytes) {
        return Err(format!(
            "finish_artifact_budget: content_bytes: {}",
            path.display()
        ));
    }
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    let mut read = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(io_error)?;
        if n == 0 {
            break;
        }
        read += n as u64;
        budget.bytes += n as u64;
        budget.check(path)?;
        hash.update(&buf[..n]);
    }
    if read != before.len() || file.metadata().map_err(io_error)?.len() != read {
        return Err("finish_artifact_changed".into());
    }
    if identity != receipt::entry_identity(path)? {
        return Err("finish_artifact_changed".into());
    }
    Ok(format!("file:{}:{:x}", identity, hash.finalize()))
}
fn entry_value(path: &Path, budget: &mut Budget) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if receipt::unsafe_link(&meta) {
        // Read the link itself, never open/traverse its target (including junctions).
        let target = fs::read_link(path).map_err(io_error)?;
        let target = target.to_str().ok_or("finish_non_utf8_path")?;
        return Ok(format!(
            "link:{}:{:x}",
            receipt::entry_identity(path)?,
            Sha256::digest(target.as_bytes())
        ));
    }
    if meta.is_dir() {
        return Ok(format!("dir:{}", receipt::root_identity(path)?));
    }
    if meta.is_file() {
        return hash_file(path, budget);
    }
    Err("finish_artifact_unsupported_entry".into())
}
fn walk<F>(path: &Path, depth: usize, visit: &mut F) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    if depth > 128 {
        return Err("finish_artifact_depth_limit".into());
    }
    if path.file_name().is_some_and(|n| n == ".git") {
        return Err(format!("finish_artifact_nested_git: {}", path.display()));
    }
    visit(path)?;
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if meta.is_dir() && !receipt::unsafe_link(&meta) {
        for item in fs::read_dir(path).map_err(io_error)? {
            walk(&item.map_err(io_error)?.path(), depth + 1, visit)?;
        }
    }
    Ok(())
}
fn storage(ctx: &Context, name: &str) -> Result<PathBuf, String> {
    if !name.starts_with("manifest-")
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("finish_artifact_manifest_corrupt".into());
    }
    let parent = ctx
        .common
        .join("cli-manager-finish")
        .join(&ctx.request.worktree_id);
    for p in [parent.parent().unwrap(), &parent] {
        if let Some(meta) = worktree_root_metadata(p)? {
            if receipt::unsafe_link(&meta) || !meta.is_dir() {
                return Err("finish_unsafe_receipt_path".into());
            }
        }
    }
    let path = parent.join(name);
    if let Some(meta) = worktree_root_metadata(&path)? {
        if receipt::unsafe_link(&meta) || !meta.is_dir() {
            return Err("finish_artifact_manifest_corrupt".into());
        }
    }
    Ok(path)
}
pub(super) fn prepare(
    ctx: &Context,
    roots: &[String],
    limits: Budgets,
) -> Result<Manifest, String> {
    let identity = receipt::root_identity(&ctx.target)?;
    let name = format!("manifest-{}", uuid::Uuid::new_v4());
    let dir = storage(ctx, &name)?;
    fs::create_dir_all(&dir).map_err(io_error)?;
    let mut files = Vec::new();
    for i in 0..SHARDS {
        files.push(
            fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(dir.join(format!("{i}.pending")))
                .map_err(io_error)?,
        );
    }
    let mut budget = Budget {
        limits,
        bytes: 0,
        entries: 0,
        manifest: 0,
        start: Instant::now(),
    };
    let mut counts = [0usize; SHARDS];
    let mut recorded_parents = std::collections::BTreeSet::new();
    for root in roots {
        let path = artifact_path(ctx, root)?;
        if !path.starts_with(&ctx.target) || path == ctx.target {
            return Err("finish_artifact_path".into());
        }
        receipt::root_identity(&path)?;
        let mut record = |path: &Path| {
            let rel = relative(&ctx.target, path)?;
            if !safe_relative(&rel) {
                return Err("finish_artifact_path".into());
            }
            budget.entries += 1;
            budget.check(path)?;
            let value = entry_value(path, &mut budget)?;
            let mut line = serde_json::to_vec(&(rel.clone(), value)).map_err(|e| e.to_string())?;
            line.push(b'\n');
            budget.manifest += line.len() as u64;
            budget.check(path)?;
            let i = shard(&rel);
            counts[i] += 1;
            if counts[i] > SHARD_ENTRIES {
                return Err("finish_artifact_shard_limit".into());
            }
            files[i].write_all(&line).map_err(io_error)
        };
        // Ancestors outside the artifact root are ownership boundaries too. Record
        // only their native directory identity, never traverse/delete their content.
        for parent in path.ancestors().skip(1).take_while(|p| *p != ctx.target) {
            if recorded_parents.insert(parent.to_path_buf()) {
                record(parent)?;
            }
        }
        walk(&path, 0, &mut record)?;
    }
    for file in &files {
        file.sync_all().map_err(io_error)?;
    }
    drop(files);
    for i in 0..SHARDS {
        publish(
            &dir.join(format!("{i}.pending")),
            &dir.join(format!("{i}.jsonl")),
        )?;
    }
    let mut shards = Vec::new();
    for i in 0..SHARDS {
        shards.push(digest_shard(&dir.join(format!("{i}.jsonl")))?);
    }
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&shards).map_err(|e| e.to_string())?)
    );
    #[cfg(unix)]
    {
        for path in [
            &dir,
            dir.parent().unwrap(),
            dir.parent().unwrap().parent().unwrap(),
        ] {
            fs::File::open(path)
                .and_then(|f| f.sync_all())
                .map_err(io_error)?;
        }
    }
    if identity != receipt::root_identity(&ctx.target)? {
        return Err("finish_root_replaced".into());
    }
    Ok(Manifest {
        version: 1,
        directory: name,
        digest,
        entry_count: budget.entries,
        content_bytes: budget.bytes,
        root_identity: identity,
        roots: roots.to_vec(),
        shards,
    })
}
fn publish(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
    }
    #[cfg(not(windows))]
    fs::rename(from, to).map_err(io_error)?;
    Ok(())
}
fn digest_shard(path: &Path) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if receipt::unsafe_link(&meta) || !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
        return Err("finish_artifact_manifest_corrupt".into());
    }
    let mut reader = fs::File::open(path).map_err(io_error)?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf).map_err(io_error)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn read_shard(dir: &Path, i: usize, expected: &str) -> Result<BTreeMap<String, String>, String> {
    let path = dir.join(format!("{i}.jsonl"));
    if digest_shard(&path)? != expected {
        return Err("finish_artifact_manifest_corrupt".into());
    }
    let mut result = BTreeMap::new();
    let mut reader = BufReader::new(fs::File::open(path).map_err(io_error)?);
    loop {
        let mut line = Vec::new();
        let n = reader
            .by_ref()
            .take(65537)
            .read_until(b'\n', &mut line)
            .map_err(io_error)?;
        if n == 0 {
            break;
        }
        if n > 65536 || line.last() != Some(&b'\n') {
            return Err("finish_artifact_manifest_corrupt".into());
        }
        let (path, value): (String, String) =
            serde_json::from_slice(&line).map_err(|_| "finish_artifact_manifest_corrupt")?;
        if !safe_relative(&path)
            || shard(&path) != i
            || result.insert(path, value).is_some()
            || result.len() > SHARD_ENTRIES
        {
            return Err("finish_artifact_manifest_corrupt".into());
        }
    }
    Ok(result)
}
fn check_manifest(ctx: &Context, m: &Manifest) -> Result<PathBuf, String> {
    if m.version != 1
        || m.shards.len() != SHARDS
        || m.entry_count > 500_000
        || m.content_bytes > 32 * 1024 * 1024 * 1024
        || format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&m.shards).map_err(|e| e.to_string())?)
        ) != m.digest
    {
        return Err("finish_artifact_manifest_corrupt".into());
    }
    if receipt::root_identity(&ctx.target)? != m.root_identity {
        return Err("finish_root_replaced".into());
    }
    for root in &m.roots {
        let path = artifact_path(ctx, root)?;
        if path == ctx.target
            || !path.starts_with(&ctx.target)
            || !safe_relative(&relative(&ctx.target, &path)?)
        {
            return Err("finish_artifact_manifest_corrupt".into());
        }
        for ancestor in path.ancestors().skip(1).take_while(|p| *p != ctx.target) {
            if let Some(meta) = worktree_root_metadata(ancestor)? {
                if receipt::unsafe_link(&meta) {
                    return Err("finish_artifact_root_link".into());
                }
            }
        }
    }
    let dir = storage(ctx, &m.directory)?;
    let mut bytes = 0u64;
    for i in 0..SHARDS {
        let meta = fs::symlink_metadata(dir.join(format!("{i}.jsonl"))).map_err(io_error)?;
        if receipt::unsafe_link(&meta) || !meta.is_file() {
            return Err("finish_artifact_manifest_corrupt".into());
        }
        bytes = bytes
            .checked_add(meta.len())
            .ok_or("finish_artifact_manifest_corrupt")?;
        if bytes > 128 * 1024 * 1024 {
            return Err("finish_artifact_manifest_corrupt".into());
        }
    }
    Ok(dir)
}
pub(super) fn verify(ctx: &Context, m: &Manifest) -> Result<(), String> {
    verify_with_limits(ctx, m, Budgets::default())
}
pub(super) fn verify_with_limits(
    ctx: &Context,
    m: &Manifest,
    limits: Budgets,
) -> Result<(), String> {
    let dir = check_manifest(ctx, m)?;
    let mut budget = Budget {
        limits,
        bytes: 0,
        entries: 0,
        manifest: 0,
        start: Instant::now(),
    };
    let mut count = 0u64;
    for i in 0..SHARDS {
        let owned = read_shard(&dir, i, &m.shards[i])?;
        count += owned.len() as u64;
        for root in &m.roots {
            let root = artifact_path(ctx, root)?;
            if worktree_root_metadata(&root)?.is_none() {
                continue;
            }
            walk(&root, 0, &mut |path| {
                budget.check(path)?;
                let rel = relative(&ctx.target, path)?;
                if shard(&rel) != i {
                    return Ok(());
                }
                budget.entries += 1;
                budget.check(path)?;
                let value = entry_value(path, &mut budget)?;
                if owned.get(&rel) != Some(&value) {
                    return Err(format!("finish_artifact_changed: {rel}"));
                }
                Ok(())
            })?;
        }
    }
    if count != m.entry_count {
        return Err("finish_artifact_manifest_corrupt".into());
    }
    Ok(())
}

// Cache persisted evidence only, never observed identities. The active parent chain
// stays bounded by walk depth; repeated siblings still probe native identity,
// without parsing an entire 8192-entry shard for each parent of each file.
#[derive(Default)]
struct DirectoryEvidence(BTreeMap<String, String>);
impl DirectoryEvidence {
    fn expected(&mut self, rel: &str, dir: &Path, m: &Manifest) -> Result<String, String> {
        if let Some(value) = self.0.get(rel) {
            return Ok(value.clone());
        }
        let i = shard(rel);
        let owned = read_shard(dir, i, &m.shards[i])?;
        let value = owned.get(rel).filter(|v| v.starts_with("dir:"))
            .cloned().ok_or("finish_artifact_manifest_corrupt")?;
        if self.0.len() >= 256 {
            self.0.clear();
        }
        self.0.insert(rel.into(), value.clone());
        Ok(value)
    }
}
fn safe_parents(
    ctx: &Context, path: &Path, dir: &Path, m: &Manifest,
    evidence: &mut DirectoryEvidence,
) -> Result<(), String> {
    for parent in path.ancestors().skip(1).take_while(|p| *p != ctx.target) {
        let meta = fs::symlink_metadata(parent).map_err(io_error)?;
        if receipt::unsafe_link(&meta) || !meta.is_dir() {
            return Err("finish_artifact_root_link".into());
        }
        let rel = relative(&ctx.target, parent)?;
        if evidence.expected(&rel, dir, m)? != format!("dir:{}", receipt::root_identity(parent)?) {
            return Err(format!("finish_artifact_changed: {rel}"));
        }
    }
    Ok(())
}
fn remove_dirs(
    ctx: &Context,
    path: &Path,
    dir: &Path,
    m: &Manifest,
    depth: usize,
    evidence: &mut DirectoryEvidence,
) -> Result<(), String> {
    if depth > 128 {
        return Err("finish_artifact_depth_limit".into());
    }
    safe_parents(ctx, path, dir, m, evidence)?;
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if receipt::unsafe_link(&meta)
        || !meta.is_dir()
        || path.file_name().is_some_and(|n| n == ".git")
    {
        return Err("finish_artifact_changed".into());
    }
    let rel = relative(&ctx.target, path)?;
    if evidence.expected(&rel, dir, m)? != format!("dir:{}", receipt::root_identity(path)?) {
        return Err("finish_artifact_changed".into());
    }
    for item in fs::read_dir(path).map_err(io_error)? {
        remove_dirs(ctx, &item.map_err(io_error)?.path(), dir, m, depth + 1, evidence)?;
    }
    fs::remove_dir(path).map_err(io_error)
}
#[cfg(test)]
pub(super) fn remove(ctx: &Context, m: &Manifest) -> Result<(), String> {
    remove_guarded(ctx, m, || Ok(()))
}
pub(super) fn remove_guarded<F: FnMut() -> Result<(), String>>(
    ctx: &Context,
    m: &Manifest,
    mut guard: F,
) -> Result<(), String> {
    guard()?;
    verify(ctx, m)?;
    guard()?;
    let dir = check_manifest(ctx, m)?;
    let mut budget = Budget {
        limits: Budgets::default(),
        bytes: 0,
        entries: 0,
        manifest: 0,
        start: Instant::now(),
    };
    let mut evidence = DirectoryEvidence::default();
    // Each bounded shard is loaded once for file/link deletion. No per-file full-manifest
    // reload and no hundreds-of-thousands-entry receipt/in-memory ownership map.
    for i in 0..SHARDS {
        guard()?;
        check_manifest(ctx, m)?;
        let owned = read_shard(&dir, i, &m.shards[i])?;
        for (rel, expected) in owned {
            if expected.starts_with("dir:") {
                continue;
            }
            let path = ctx.target.join(&rel);
            if worktree_root_metadata(&path)?.is_none() {
                continue;
            }
            if receipt::root_identity(&ctx.target)? != m.root_identity {
                return Err("finish_root_replaced".into());
            }
            safe_parents(ctx, &path, &dir, m, &mut evidence)?;
            budget.entries += 1;
            budget.check(&path)?;
            if entry_value(&path, &mut budget)? != expected {
                return Err(format!("finish_artifact_changed: {rel}"));
            }
            safe_parents(ctx, &path, &dir, m, &mut evidence)?;
            let meta = fs::symlink_metadata(&path).map_err(io_error)?;
            #[cfg(windows)]
            let directory_link = {
                use std::os::windows::fs::MetadataExt;
                meta.file_attributes() & 0x10 != 0
            };
            #[cfg(not(windows))]
            let directory_link = meta.is_dir();
            if directory_link {
                fs::remove_dir(&path).map_err(io_error)?;
            } else {
                fs::remove_file(&path).map_err(io_error)?;
            }
        }
    }
    for root in &m.roots {
        guard()?;
        let path = artifact_path(ctx, root)?;
        if worktree_root_metadata(&path)?.is_some() {
            remove_dirs(ctx, &path, &dir, m, 0, &mut evidence)?;
        }
        ensure_worktree_root_absent(&path)?;
    }
    Ok(())
}
