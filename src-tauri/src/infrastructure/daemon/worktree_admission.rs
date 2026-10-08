//! Daemon-wide launch fence: every transport's Create holds a reservation until launch ends.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
#[derive(Default)]
struct State {
    launches: HashMap<String, usize>,
    barriers: HashMap<String, (String, u64)>,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| Mutex::new(State::default()))
}
fn normalize(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let value = value
        .strip_prefix("//?/")
        .unwrap_or(&value)
        .trim_end_matches('/')
        .to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}
fn key(path: &str) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("worktree_admission_invalid_path".into());
    }
    // Canonicalize the extant ancestor, preserving absent checkout tails for release/recovery.
    let mut ancestor = path.clone();
    let mut tail = Vec::new();
    loop {
        match std::fs::symlink_metadata(&ancestor) {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                tail.push(
                    ancestor
                        .file_name()
                        .ok_or("worktree_admission_invalid_path")?
                        .to_os_string(),
                );
                ancestor = ancestor
                    .parent()
                    .ok_or("worktree_admission_invalid_path")?
                    .to_path_buf();
            }
            Err(e) => return Err(format!("worktree_admission_path_failed: {e}")),
        }
    }
    let mut normalized = ancestor
        .canonicalize()
        .map_err(|e| format!("worktree_admission_path_failed: {e}"))?;
    for part in tail.into_iter().rev() {
        normalized.push(part);
    }
    Ok(normalize(&normalized))
}
fn overlaps(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&(b.to_string() + "/")) || b.starts_with(&(a.to_string() + "/"))
}
pub(super) struct Launch {
    key: String,
}
impl Drop for Launch {
    fn drop(&mut self) {
        if let Ok(mut s) = state().lock() {
            if let Some(n) = s.launches.get_mut(&self.key) {
                *n -= 1;
                if *n == 0 {
                    s.launches.remove(&self.key);
                }
            }
        }
    }
}
pub(super) fn enter(cwd: Option<&str>) -> Result<Launch, String> {
    let cwd = cwd.map(str::to_string).unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .into()
    });
    let key = key(&cwd)?;
    let mut s = state()
        .lock()
        .map_err(|_| "worktree_admission_lock_failed")?;
    if s.barriers.keys().any(|p| overlaps(p, &key)) {
        return Err("worktree_cleanup_in_progress".into());
    }
    *s.launches.entry(key.clone()).or_default() += 1;
    Ok(Launch { key })
}
pub(super) fn control(path: &str, token: &str, action: &str, owner: u64) -> Result<(), String> {
    if token.len() != 36 || uuid::Uuid::parse_str(token).is_err() {
        return Err("worktree_admission_invalid_token".into());
    }
    let key = key(path)?;
    let mut s = state()
        .lock()
        .map_err(|_| "worktree_admission_lock_failed")?;
    match action {
        "acquire" => {
            if s.launches.keys().any(|p| overlaps(p, &key)) {
                return Err("worktree_launch_in_progress".into());
            }
            if s.barriers
                .iter()
                .any(|(p, t)| overlaps(p, &key) && (t.0 != token || t.1 != owner))
            {
                return Err("worktree_cleanup_in_progress".into());
            }
            if s.barriers.len() >= 64 && !s.barriers.contains_key(&key) {
                return Err("worktree_admission_limit".into());
            }
            s.barriers.insert(key, (token.into(), owner));
            Ok(())
        }
        "check" => {
            if s.barriers
                .get(&key)
                .is_some_and(|t| t.0 == token && t.1 == owner)
            {
                Ok(())
            } else {
                Err("worktree_admission_missing".into())
            }
        }
        "release" => {
            if s.barriers
                .get(&key)
                .is_some_and(|t| t.0 == token && t.1 == owner)
            {
                s.barriers.remove(&key);
            }
            // Idempotent cancellation never releases a mismatched owner/token.
            Ok(())
        }
        _ => Err("worktree_admission_invalid_action".into()),
    }
}
pub(super) fn disconnect(owner: u64) {
    if let Ok(mut s) = state().lock() {
        s.barriers.retain(|_, (_, id)| *id != owner);
    }
}
pub fn associated_cwd(root: &str, cwd: Option<&str>) -> Result<bool, String> {
    let Some(cwd) = cwd else {
        return Ok(false);
    };
    Ok(overlaps(&key(root)?, &key(cwd)?))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fence_covers_inflight_nested_other_window_and_other_checkout() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("task");
        let other = tmp.path().join("other");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&other).unwrap();
        std::fs::create_dir(root.join("nested")).unwrap();
        let root = root.to_str().unwrap();
        let token = uuid::Uuid::new_v4().to_string();
        control(root, &token, "release", 1).unwrap();
        control(root, &token, "release", 1).unwrap();
        let launch = enter(Some(root)).unwrap();
        assert_eq!(
            control(root, &token, "acquire", 1).unwrap_err(),
            "worktree_launch_in_progress"
        );
        drop(launch);
        control(root, &token, "acquire", 1).unwrap();
        assert!(enter(Some(root)).is_err());
        assert!(enter(Some(&format!("{root}/nested"))).is_err());
        assert!(enter(other.to_str()).is_ok());
        control(root, &uuid::Uuid::new_v4().to_string(), "release", 2).unwrap();
        control(root, &token, "check", 1).unwrap();
        control(root, &token, "release", 1).unwrap();
        control(root, &token, "release", 1).unwrap();
        assert!(enter(Some(root)).is_ok());
    }
}
