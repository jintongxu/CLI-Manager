#[path = "finish.rs"]
pub mod finish;
#[path = "worktree_create.rs"]
mod create;

use git2::Repository;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const WORKTREE_BRANCH_PREFIX: &str = "wt/";
const MAX_TASK_NAME_LEN: usize = 64;
const WORKTREE_REMOVE_RETRY_ATTEMPTS: usize = 5;
const WORKTREE_REMOVE_RETRY_DELAY_MS: u64 = 250;
const RESERVED_WINDOWS_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateRequest {
    pub project_path: String,
    pub task_name: String,
    pub worktree_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateResult {
    pub name: String,
    pub branch: String,
    pub path: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeMergeResult {
    pub merged: bool,
    pub output: String,
    pub conflict_files: Vec<String>,
    pub skipped: bool,
    pub skip_reason: Option<String>,
    pub stash_created: bool,
    pub stash_restored: bool,
    pub stash_reference: Option<String>,
    pub stash_restore_conflict_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeDepsCheckResult {
    pub needs_install: bool,
    pub command: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug)]
struct GitCommandOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

impl GitCommandOutput {
    // 合并标准输出和错误输出，并去除首尾空白。
    fn combined(&self) -> String {
        format!("{}{}", self.stdout, self.stderr).trim().to_string()
    }
}

const GIT_CREATE_ERROR_SNIPPET_LEN: usize = 300;
const FORCE_MERGE_STASH_MESSAGE_PREFIX: &str = "CLI-Manager force merge";

// 普通合并和强制合并共享同一把锁，避免多个完成对话框交错操作主工作区。
static WORKTREE_MERGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn acquire_worktree_merge_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    WORKTREE_MERGE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "worktree_merge_lock_poisoned".to_string())
}

// 归一化 Git 进度换行并保留末尾 300 字符，避免遗漏最终错误。
fn git_create_error_snippet(output: &str) -> String {
    let normalized = output.replace('\r', "\n");
    let lines = normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let chars = lines.chars().collect::<Vec<_>>();
    if chars.len() <= GIT_CREATE_ERROR_SNIPPET_LEN {
        return lines;
    }
    let start = chars.len() - GIT_CREATE_ERROR_SNIPPET_LEN;
    format!("...{}", chars[start..].iter().collect::<String>())
}

// 移除 Windows 扩展路径前缀，并将扩展 UNC 路径还原为普通 UNC。
fn strip_windows_extended_path_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("\\\\?\\") {
        if let Some(unc_tail) = rest.strip_prefix("UNC\\") {
            return format!("\\\\{unc_tail}");
        }
        return rest.to_string();
    }
    if let Some(rest) = path.strip_prefix("//?/") {
        if let Some(unc_tail) = rest.strip_prefix("UNC/") {
            return format!("//{unc_tail}");
        }
        return rest.to_string();
    }
    path.to_string()
}

// 修剪输入并移除 Windows 扩展前缀，构造本地路径。
fn local_path_from_input(path: &str) -> PathBuf {
    PathBuf::from(strip_windows_extended_path_prefix(path.trim()))
}

// 将路径转换为不带 Windows 扩展前缀的 Git 参数。
fn path_to_git_arg(path: &Path) -> String {
    strip_windows_extended_path_prefix(&path.to_string_lossy())
}

// 归一化分隔符与大小写，识别两种 WSL UNC 路径。
fn is_wsl_path(path: &str) -> bool {
    let plain = strip_windows_extended_path_prefix(path);
    let normalized = plain.replace('/', "\\").to_lowercase();
    normalized.starts_with("\\\\wsl$\\") || normalized.starts_with("\\\\wsl.localhost\\")
}

// 识别 UNC、URL 和 git@ 形式的远程路径。
fn is_unc_or_remote_path(path: &str) -> bool {
    let plain = strip_windows_extended_path_prefix(path.trim());
    let normalized = plain.replace('/', "\\").to_lowercase();
    normalized.starts_with("\\\\") || normalized.contains("://") || normalized.starts_with("git@")
}

// 拒绝 WSL 和远程路径，仅允许继续处理本地路径。
fn ensure_supported_local_path(path: &str) -> Result<(), String> {
    if is_wsl_path(path) {
        return Err("unsupported_wsl".to_string());
    }
    if is_unc_or_remote_path(path) {
        return Err("unsupported_remote_path".to_string());
    }
    Ok(())
}

// 打开本地非裸仓库，并要求项目路径等于仓库工作区根目录。
fn open_main_repo(project_path: &str) -> Result<Repository, String> {
    ensure_supported_local_path(project_path)?;
    let path = local_path_from_input(project_path);
    if !path.exists() {
        return Err("path_not_found".to_string());
    }
    if !path.is_dir() {
        return Err("path_not_directory".to_string());
    }
    let repo = super::git::open_git_repo(&path).map_err(|_| "not_git_repository".to_string())?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "bare_repository_unsupported".to_string())?;
    if normalize_path_for_compare(workdir) != normalize_path_for_compare(&path) {
        return Err("project_path_not_repo_root".to_string());
    }
    Ok(repo)
}

// 修剪任务名并限制长度、ASCII 字符和 Windows 保留名称。
fn validate_task_name(task_name: &str) -> Result<String, String> {
    let trimmed = task_name.trim();
    if trimmed.is_empty() {
        return Err("task_name_empty".to_string());
    }
    if trimmed.len() > MAX_TASK_NAME_LEN {
        return Err("task_name_too_long".to_string());
    }
    if trimmed.starts_with('-') {
        return Err("task_name_invalid".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("task_name_invalid".to_string());
    }
    if RESERVED_WINDOWS_NAMES
        .iter()
        .any(|reserved| trimmed.eq_ignore_ascii_case(reserved))
    {
        return Err("task_name_reserved".to_string());
    }
    Ok(trimmed.to_string())
}

// 要求分支以 wt/ 开头且后缀为有效任务名。
fn validate_worktree_branch(branch: &str) -> Result<(), String> {
    let task_name = branch
        .strip_prefix(WORKTREE_BRANCH_PREFIX)
        .ok_or_else(|| "branch_not_worktree".to_string())?;
    validate_task_name(task_name)?;
    Ok(())
}

// 拒绝空值、首尾空白及不允许的基础分支字符或片段。
fn validate_plain_branch_name(branch: &str) -> Result<(), String> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("base_branch_empty".to_string());
    }
    if trimmed != branch
        || trimmed.starts_with('-')
        || trimmed.starts_with('/')
        || trimmed.ends_with('/')
    {
        return Err("base_branch_invalid".to_string());
    }
    if trimmed.contains("..") || trimmed.ends_with(".lock") {
        return Err("base_branch_invalid".to_string());
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\'))
    {
        return Err("base_branch_invalid".to_string());
    }
    Ok(())
}

// 读取当前本地分支名，拒绝缺失 HEAD 和游离 HEAD。
fn current_branch_name(repo: &Repository) -> Result<String, String> {
    let head = repo.head().map_err(|_| "head_not_found".to_string())?;
    if !head.is_branch() {
        return Err("detached_head".to_string());
    }
    head.shorthand()
        .map(|value| value.to_string())
        .ok_or_else(|| "branch_name_unknown".to_string())
}

/// Trellis 把开发者身份写在 `.trellis/.developer`，该文件被 gitignore（仅本地），
/// 所以 `git worktree add` 不会把它带进新 worktree —— 结果新 worktree 里 Trellis
/// 认不出开发者、任务流程走不下去。这里在 worktree 创建后，best-effort 地把主仓库的
/// 身份文件复制过去。文件不存在（主仓库自己也没初始化）或复制失败都安全忽略，
/// 不影响 worktree 本身的创建结果。
// 尽力复制主仓库的 Trellis 身份文件，但不覆盖工作树已有身份。
fn seed_trellis_developer_identity(main_repo: &Path, worktree_path: &Path) {
    let source = main_repo.join(".trellis").join(".developer");
    if !source.is_file() {
        return;
    }
    let dest_dir = worktree_path.join(".trellis");
    if !dest_dir.is_dir() {
        return;
    }
    let dest = dest_dir.join(".developer");
    if dest.exists() {
        return;
    }
    let _ = fs::copy(&source, &dest);
}

// 在项目同级生成带 -worktrees 后缀的默认根目录。
fn default_worktree_root(project_path: &Path) -> Result<PathBuf, String> {
    let project_name = project_path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "project_name_unknown".to_string())?;
    let parent = project_path
        .parent()
        .ok_or_else(|| "project_parent_unknown".to_string())?;
    Ok(parent.join(format!("{project_name}-worktrees")))
}

// 创建并规范化工作树根目录，要求目标不存在且位于根目录下。
fn resolve_worktree_target_path(
    project_path: &Path,
    task_name: &str,
    worktree_root: Option<&str>,
) -> Result<PathBuf, String> {
    let raw_root = match worktree_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(root) => {
            ensure_supported_local_path(root)?;
            let path = local_path_from_input(root);
            if !path.is_absolute() {
                return Err("worktree_root_not_absolute".to_string());
            }
            path
        }
        None => default_worktree_root(project_path)?,
    };

    fs::create_dir_all(&raw_root).map_err(|e| format!("create_worktree_root_failed: {e}"))?;
    let root = raw_root
        .canonicalize()
        .map_err(|e| format!("canonicalize_worktree_root_failed: {e}"))?;
    let target = root.join(task_name);
    if worktree_root_metadata(&target)?.is_some() {
        return Err("worktree_path_exists".to_string());
    }
    if !target.starts_with(&root) {
        return Err("worktree_path_escape".to_string());
    }
    Ok(target)
}

// 在指定目录执行真实 Git，隐藏 Windows 窗口并收集输出与退出状态。
fn run_git_raw<I, S>(cwd: &Path, args: I) -> Result<GitCommandOutput, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    if !cwd.exists() {
        return Err("path_not_found".to_string());
    }

    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "git_not_found".to_string()
        } else {
            format!("spawn_failed: {e}")
        }
    })?;

    Ok(GitCommandOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

// 执行 Git 并检查退出状态，失败时返回截断的错误内容。
fn run_git_checked<I, S>(cwd: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git_raw(cwd, args)?;
    if output.success {
        Ok(output.combined())
    } else {
        let combined = output.combined();
        let snippet: String = combined.chars().take(300).collect();
        Err(format!("git_failed: {snippet}"))
    }
}

// 识别权限、文件占用和资源忙等可重试的删除错误。
// 注意：中文 Windows 上系统错误信息是本地化的（os error 5 显示为“拒绝访问。”），
// 不能只匹配英文 "permission denied"，必须同时匹配 "os error 5" 与中文文案。
fn is_retryable_worktree_remove_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("permission denied")
        || normalized.contains("access is denied")
        || normalized.contains("failed to delete")
        || normalized.contains("unable to unlink")
        || normalized.contains("being used by another process")
        || normalized.contains("os error 5")
        || normalized.contains("os error 32")
        || normalized.contains("device or resource busy")
        || error.contains("拒绝访问")
}

// 识别工作树注册或 .git 指针失效导致的删除错误。
fn is_stale_worktree_remove_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("is not a working tree")
        || normalized.contains("validation failed, cannot remove working tree")
        || (normalized.contains(".git") && normalized.contains("does not exist"))
        || normalized.contains("gitdir file points to non-existent location")
}

// 强制移除工作树，对可重试的文件占用错误最多追加五次重试。
fn run_git_worktree_remove_with_retry(
    project_path: &Path,
    target_arg: &str,
) -> Result<String, String> {
    let mut last_error = String::new();
    for attempt in 0..=WORKTREE_REMOVE_RETRY_ATTEMPTS {
        match run_git_checked(project_path, ["worktree", "remove", "--force", target_arg]) {
            Ok(output) => return Ok(output),
            Err(err)
                if attempt < WORKTREE_REMOVE_RETRY_ATTEMPTS
                    && is_retryable_worktree_remove_error(&err) =>
            {
                last_error = err;
                thread::sleep(Duration::from_millis(WORKTREE_REMOVE_RETRY_DELAY_MS));
            }
            Err(err) => return Err(err),
        }
    }
    Err(last_error)
}

// 将非空输出修剪后按行追加到已有结果。
fn append_output_line(output: &mut String, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push('\n');
    }
    output.push_str(trimmed);
}

// 调用删除函数并重试可恢复错误，将目标已不存在视为成功。
fn remove_worktree_path_with_retry<F>(target_path: &Path, mut remove: F) -> Result<(), String>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    let mut last_error = String::new();
    for attempt in 0..=WORKTREE_REMOVE_RETRY_ATTEMPTS {
        match remove(target_path) {
            Ok(()) => return ensure_worktree_root_absent(target_path),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                return ensure_worktree_root_absent(target_path);
            }
            // PermissionDenied 按种类直接判定为可重试，不依赖系统语言的错误文案。
            Err(err)
                if attempt < WORKTREE_REMOVE_RETRY_ATTEMPTS
                    && (err.kind() == io::ErrorKind::PermissionDenied
                        || is_retryable_worktree_remove_error(&err.to_string())) =>
            {
                last_error = err.to_string();
                thread::sleep(Duration::from_millis(WORKTREE_REMOVE_RETRY_DELAY_MS));
            }
            Err(err) => return Err(format!("remove_stale_worktree_dir_failed: {err}")),
        }
    }
    Err(format!("remove_stale_worktree_dir_failed: {last_error}"))
}

// Only a missing root is absence: permission errors and internal NotFound are failures.
fn worktree_root_metadata(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Windows can report NotFound for a child beneath a regular file.
            // Validate the nearest extant parent before treating the root as absent.
            let mut parent = path.parent();
            while let Some(candidate) = parent {
                match fs::symlink_metadata(candidate) {
                    Ok(metadata) if !metadata.is_dir() || unsafe_worktree_link(&metadata) => {
                        return Err("worktree_metadata_failed: invalid parent".into());
                    }
                    Ok(_) => break,
                    Err(e) if e.kind() == io::ErrorKind::NotFound => parent = candidate.parent(),
                    Err(e) => return Err(format!("worktree_metadata_failed: {e}")),
                }
            }
            Ok(None)
        }
        Err(error) => Err(format!("worktree_metadata_failed: {error}")),
    }
}

fn unsafe_worktree_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn ensure_worktree_root_absent(path: &Path) -> Result<(), String> {
    if worktree_root_metadata(path)?.is_some() {
        Err("worktree_remove_incomplete".to_string())
    } else {
        Ok(())
    }
}

// 递归清理已登记的失效工作树目录，将目录缺失视为已完成。
fn remove_registered_stale_worktree_dir(target_path: &Path) -> Result<String, String> {
    let Some(metadata) = worktree_root_metadata(target_path)? else {
        return Ok("stale_registered_worktree_path_missing".to_string());
    };
    if unsafe_worktree_link(&metadata) || !metadata.is_dir() {
        return Err("worktree_path_not_directory".to_string());
    }
    remove_worktree_path_with_retry(target_path, |path| fs::remove_dir_all(path))?;
    Ok("removed_stale_registered_worktree_dir".to_string())
}

// 清理已登记的失效工作树目录后执行 Git 注册信息清理。
fn cleanup_registered_stale_worktree_path(
    project_path: &Path,
    target_path: &Path,
) -> Result<String, String> {
    let mut output = remove_registered_stale_worktree_dir(target_path)?;
    append_output_line(
        &mut output,
        &run_git_checked(project_path, ["worktree", "prune"])?,
    );
    Ok(output)
}

// 按路径判断工作树是否仍登记在 Git 中（忽略分支），用于 remove 成功后的残留校验。
fn worktree_path_registered(project_path: &Path, target_path: &Path) -> Result<bool, String> {
    let output = run_git_checked(project_path, ["worktree", "list", "--porcelain"])?;
    let target = normalize_path_for_compare(target_path);
    Ok(parse_worktree_list_entries(&output)
        .iter()
        .any(|entry| normalize_path_for_compare(&entry.path) == target))
}

/// Git 在工作树内存在悬空 junction（pnpm workspace 的 node_modules/@scope/pkg -> apps/...，
/// 被跟踪目标先被删导致悬空）时，`worktree remove --force` 可能以 exit 0 返回并已注销登记，
/// 却静默残留 node_modules 目录树。此前只信任退出码，前端随后删除 DB 记录，残留永久孤儿化。
/// 成功后若目录仍存在且路径已注销，则用文件系统兜底删除并 prune；仍在登记则报错避免误删。
fn cleanup_residual_worktree_dir_after_remove(
    project_path: &Path,
    target_path: &Path,
) -> Result<String, String> {
    let Some(metadata) = worktree_root_metadata(target_path)? else {
        return Ok(String::new());
    };
    if unsafe_worktree_link(&metadata) || !metadata.is_dir() {
        return Err("worktree_path_not_directory".into());
    }
    if worktree_path_registered(project_path, target_path)? {
        return Err("worktree_remove_incomplete".to_string());
    }
    remove_worktree_path_with_retry(target_path, |path| fs::remove_dir_all(path))?;
    let mut output = String::from("removed_residual_worktree_dir");
    append_output_line(
        &mut output,
        &run_git_checked(project_path, ["worktree", "prune"])?,
    );
    Ok(output)
}

// 通过完整本地分支引用判断分支是否存在。
fn branch_exists(project_path: &Path, branch: &str) -> Result<bool, String> {
    let branch_ref = format!("refs/heads/{branch}");
    let output = run_git_raw(project_path, ["rev-parse", "--verify", branch_ref.as_str()])?;
    Ok(output.success)
}

// 比较两个分支的文件名差异，判断是否存在内容差异。
fn has_branch_content_diff(
    project_path: &Path,
    base_branch: &str,
    worktree_branch: &str,
) -> Result<bool, String> {
    let output = run_git_checked(
        project_path,
        ["diff", "--name-only", base_branch, worktree_branch],
    )?;
    Ok(output.lines().any(|line| !line.trim().is_empty()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorktreeListEntry {
    path: PathBuf,
    branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorktreeRegistration {
    Matched,
    Mismatched,
    Missing,
}

// 解析 porcelain 工作树列表中的路径与本地分支对应关系。
fn parse_worktree_list_entries(output: &str) -> Vec<WorktreeListEntry> {
    let mut entries = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_branch: Option<String> = None;

    let flush = |entries: &mut Vec<WorktreeListEntry>,
                 path: &mut Option<PathBuf>,
                 branch: &mut Option<String>| {
        if let Some(path) = path.take() {
            entries.push(WorktreeListEntry {
                path,
                branch: branch.take(),
            });
        } else {
            let _ = branch.take();
        }
    };

    for line in output.lines() {
        if line.trim().is_empty() {
            flush(&mut entries, &mut current_path, &mut current_branch);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            flush(&mut entries, &mut current_path, &mut current_branch);
            current_path = Some(PathBuf::from(path));
            continue;
        }
        if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(branch.to_string());
        }
    }
    flush(&mut entries, &mut current_path, &mut current_branch);
    entries
}

// 尽力规范化路径并统一分隔符，在 Windows 下忽略大小写。
fn normalize_path_for_compare(path: &Path) -> String {
    let normalized_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut value = normalized_path.to_string_lossy().replace('\\', "/");
    while value.ends_with('/') && value.len() > 1 {
        value.pop();
    }
    if cfg!(target_os = "windows") {
        value.to_lowercase()
    } else {
        value
    }
}

// 按路径和分支的联合匹配区分登记吻合、错配与缺失。
fn classify_worktree_registration(
    entries: &[WorktreeListEntry],
    worktree_path: &Path,
    branch: &str,
) -> WorktreeRegistration {
    let target = normalize_path_for_compare(worktree_path);
    let mut path_found = false;
    let mut branch_found = false;

    for registered in entries {
        let same_path = normalize_path_for_compare(&registered.path) == target;
        let same_branch = registered.branch.as_deref() == Some(branch);
        if same_path && same_branch {
            return WorktreeRegistration::Matched;
        }
        path_found |= same_path;
        branch_found |= same_branch;
    }

    if path_found || branch_found {
        WorktreeRegistration::Mismatched
    } else {
        WorktreeRegistration::Missing
    }
}

// 读取 Git 工作树登记列表并分类指定路径与分支的对应关系。
fn worktree_registration(
    project_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> Result<WorktreeRegistration, String> {
    let output = run_git_checked(project_path, ["worktree", "list", "--porcelain"])?;
    Ok(classify_worktree_registration(
        &parse_worktree_list_entries(&output),
        worktree_path,
        branch,
    ))
}

// 读取目录首个条目，判断失效工作树目录是否为空。
fn is_empty_dir(path: &Path) -> Result<bool, String> {
    let mut entries =
        fs::read_dir(path).map_err(|e| format!("read_stale_worktree_dir_failed: {e}"))?;
    Ok(entries.next().is_none())
}

/// worktree 移除后，若其所在的根目录（如 `<project>-worktrees`）已空，顺手清掉，
/// 避免（尤其是批量）删除后残留一个空文件夹。`fs::remove_dir` 仅能删空目录，
/// 非空/出错都安全忽略；git 下次 `worktree add` 会通过 create_dir_all 自动重建根目录。
// 工作树移除后尽力删除已空的父目录，保留非空父目录。
fn cleanup_empty_worktree_parent(worktree_path: &Path) {
    if let Some(parent) = worktree_path.parent() {
        if is_empty_dir(parent).unwrap_or(false) {
            let _ = fs::remove_dir(parent);
        }
    }
}

// 仅清理未登记的空目录或缺失登记，并按请求删除残留分支。
fn cleanup_stale_unregistered_worktree(
    project_path: &Path,
    target_path: &Path,
    branch: &str,
    delete_branch: bool,
) -> Result<String, String> {
    let mut output = String::new();
    if let Some(metadata) = worktree_root_metadata(target_path)? {
        if unsafe_worktree_link(&metadata) || !metadata.is_dir() || !is_empty_dir(target_path)? {
            return Err("worktree_not_registered".to_string());
        }
        remove_worktree_path_with_retry(target_path, |path| fs::remove_dir(path))?;
        output.push_str("removed_stale_empty_worktree_dir");
    } else {
        output.push_str(&run_git_checked(project_path, ["worktree", "prune"])?);
    }

    if delete_branch && branch_exists(project_path, branch)? {
        append_output_line(
            &mut output,
            &run_git_checked(project_path, ["branch", "-D", branch])?,
        );
    }

    Ok(output.trim().to_string())
}

// 按锁文件及依赖目录判断是否建议安装 Node 或 Rust 依赖。
fn check_dependency_need(path: &Path) -> GitWorktreeDepsCheckResult {
    let node_modules_missing = !path.join("node_modules").exists();
    if path.join("pnpm-lock.yaml").exists() && node_modules_missing {
        return GitWorktreeDepsCheckResult {
            needs_install: true,
            command: Some("pnpm install".to_string()),
            reason: Some("pnpm-lock.yaml exists but node_modules is missing".to_string()),
        };
    }
    if path.join("yarn.lock").exists() && node_modules_missing {
        return GitWorktreeDepsCheckResult {
            needs_install: true,
            command: Some("yarn install".to_string()),
            reason: Some("yarn.lock exists but node_modules is missing".to_string()),
        };
    }
    if (path.join("package-lock.json").exists() || path.join("package.json").exists())
        && node_modules_missing
    {
        return GitWorktreeDepsCheckResult {
            needs_install: true,
            command: Some("npm install".to_string()),
            reason: Some("package.json exists but node_modules is missing".to_string()),
        };
    }
    if path.join("Cargo.toml").exists() && !path.join("target").exists() {
        return GitWorktreeDepsCheckResult {
            needs_install: true,
            command: Some("cargo fetch".to_string()),
            reason: Some("Cargo.toml exists but target is missing".to_string()),
        };
    }

    GitWorktreeDepsCheckResult {
        needs_install: false,
        command: None,
        reason: None,
    }
}

// 读取未合并文件名列表，命令启动失败时返回空列表。
fn conflict_files(project_path: &Path) -> Vec<String> {
    match run_git_raw(project_path, ["diff", "--name-only", "--diff-filter=U"]) {
        Ok(output) => output
            .stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn build_merge_result(
    merged: bool,
    output: String,
    conflict_files: Vec<String>,
    skipped: bool,
    skip_reason: Option<String>,
    stash_created: bool,
    stash_restored: bool,
    stash_reference: Option<String>,
    stash_restore_conflict_files: Vec<String>,
) -> GitWorktreeMergeResult {
    GitWorktreeMergeResult {
        merged,
        output,
        conflict_files,
        skipped,
        skip_reason,
        stash_created,
        stash_restored,
        stash_reference,
        stash_restore_conflict_files,
    }
}

// 将强制合并的稳定错误码与 Git 最终错误尾部及 stash 身份组合返回。
fn format_force_merge_error(code: &str, detail: &str, stash_reference: Option<&str>) -> String {
    let detail = git_create_error_snippet(detail);
    let stash = stash_reference
        .map(|reference| format!("; stash={reference}"))
        .unwrap_or_default();
    if detail.is_empty() {
        format!("{code}{stash}")
    } else {
        format!("{code}: {detail}{stash}")
    }
}

// 应用本次强制合并创建的 stash；冲突保留现场，非冲突失败返回错误。
fn restore_force_merge_stash(
    project_path: &Path,
    stash_reference: &str,
) -> Result<(bool, Vec<String>, String), String> {
    let restore_output = run_git_raw(project_path, ["stash", "apply", "--index", stash_reference])?;
    let combined = restore_output.combined();
    if restore_output.success {
        return Ok((true, Vec::new(), combined));
    }

    let files = conflict_files(project_path);
    if !files.is_empty() {
        return Ok((false, files, combined));
    }

    Err(format!(
        "stash apply failed: {}",
        git_create_error_snippet(&combined)
    ))
}

// 在 checkout/merge 失败后恢复主工作区；恢复冲突或失败时禁止继续清理。
fn restore_force_merge_after_failure(
    project_path: &Path,
    output: &mut String,
    primary_code: &str,
    primary_error: &str,
    stash_reference: Option<&str>,
) -> String {
    let Some(stash_reference) = stash_reference else {
        return format_force_merge_error(primary_code, primary_error, None);
    };

    match restore_force_merge_stash(project_path, stash_reference) {
        Ok((true, _, restore_output)) => {
            append_output_line(output, &restore_output);
            format_force_merge_error(primary_code, primary_error, Some(stash_reference))
        }
        Ok((false, files, restore_output)) => {
            append_output_line(output, &restore_output);
            let detail = format!(
                "{primary_code}: {primary_error}; restore_conflict_files={}",
                files.join(", ")
            );
            format_force_merge_error("force_merge_restore_failed", &detail, Some(stash_reference))
        }
        Err(restore_error) => {
            let detail = format!("{primary_code}: {primary_error}; {restore_error}");
            format_force_merge_error("force_merge_restore_failed", &detail, Some(stash_reference))
        }
    }
}

fn merge_worktree_internal(
    project_path: &str,
    worktree_branch: &str,
    base_branch: &str,
    allow_dirty: bool,
) -> Result<GitWorktreeMergeResult, String> {
    merge_worktree_observed(
        project_path,
        worktree_branch,
        base_branch,
        allow_dirty,
        |_, _| Ok(()),
    )
}

fn merge_worktree_observed<F>(
    project_path: &str,
    worktree_branch: &str,
    base_branch: &str,
    allow_dirty: bool,
    mut observe: F,
) -> Result<GitWorktreeMergeResult, String>
where
    F: FnMut(&str, Option<&str>) -> Result<(), String>,
{
    let repo = open_main_repo(project_path)?;
    let current_branch = current_branch_name(&repo)?;
    let project_path = local_path_from_input(project_path)
        .canonicalize()
        .map_err(|e| format!("canonicalize_project_path_failed: {e}"))?;

    // 普通合并保留原有顺序：先检查主工作区，脏时不触碰分支和 Git 状态。
    if !allow_dirty {
        let status = run_git_checked(&project_path, ["status", "--porcelain"])?;
        if !status.trim().is_empty() {
            return Err("dirty_main_worktree".to_string());
        }
    }

    if !branch_exists(&project_path, base_branch)? {
        return Err("branch_not_found".to_string());
    }
    if !branch_exists(&project_path, worktree_branch)? {
        return Err("worktree_branch_not_found".to_string());
    }
    if !has_branch_content_diff(&project_path, base_branch, worktree_branch)? {
        return Ok(build_merge_result(
            false,
            format!(
                "merge_skipped: no_diff_between {} and {}",
                base_branch, worktree_branch
            ),
            Vec::new(),
            true,
            Some("no_diff".to_string()),
            false,
            false,
            None,
            Vec::new(),
        ));
    }

    let mut output = String::new();
    let mut stash_reference = None;
    let main_is_dirty = if allow_dirty {
        let status = run_git_checked(&project_path, ["status", "--porcelain"])?;
        !status.trim().is_empty()
    } else {
        false
    };

    if allow_dirty && main_is_dirty {
        observe("stash_intent", None)?;
        let stash_message = format!("{FORCE_MERGE_STASH_MESSAGE_PREFIX}: {worktree_branch}");
        let stash_output = run_git_raw(
            &project_path,
            [
                "stash",
                "push",
                "--include-untracked",
                "--message",
                stash_message.as_str(),
            ],
        )
        .map_err(|error| format_force_merge_error("force_merge_stash_failed", &error, None))?;
        if !stash_output.success {
            return Err(format_force_merge_error(
                "force_merge_stash_failed",
                &stash_output.combined(),
                None,
            ));
        }
        append_output_line(&mut output, &stash_output.combined());

        let stash_oid = run_git_checked(&project_path, ["rev-parse", "--verify", "refs/stash"])
            .map(|value| value.trim().to_string())
            .map_err(|error| {
                format_force_merge_error("force_merge_stash_reference_failed", &error, None)
            })?;
        if stash_oid.is_empty() {
            return Err(format_force_merge_error(
                "force_merge_stash_reference_failed",
                "empty stash reference",
                None,
            ));
        }
        stash_reference = Some(stash_oid);
        observe("stash_pending", stash_reference.as_deref())?;

        let status_after_stash = run_git_checked(&project_path, ["status", "--porcelain"])
            .map_err(|error| {
                format_force_merge_error(
                    "force_merge_stash_incomplete",
                    &error,
                    stash_reference.as_deref(),
                )
            })?;
        if !status_after_stash.trim().is_empty() {
            return Err(format_force_merge_error(
                "force_merge_stash_incomplete",
                &status_after_stash,
                stash_reference.as_deref(),
            ));
        }
    }

    observe("merge_intent", stash_reference.as_deref())?;
    if current_branch != base_branch {
        match run_git_checked(&project_path, ["checkout", base_branch]) {
            Ok(checkout_output) => {
                if allow_dirty {
                    append_output_line(&mut output, &checkout_output);
                }
            }
            Err(checkout_error) if allow_dirty => {
                return Err(restore_force_merge_after_failure(
                    &project_path,
                    &mut output,
                    "force_merge_checkout_failed",
                    &checkout_error,
                    stash_reference.as_deref(),
                ));
            }
            Err(checkout_error) => return Err(checkout_error),
        }
    }

    let merge_output = match run_git_raw(
        &project_path,
        ["merge", "--no-ff", "--no-edit", worktree_branch],
    ) {
        Ok(output) => output,
        Err(error) if allow_dirty => {
            return Err(restore_force_merge_after_failure(
                &project_path,
                &mut output,
                "force_merge_failed",
                &error,
                stash_reference.as_deref(),
            ));
        }
        Err(error) => return Err(error),
    };
    let merge_detail = merge_output.combined();
    append_output_line(&mut output, &merge_detail);

    if merge_output.success {
        observe("merged", stash_reference.as_deref())?;
        if let Some(stash_reference) = stash_reference.as_deref() {
            let (stash_restored, restore_conflicts, restore_output) =
                restore_force_merge_stash(&project_path, stash_reference).map_err(|error| {
                    format_force_merge_error(
                        "force_merge_restore_failed",
                        &error,
                        Some(stash_reference),
                    )
                })?;
            append_output_line(&mut output, &restore_output);
            return Ok(build_merge_result(
                true,
                output,
                Vec::new(),
                false,
                None,
                true,
                stash_restored,
                Some(stash_reference.to_string()),
                restore_conflicts,
            ));
        }

        return Ok(build_merge_result(
            true,
            if allow_dirty { output } else { merge_detail },
            Vec::new(),
            false,
            None,
            false,
            false,
            None,
            Vec::new(),
        ));
    }

    let files = conflict_files(&project_path);
    if !allow_dirty {
        if !files.is_empty() {
            let _ = run_git_raw(&project_path, ["merge", "--abort"]);
            return Ok(build_merge_result(
                false,
                format!("merge_conflict: {merge_detail}"),
                files,
                false,
                None,
                false,
                false,
                None,
                Vec::new(),
            ));
        }

        let _ = run_git_raw(&project_path, ["merge", "--abort"]);
        let snippet: String = merge_detail.chars().take(300).collect();
        return Err(format!("merge_failed: {snippet}"));
    }

    let abort_output = run_git_raw(&project_path, ["merge", "--abort"]).map_err(|error| {
        format_force_merge_error(
            "force_merge_abort_failed",
            &error,
            stash_reference.as_deref(),
        )
    })?;
    let abort_detail = abort_output.combined();
    append_output_line(&mut output, &abort_detail);
    if !abort_output.success {
        return Err(format_force_merge_error(
            "force_merge_abort_failed",
            &abort_detail,
            stash_reference.as_deref(),
        ));
    }

    let Some(stash_reference) = stash_reference.as_deref() else {
        if !files.is_empty() {
            return Ok(build_merge_result(
                false,
                output,
                files,
                false,
                None,
                false,
                false,
                None,
                Vec::new(),
            ));
        }
        return Err(format_force_merge_error(
            "force_merge_failed",
            &merge_detail,
            None,
        ));
    };

    match restore_force_merge_stash(&project_path, stash_reference) {
        Ok((stash_restored, restore_conflicts, restore_output)) => {
            append_output_line(&mut output, &restore_output);
            if !stash_restored && !restore_conflicts.is_empty() {
                return Ok(build_merge_result(
                    false,
                    output,
                    files,
                    false,
                    None,
                    true,
                    false,
                    Some(stash_reference.to_string()),
                    restore_conflicts,
                ));
            }
            if files.is_empty() {
                return Err(format_force_merge_error(
                    "force_merge_failed",
                    &merge_detail,
                    Some(stash_reference),
                ));
            }
            return Ok(build_merge_result(
                false,
                output,
                files,
                false,
                None,
                true,
                stash_restored,
                Some(stash_reference.to_string()),
                restore_conflicts,
            ));
        }
        Err(restore_error) => {
            let detail = format!("{merge_detail}; {restore_error}");
            return Err(format_force_merge_error(
                "force_merge_restore_failed",
                &detail,
                Some(stash_reference),
            ));
        }
    }
}

#[tauri::command]
// 在线程池检查路径是否为支持的本地主仓库根目录。
pub async fn git_worktree_validate(project_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        if is_wsl_path(&project_path) {
            return Ok(false);
        }
        let path = local_path_from_input(&project_path);
        if !path.exists() || !path.is_dir() {
            return Ok(false);
        }
        Ok(open_main_repo(&project_path).is_ok())
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[tauri::command]
// 基于当前 HEAD 创建 wt/ 分支工作树，并尽力同步 Trellis 身份。
pub async fn git_worktree_create(
    req: GitWorktreeCreateRequest,
) -> Result<GitWorktreeCreateResult, String> {
    validate_task_name(&req.task_name)?;
    tokio::task::spawn_blocking(move || create::create(req))
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[tauri::command]
// 校验工作树为受支持的本地目录后返回依赖安装建议。
pub async fn git_worktree_check_deps(
    worktree_path: String,
) -> Result<GitWorktreeDepsCheckResult, String> {
    ensure_supported_local_path(&worktree_path)?;
    tokio::task::spawn_blocking(move || {
        let path = local_path_from_input(&worktree_path);
        if !path.exists() {
            return Err("path_not_found".to_string());
        }
        if !path.is_dir() {
            return Err("path_not_directory".to_string());
        }
        Ok(check_dependency_need(&path))
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[tauri::command]
// 检查主工作区清洁和分支差异后合并工作树分支，冲突时尝试中止。
pub async fn git_worktree_merge(
    project_path: String,
    worktree_branch: String,
    base_branch: String,
) -> Result<GitWorktreeMergeResult, String> {
    validate_worktree_branch(&worktree_branch)?;
    validate_plain_branch_name(&base_branch)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        merge_worktree_internal(&project_path, &worktree_branch, &base_branch, false)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[tauri::command]
// 强制保存主工作区改动后合并，并在每个失败边界恢复原改动。
pub async fn git_worktree_force_merge(
    project_path: String,
    worktree_branch: String,
    base_branch: String,
) -> Result<GitWorktreeMergeResult, String> {
    validate_worktree_branch(&worktree_branch)?;
    validate_plain_branch_name(&base_branch)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        merge_worktree_internal(&project_path, &worktree_branch, &base_branch, true)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

// Shared destructive-discard boundary: never delete main/ancestor/admin or traverse links.
fn validate_removal_target(project: &Path, target: &Path) -> Result<(), String> {
    let common = run_git_checked(
        project,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let t = normalize_path_for_compare(target);
    for protected in [project.to_path_buf(), local_path_from_input(common.trim())] {
        let p = normalize_path_for_compare(&protected);
        if t == p
            || p.starts_with(&(t.clone() + "/"))
            || (protected != project && t.starts_with(&(p + "/")))
        {
            return Err("finish_protected_path".into());
        }
    }
    let mut cursor = PathBuf::new();
    let plain_target = local_path_from_input(&path_to_git_arg(target));
    for component in plain_target.components() {
        if matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        ) {
            return Err("finish_unsafe_path".into());
        }
        cursor.push(component.as_os_str());
        if let Some(metadata) = worktree_root_metadata(&cursor)? {
            if unsafe_worktree_link(&metadata) {
                return Err("finish_unsafe_link".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
// 核对工作树路径与分支登记后删除工作树，并按请求清理分支和空父目录。
pub async fn git_worktree_remove(
    project_path: String,
    worktree_path: String,
    branch: String,
    delete_branch: bool,
) -> Result<String, String> {
    validate_worktree_branch(&branch)?;
    ensure_supported_local_path(&worktree_path)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        open_main_repo(&project_path)?;
        let project_path = local_path_from_input(&project_path)
            .canonicalize()
            .map_err(|e| format!("canonicalize_project_path_failed: {e}"))?;
        let target_path = local_path_from_input(&worktree_path);
        if !target_path.is_absolute() {
            return Err("worktree_path_not_absolute".to_string());
        }
        validate_removal_target(&project_path, &target_path)?;
        match worktree_registration(&project_path, &target_path, &branch)? {
            WorktreeRegistration::Matched => {}
            WorktreeRegistration::Mismatched => {
                return Err("worktree_branch_mismatch".to_string());
            }
            WorktreeRegistration::Missing => {
                let output = cleanup_stale_unregistered_worktree(
                    &project_path,
                    &target_path,
                    &branch,
                    delete_branch,
                )?;
                cleanup_empty_worktree_parent(&target_path);
                return Ok(output);
            }
        }

        let target_arg = path_to_git_arg(&target_path);
        let mut output = String::new();
        if worktree_root_metadata(&target_path)?.is_some() {
            match run_git_worktree_remove_with_retry(&project_path, target_arg.as_str()) {
                Ok(remove_output) => {
                    output.push_str(&remove_output);
                    append_output_line(
                        &mut output,
                        &cleanup_residual_worktree_dir_after_remove(&project_path, &target_path)?,
                    );
                }
                Err(err) if is_stale_worktree_remove_error(&err) => {
                    output.push_str(&cleanup_registered_stale_worktree_path(
                        &project_path,
                        &target_path,
                    )?);
                }
                Err(err) => return Err(err),
            }
        } else {
            output.push_str(&run_git_checked(&project_path, ["worktree", "prune"])?);
        }

        if delete_branch {
            append_output_line(
                &mut output,
                &run_git_checked(&project_path, ["branch", "-D", branch.as_str()])?,
            );
        }

        cleanup_empty_worktree_parent(&target_path);

        Ok(output.trim().to_string())
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[cfg(test)]
#[path = "worktree_tests.rs"]
mod tests;
