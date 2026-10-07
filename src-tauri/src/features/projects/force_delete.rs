//! Explicit discard authority, deliberately independent of merge receipts.
use super::*;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceDeleteInspection {
    pub token: String,
    /// Exact record input, never a Windows extended-prefix canonical path.
    pub confirmed_path: String,
    pub delete_branch: bool,
    pub branch_oid: Option<String>,
    pub path_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceDeleteResult {
    /// Root, Git registration and local branch absent; caller must still finalize SQL.
    pub done: bool,
    pub branch_deleted: bool,
}

#[derive(PartialEq, Eq)]
struct Binding {
    request: FinishRequest,
    target: String,
    common: String,
    project_identity: String,
    common_identity: String,
    root_identity: Option<String>,
    // Full porcelain binds HEAD, lock/prunable flags, paths and registration changes.
    registrations: String,
    branch_oid: Option<String>,
}
struct Authorization {
    binding: Binding,
    issued: std::time::Instant,
}
static AUTHORIZATIONS: OnceLock<Mutex<HashMap<String, Authorization>>> = OnceLock::new();
fn authorizations() -> &'static Mutex<HashMap<String, Authorization>> {
    AUTHORIZATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

// Missing paths cannot canonicalize; strip Windows extended prefixes on both
// sides so their still-registered porcelain spelling remains comparable.
fn force_path_compare(path: &Path) -> String {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let value = path_to_git_arg(&normalized).replace('\\', "/");
    let value = value.trim_end_matches('/').to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn binding(req: &FinishRequest) -> Result<(Context, Binding), String> {
    let ctx = context(req.clone())?;
    let registrations = run_git_checked(&ctx.project, ["worktree", "list", "--porcelain"])?;
    let entries = parse_worktree_list_entries(&registrations);
    // First porcelain entry is the physical main checkout, even for linked projects.
    let main = entries.first().ok_or("force_delete_main_missing")?;
    let target = force_path_compare(&ctx.target);
    for entry in &entries {
        let path = force_path_compare(&entry.path);
        let own = path == target && entry.branch.as_deref() == Some(&req.branch);
        if std::ptr::eq(entry, main) || !own {
            if path == target
                || path.starts_with(&(target.clone() + "/"))
                || target.starts_with(&(path + "/"))
            {
                return Err("force_delete_protected_worktree".into());
            }
        }
    }
    let branch_oid = branch_state(&ctx, true)?;
    if entries.iter().any(|entry| {
        force_path_compare(&entry.path) == target && entry.branch.as_deref() != Some(&req.branch)
    }) {
        return Err("worktree_branch_mismatch".into());
    }
    ensure_scoped_prune(&ctx)?;
    let root_identity = match worktree_root_metadata(&ctx.target)? {
        None => None,
        Some(_) => Some(receipt::root_identity(&ctx.target)?),
    };
    // A residual containing a usable different checkout must not be adopted.
    if root_identity.is_some() && worktree_root_metadata(&ctx.target.join(".git"))?.is_some() {
        if !checkout_valid(&ctx)? {
            // Registered stale .git files are allowed; a directory is another repo.
            let meta = fs::symlink_metadata(ctx.target.join(".git"))
                .map_err(|e| format!("force_delete_git_metadata_failed: {e}"))?;
            if receipt::unsafe_link(&meta) || !meta.is_file() {
                return Err("force_delete_foreign_checkout".into());
            }
            if run_git_raw(&ctx.target, ["rev-parse", "--show-toplevel"])?.success {
                return Err("force_delete_foreign_checkout".into());
            }
        }
    }
    let bound = Binding {
        request: req.clone(),
        target,
        common: force_path_compare(&ctx.common),
        project_identity: receipt::root_identity(&ctx.project)?,
        common_identity: receipt::root_identity(&ctx.common)?,
        root_identity,
        registrations,
        branch_oid,
    };
    Ok((ctx, bound))
}

// A missing ref is explicit state, not permission to delete a future ref.
fn branch_state(ctx: &Context, allow_target: bool) -> Result<Option<String>, String> {
    let entries = parse_worktree_list_entries(&run_git_checked(
        &ctx.project,
        ["worktree", "list", "--porcelain"],
    )?);
    for (index, entry) in entries.iter().enumerate() {
        if entry.branch.as_deref() == Some(&ctx.request.branch)
            && (!allow_target
                || index == 0
                || force_path_compare(&entry.path) != force_path_compare(&ctx.target))
        {
            return Err("force_delete_branch_in_use".into());
        }
    }
    let repo = open_main_repo(&path_to_git_arg(&ctx.project))?;
    let reference = format!("refs/heads/{}", ctx.request.branch);
    let result = match repo.find_reference(&reference) {
        Ok(reference) => reference
            .target()
            .map(|oid| Some(oid.to_string()))
            .ok_or_else(|| "force_delete_symbolic_branch".to_string()),
        Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(error) => Err(format!("force_delete_branch_read_failed: {error}")),
    };
    result
}

fn delete_bound_branch(ctx: &Context, oid: &Option<String>) -> Result<(), String> {
    // Recheck after removal/prune. Compare-delete the captured ref tip atomically.
    let current = branch_state(ctx, false)?;
    if current.is_none() {
        return Ok(());
    }
    if current != *oid {
        return Err("force_delete_branch_changed".into());
    }
    let reference = format!("refs/heads/{}", ctx.request.branch);
    run_git_checked(
        &ctx.project,
        [
            "update-ref",
            "--no-deref",
            "-d",
            &reference,
            oid.as_deref().unwrap(),
        ],
    )
    .map_err(|error| format!("force_delete_branch_delete_failed: {error}"))?;
    if branch_state(ctx, false)?.is_some() {
        return Err("force_delete_branch_changed".into());
    }
    Ok(())
}

// Git prune 无路径参数；只允许 dry-run 精确指向本目标登记，否则保守阻塞。
fn ensure_scoped_prune(ctx: &Context) -> Result<(), String> {
    let output = run_git_checked(
        &ctx.project,
        [
            "worktree",
            "prune",
            "--dry-run",
            "--verbose",
            "--expire",
            "now",
        ],
    )?;
    if output.trim().is_empty() {
        return Ok(());
    }
    let admin = ctx.common.join("worktrees");
    let meta = fs::symlink_metadata(&admin).map_err(|_| "force_delete_unrelated_prune")?;
    if receipt::unsafe_link(&meta) || !meta.is_dir() {
        return Err("force_delete_unrelated_prune".into());
    }
    let prune_path = |path: &Path| {
        let value = path_to_git_arg(path).replace('\\', "/");
        if cfg!(windows) {
            value.to_lowercase()
        } else {
            value
        }
    };
    let expected = prune_path(&ctx.target.join(".git"));
    let mut own = Vec::new();
    for entry in fs::read_dir(admin).map_err(|_| "force_delete_unrelated_prune")? {
        let entry = entry.map_err(|_| "force_delete_unrelated_prune")?;
        let meta =
            fs::symlink_metadata(entry.path()).map_err(|_| "force_delete_unrelated_prune")?;
        if receipt::unsafe_link(&meta) || !meta.is_dir() {
            continue;
        }
        let gitdir = entry.path().join("gitdir");
        let Ok(meta) = fs::symlink_metadata(&gitdir) else {
            continue;
        };
        if receipt::unsafe_link(&meta) || !meta.is_file() {
            continue;
        }
        let Ok(path) = fs::read_to_string(gitdir) else {
            continue;
        };
        if prune_path(&local_path_from_input(path.trim())) == expected {
            own.push(format!(
                "Removing worktrees/{}: ",
                entry.file_name().to_string_lossy()
            ));
        }
    }
    // 未知输出/多重绑定/其它失效登记均不认领；不手工删除 Git 管理目录。
    if own.len() != 1 || output.lines().any(|line| !line.starts_with(&own[0])) {
        return Err("force_delete_unrelated_prune".into());
    }
    Ok(())
}

fn inspect_force(req: &FinishRequest) -> Result<ForceDeleteInspection, String> {
    let (_, binding) = binding(req)?;
    let path_missing = binding.root_identity.is_none();
    let branch_oid = binding.branch_oid.clone();
    let token = uuid::Uuid::new_v4().to_string();
    let mut pending = authorizations()
        .lock()
        .map_err(|_| "force_delete_token_lock")?;
    pending.retain(|_, auth| auth.issued.elapsed() < Duration::from_secs(600));
    if pending.len() >= 256 {
        return Err("force_delete_too_many_confirmations".into());
    }
    pending.insert(
        token.clone(),
        Authorization {
            binding,
            issued: std::time::Instant::now(),
        },
    );
    Ok(ForceDeleteInspection {
        token,
        confirmed_path: req.worktree_path.clone(),
        delete_branch: true,
        branch_oid,
        path_missing,
    })
}

// 验证保留原 token 和原签发时间；失败才撤销，绝不刷新授权。
fn validate_force(
    req: &FinishRequest,
    token: &str,
    confirmed_path: &str,
) -> Result<ForceDeleteInspection, String> {
    let mut pending = authorizations()
        .lock()
        .map_err(|_| "force_delete_token_lock")?;
    let result = (|| {
        let authorization = pending
            .get(token)
            .ok_or("force_delete_confirmation_required")?;
        if authorization.issued.elapsed() >= Duration::from_secs(600) {
            return Err("force_delete_confirmation_expired".into());
        }
        if confirmed_path != req.worktree_path || authorization.binding.request != *req {
            return Err("force_delete_confirmation_mismatch".into());
        }
        let (_, current) = binding(req)?;
        if current != authorization.binding {
            return Err("force_delete_identity_changed".into());
        }
        Ok(ForceDeleteInspection {
            token: token.into(),
            confirmed_path: req.worktree_path.clone(),
            delete_branch: true,
            branch_oid: current.branch_oid,
            path_missing: current.root_identity.is_none(),
        })
    })();
    if result.is_err() {
        pending.remove(token);
    }
    result
}

// Explicit traversal: links are unlinked, never enumerated. Directory junctions
// require remove_dir on Windows; remove_file is correct for Unix symlinks.
fn unlink_tree(path: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if unsafe_worktree_link(&meta) {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x10 != 0 {
                return fs::remove_dir(path);
            }
        }
        return fs::remove_file(path);
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            unlink_tree(&entry?.path())?;
        }
        fs::remove_dir(path)
    } else if meta.is_file() {
        fs::remove_file(path)
    } else {
        Err(io::Error::other("force_delete_unsupported_entry"))
    }
}

fn execute_with_remover<F>(
    req: &FinishRequest,
    token: &str,
    confirmed_path: &str,
    remove: F,
) -> Result<ForceDeleteResult, String>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    let mut remove = remove;
    // Consume before any check: all failures require fresh inspection + confirmation.
    let authorization = authorizations()
        .lock()
        .map_err(|_| "force_delete_token_lock")?
        .remove(token)
        .ok_or("force_delete_confirmation_required")?;
    if authorization.issued.elapsed() >= Duration::from_secs(600) {
        return Err("force_delete_confirmation_expired".into());
    }
    if confirmed_path != req.worktree_path || authorization.binding.request != *req {
        return Err("force_delete_confirmation_mismatch".into());
    }
    let (ctx, current) = binding(req)?;
    if current != authorization.binding {
        return Err("force_delete_identity_changed".into());
    }
    if current.root_identity.is_some() {
        // Never delegate traversal to git worktree remove: Git may recurse into
        // platform reparse points. Remove safely, then use existing prune command.
        remove_worktree_path_with_retry(&ctx.target, |path| {
            // A transient OS error must not authorize a replacement root on retry.
            if worktree_root_metadata(path)
                .map_err(io::Error::other)?
                .is_some()
                && Some(receipt::root_identity(path).map_err(io::Error::other)?)
                    != current.root_identity
            {
                return Err(io::Error::other("force_delete_identity_changed"));
            }
            remove(path)
        })?;
    }
    ensure_worktree_root_absent(&ctx.target)?;
    ensure_scoped_prune(&ctx)?;
    run_git_checked(&ctx.project, ["worktree", "prune", "--expire", "now"])?;
    if parse_worktree_list_entries(&run_git_checked(
        &ctx.project,
        ["worktree", "list", "--porcelain"],
    )?)
    .iter()
    .any(|entry| force_path_compare(&entry.path) == force_path_compare(&ctx.target))
    {
        return Err("worktree_remove_incomplete".into());
    }
    delete_bound_branch(&ctx, &authorization.binding.branch_oid)?;
    Ok(ForceDeleteResult {
        done: true,
        branch_deleted: true,
    })
}

#[tauri::command]
pub async fn git_worktree_force_delete_inspect(
    req: FinishRequest,
) -> Result<ForceDeleteInspection, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        inspect_force(&req)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[tauri::command]
pub async fn git_worktree_force_delete_validate(
    req: FinishRequest,
    token: String,
    confirmed_path: String,
) -> Result<ForceDeleteInspection, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        validate_force(&req, &token, &confirmed_path)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[tauri::command]
pub async fn git_worktree_force_delete(
    req: FinishRequest,
    token: String,
    confirmed_path: String,
) -> Result<ForceDeleteResult, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        execute_with_remover(&req, &token, &confirmed_path, unlink_tree)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[cfg(test)]
#[path = "force_delete_tests.rs"]
mod tests;
