//! Durable append-only finish journal and bounded, non-following ownership snapshots.
use super::FinishRequest;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Receipt {
    pub version: u32,
    pub request: FinishRequest,
    pub repo: String,
    pub source_oid: String,
    pub outcome: Option<String>,
    pub base_oid: Option<String>,
    pub phase: String,
    pub blocker: Option<String>,
    pub stash_reference: Option<String>,
    pub ownership: Option<Ownership>,
    pub delete_branch: Option<bool>,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Ownership {
    identity: String,
    entries: BTreeMap<String, String>,
}

pub(super) fn unsafe_link(metadata: &fs::Metadata) -> bool {
    super::super::unsafe_worktree_link(metadata)
}

// 用原生目录身份区分原 checkout 与后来替换的同路径目录；链接不作为清理根。
pub(super) fn root_identity(path: &Path) -> Result<String, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("finish_metadata_failed: {e}"))?;
    if unsafe_link(&metadata) || !metadata.is_dir() {
        return Err("finish_unsafe_root".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_FLAG_OPEN_REPARSE_POINT,
        };
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|e| format!("finish_identity_failed: {e}"))?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
            return Err(format!(
                "finish_identity_failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(format!(
            "{}:{}:{}:{}:{}",
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
            info.ftCreationTime.dwHighDateTime,
            info.ftCreationTime.dwLowDateTime
        ))
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("finish_identity_unsupported".into())
    }
}

// 有界记录文件内容和目录结构；不跟随链接，任一读取失败都不能产生删除授权。
pub(super) fn snapshot(root: &Path) -> Result<Ownership, String> {
    let identity = root_identity(root)?;
    let mut entries = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    let mut bytes = 0u64;
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("finish_snapshot_failed: {e}"))? {
            let path = entry
                .map_err(|e| format!("finish_snapshot_failed: {e}"))?
                .path();
            let meta =
                fs::symlink_metadata(&path).map_err(|e| format!("finish_snapshot_failed: {e}"))?;
            // Reject reparse points, including junctions; never enumerate their targets.
            if unsafe_link(&meta) {
                return Err("finish_unsafe_link".into());
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "finish_snapshot_path")?
                .to_str()
                .ok_or("finish_non_utf8_path")?
                .replace('\\', "/");
            let value = if meta.is_dir() {
                pending.push(path.clone());
                "dir".to_string()
            } else if meta.is_file() {
                bytes = bytes
                    .checked_add(meta.len())
                    .ok_or("finish_snapshot_limit")?;
                if bytes > 256 * 1024 * 1024 {
                    return Err("finish_snapshot_limit".into());
                }
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
                    options.custom_flags(
                        windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT,
                    );
                }
                let mut file = options
                    .open(&path)
                    .map_err(|e| format!("finish_snapshot_failed: {e}"))?;
                if unsafe_link(
                    &file
                        .metadata()
                        .map_err(|e| format!("finish_snapshot_failed: {e}"))?,
                ) {
                    return Err("finish_unsafe_link".into());
                }
                let mut hash = Sha256::new();
                let mut buf = [0u8; 65536];
                loop {
                    let n = file
                        .read(&mut buf)
                        .map_err(|e| format!("finish_snapshot_failed: {e}"))?;
                    if n == 0 {
                        break;
                    }
                    bytes = bytes.checked_add(n as u64).ok_or("finish_snapshot_limit")?;
                    if bytes > 512 * 1024 * 1024 {
                        return Err("finish_snapshot_limit".into());
                    }
                    hash.update(&buf[..n]);
                }
                format!("file:{:x}", hash.finalize())
            } else {
                return Err("finish_unsupported_entry".into());
            };
            entries.insert(relative, value);
            if entries.len() > 20000 {
                return Err("finish_snapshot_limit".into());
            }
        }
    }
    if root_identity(root)? != identity {
        return Err("finish_root_replaced".into());
    }
    Ok(Ownership { identity, entries })
}

// 仅接受同一目录身份下未变化的残留子集，不认领新增或被修改的文件。
pub(super) fn verify_subset(root: &Path, owned: &Ownership) -> Result<(), String> {
    let current = snapshot(root)?;
    if current.identity != owned.identity {
        return Err("finish_root_replaced".into());
    }
    for (path, hash) in current.entries {
        if owned.entries.get(&path) != Some(&hash) {
            return Err("finish_residual_changed".into());
        }
    }
    Ok(())
}

#[cfg(test)]
thread_local! { static FAIL_SAVE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
#[cfg(test)]
pub(super) fn fail_next_save() {
    FAIL_SAVE.with(|value| value.set(true));
}

pub(super) struct Journal {
    dir: PathBuf,
}
impl Journal {
    // 收据位于 common Git 管理目录，不随 checkout 注销；拒绝不安全标识和链接路径。
    pub fn new(common: &Path, id: &str) -> Result<Self, String> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("finish_invalid_id".into());
        }
        let dir = common.join("cli-manager-finish").join(id);
        for path in [common.join("cli-manager-finish"), dir.clone()] {
            if let Some(meta) = super::super::worktree_root_metadata(&path)? {
                if unsafe_link(&meta) || !meta.is_dir() {
                    return Err("finish_unsafe_receipt_path".into());
                }
            }
        }
        Ok(Self { dir })
    }

    // 仅读取已发布 JSON 序号；中断留下的 pending 文件不能推进生命周期。
    fn latest(&self) -> Result<Option<(u32, PathBuf)>, String> {
        let Some(_) = super::super::worktree_root_metadata(&self.dir)? else {
            return Ok(None);
        };
        let mut latest = None;
        let mut count = 0;
        for entry in
            fs::read_dir(&self.dir).map_err(|e| format!("finish_receipt_read_failed: {e}"))?
        {
            let path = entry
                .map_err(|e| format!("finish_receipt_read_failed: {e}"))?
                .path();
            count += 1;
            if count > 4096 {
                return Err("finish_receipt_limit".into());
            }
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let number = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<u32>().ok())
                .ok_or("finish_receipt_corrupt")?;
            if latest.as_ref().map_or(true, |(n, _)| number > *n) {
                latest = Some((number, path));
            }
        }
        Ok(latest)
    }

    // 限制收据大小并检查版本，损坏或无法读取时保守停止而非推断完成。
    pub fn load(&self) -> Result<Option<Receipt>, String> {
        let Some((_, path)) = self.latest()? else {
            return Ok(None);
        };
        let meta =
            fs::symlink_metadata(&path).map_err(|e| format!("finish_receipt_read_failed: {e}"))?;
        if unsafe_link(&meta) || !meta.is_file() || meta.len() > 16 * 1024 * 1024 {
            return Err("finish_receipt_corrupt".into());
        }
        let receipt: Receipt = serde_json::from_slice(
            &fs::read(path).map_err(|e| format!("finish_receipt_read_failed: {e}"))?,
        )
        .map_err(|e| format!("finish_receipt_corrupt: {e}"))?;
        if receipt.version != 1 {
            return Err("finish_receipt_version".into());
        }
        Ok(Some(receipt))
    }

    // 写新序号并同步后发布；任一步失败由调用方停止后续破坏性操作。
    pub fn save(&self, receipt: &Receipt) -> Result<(), String> {
        #[cfg(test)]
        if FAIL_SAVE.with(|value| value.replace(false)) {
            return Err("finish_receipt_write_failed: injected".into());
        }
        fs::create_dir_all(&self.dir).map_err(|e| format!("finish_receipt_write_failed: {e}"))?;
        let seq = self.latest()?.map_or(1, |(n, _)| n + 1);
        let bytes =
            serde_json::to_vec(receipt).map_err(|e| format!("finish_receipt_write_failed: {e}"))?;
        // Interrupted writes remain .pending and are never mistaken for committed state.
        let pending = self.dir.join(format!("{}.pending", uuid::Uuid::new_v4()));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&pending)
            .map_err(|e| format!("finish_receipt_write_failed: {e}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("finish_receipt_write_failed: {e}"))?;
        drop(file);
        let committed = self.dir.join(format!("{seq:08}.json"));
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
            let from: Vec<u16> = pending.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = committed.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
                return Err(format!(
                    "finish_receipt_write_failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        #[cfg(not(windows))]
        fs::rename(&pending, &committed)
            .map_err(|e| format!("finish_receipt_write_failed: {e}"))?;
        #[cfg(unix)]
        {
            for dir in [
                &self.dir,
                self.dir.parent().unwrap(),
                self.dir.parent().unwrap().parent().unwrap(),
            ] {
                fs::File::open(dir)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| format!("finish_receipt_sync_failed: {e}"))?;
            }
        }
        Ok(())
    }
}
