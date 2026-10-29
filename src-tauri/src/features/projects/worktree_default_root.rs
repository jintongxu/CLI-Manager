//! 本机全局根策略；项目自定义根和历史 checkout 路径保持独立。
use super::*;
use sha2::{Digest, Sha256};

// 只读校验普通本地绝对路径；现有前缀必须可解析为目录，不创建目录或探测写权限。
pub(super) fn validate(root: &str) -> Result<String, String> {
    let root = root.trim();
    if root.is_empty() {
        return Ok(String::new());
    }
    let invalid = || "worktree_default_root_invalid".to_string();
    ensure_supported_local_path(root).map_err(|_| invalid())?;
    let path = local_path_from_input(root);
    if !path.is_absolute() || root.chars().any(char::is_control) {
        return Err(invalid());
    }
    let mut prefix = PathBuf::new();
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(invalid());
        }
        #[cfg(windows)]
        if let std::path::Component::Normal(name) = component {
            let name = name.to_string_lossy();
            let stem = name.split('.').next().unwrap_or("");
            if name.contains(['<', '>', ':', '"', '|', '?', '*'])
                || name.ends_with(['.', ' '])
                || RESERVED_WINDOWS_NAMES
                    .iter()
                    .any(|value| stem.eq_ignore_ascii_case(value))
            {
                return Err(invalid());
            }
        }
        prefix.push(component.as_os_str());
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&prefix) {
            Ok(_) => {
                let resolved = prefix.canonicalize().map_err(|_| invalid())?;
                ensure_supported_local_path(&path_to_git_arg(&resolved)).map_err(|_| invalid())?;
                if !fs::metadata(&resolved).map_err(|_| invalid())?.is_dir() {
                    return Err(invalid());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(invalid()),
        }
    }
    Ok(path_to_git_arg(&path))
}

// 默认目录查询不读取设置；home 错误原样传播，供前端恢复默认时提示。
pub(super) fn home_root(home: Result<PathBuf, String>) -> Result<PathBuf, String> {
    let home = home?;
    Ok(local_path_from_input(&validate(&path_to_git_arg(
        &home.join("Worktrees"),
    ))?))
}

// 仅缺失文件/字段或空字符串使用 home；损坏 JSON、非对象和错误类型不静默降级。
fn configured_root<F>(settings: &Path, home: F) -> Result<PathBuf, String>
where
    F: FnOnce() -> Result<PathBuf, String>,
{
    let bytes = match fs::read(settings) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // 悬空设置链接不是“缺失配置”，不能静默退回默认根。
            match fs::symlink_metadata(settings) {
                Err(missing) if missing.kind() == io::ErrorKind::NotFound => None,
                _ => return Err(format!("worktree_default_root_read_failed: {error}")),
            }
        }
        Err(error) => return Err(format!("worktree_default_root_read_failed: {error}")),
    };
    if let Some(bytes) = bytes {
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("worktree_default_root_read_failed: {error}"))?;
        let object = value
            .as_object()
            .ok_or("worktree_default_root_read_failed")?;
        if let Some(value) = object.get("worktreeDefaultRoot") {
            let root = value.as_str().ok_or("worktree_default_root_invalid")?;
            let root = validate(root)?;
            if !root.is_empty() {
                return Ok(local_path_from_input(&root));
            }
        }
    }
    home_root(home())
}

// 与 app_get_data_paths 使用相同活动文件；每次创建重新读取本机已落盘设置，不缓存。
pub(super) fn root(project: &Path) -> Result<PathBuf, String> {
    let settings = crate::app_paths::data_paths()
        .map_err(|error| format!("worktree_default_root_read_failed: {error}"))?
        .settings_store_path;
    let base = configured_root(Path::new(&settings), crate::app_paths::home_dir_from_env)?;
    root_in_global_dir(project, &base)
}

// Resolve existing prefixes (including junctions) before comparing not-yet-created paths.
fn resolved_path(path: &Path) -> Result<PathBuf, String> {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        resolved.push(component.as_os_str());
        if matches!(component, std::path::Component::Prefix(_)) {
            continue; // A Windows drive prefix alone (C:) is not an absolute directory.
        }
        match resolved.canonicalize() {
            Ok(path) => resolved = path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("canonicalize_worktree_root_failed: {error}")),
        }
    }
    Ok(resolved)
}

fn readable_name(name: &str) -> String {
    let name: String = name
        .chars()
        .take(40)
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let name = name.trim_matches(|ch: char| ch == '.' || ch.is_whitespace());
    if name.is_empty() {
        "repository".into()
    } else {
        name.into()
    }
}

// Git common-dir, not the selected linked checkout, defines the stable repository bucket.
// 创建目录前同时检查全局根和仓库桶，拒绝落入已登记 checkout/common-dir。
pub(super) fn root_in_global_dir(project: &Path, global_dir: &Path) -> Result<PathBuf, String> {
    ensure_supported_local_path(&path_to_git_arg(global_dir))?;
    let common = run_git_checked(
        project,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let common = local_path_from_input(common.trim())
        .canonicalize()
        .map_err(|error| format!("canonicalize_project_path_failed: {error}"))?;
    let entries = parse_worktree_list_entries(&run_git_checked(
        project,
        ["worktree", "list", "--porcelain"],
    )?);
    let name = entries
        .first()
        .and_then(|entry| entry.path.file_name())
        .unwrap_or_else(|| OsStr::new("repository"))
        .to_string_lossy();
    let digest = Sha256::digest(normalize_path_for_compare(&common).as_bytes());
    let bucket = format!("{}-{:x}", readable_name(&name), digest);
    let root = global_dir.join(bucket);
    let resolved_data = resolved_path(global_dir)?;
    let resolved_root = resolved_path(&root)?;
    for protected in entries
        .iter()
        .map(|entry| entry.path.as_path())
        .chain(std::iter::once(common.as_path()))
    {
        let protected = normalize_path_for_compare(&resolved_path(protected)?);
        for candidate in [&resolved_data, &resolved_root] {
            let candidate = normalize_path_for_compare(candidate);
            if candidate == protected || candidate.starts_with(&(protected.clone() + "/")) {
                return Err("worktree_default_root_inside_repository".into());
            }
        }
    }
    Ok(root)
}

#[cfg(test)]
#[path = "worktree_default_root_tests.rs"]
mod tests;
