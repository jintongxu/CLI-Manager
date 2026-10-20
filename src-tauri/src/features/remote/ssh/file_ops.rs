use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::Duration;

use crate::shell_resolver::{
    output_with_input_timeout_bounded, output_with_timeout, output_with_timeout_bounded,
};
use crate::ssh_transport::posix_quote;

use super::{ensure_non_interactive, validate_remote_path, SshConnectionSpec};

const MAX_DIRECT_REMOTE_FILE_BYTES: usize = 5 * 1024 * 1024;
const MAX_DIRECT_REMOTE_OUTPUT_BYTES: usize = 7 * 1024 * 1024;
const DIRECT_FILE_MAGIC: &str = "CLI_MANAGER_SSH_DIRECT_FILE/1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileEntry {
    name: String,
    path: String,
    kind: String,
    size_bytes: u64,
    modified_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryEntry {
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectFileRead {
    relative_path: String,
    kind: String,
    content: String,
    size_bytes: u64,
    modified_ms: Option<i64>,
    truncated: bool,
}

fn validate_relative(path: &str) -> Result<&str, String> {
    let path = path.trim().trim_matches('/');
    if path.is_empty()
        || path.contains(['\0', '\n', '\r', '\\'])
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("ssh_remote_path_invalid".to_string());
    }
    Ok(path)
}

fn remote_parent_path(root: &str, relative: &str) -> Result<String, String> {
    let root = validate_remote_path(root)?.trim_end_matches('/');
    let relative = relative.trim().trim_matches('/');
    if relative.is_empty() {
        return Ok(root.to_string());
    }
    if relative.contains(['\0', '\n', '\r', '\\'])
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("ssh_remote_path_invalid".to_string());
    }
    Ok(format!("{root}/{relative}"))
}

fn remote_file_path(root: &str, relative: &str) -> Result<(String, String), String> {
    let root = validate_remote_path(root)?.trim_end_matches('/');
    let relative = validate_relative(relative)?.to_string();
    Ok((format!("{root}/{relative}"), relative))
}

fn local_upload_path(path: &str) -> Result<std::path::PathBuf, String> {
    if path.is_empty() || path.chars().any(char::is_control) || !Path::new(path).is_absolute() {
        return Err("ssh_local_file_invalid".to_string());
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "ssh_local_file_unavailable".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("ssh_local_file_invalid".to_string());
    }
    if metadata.len() > MAX_DIRECT_REMOTE_FILE_BYTES as u64 {
        return Err("ssh_remote_file_too_large".to_string());
    }
    Ok(Path::new(path).to_path_buf())
}

fn mime(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn error(stderr: &[u8], fallback: &str) -> String {
    let detail = String::from_utf8_lossy(stderr).to_string();
    let detail = detail.lines().next().unwrap_or_default().trim();
    if detail.is_empty() {
        fallback.to_string()
    } else {
        detail.to_string()
    }
}

#[tauri::command]
pub async fn ssh_create_entry(
    spec: SshConnectionSpec,
    root_path: String,
    parent_path: String,
    name: String,
    kind: String,
    overwrite: bool,
) -> Result<serde_json::Value, String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    if name.trim().is_empty()
        || name.contains(['\0', '\n', '\r', '/', '\\'])
        || matches!(name.trim(), "." | "..")
    {
        return Err("invalid_name".to_string());
    }
    if !matches!(kind.as_str(), "file" | "directory") {
        return Err("remote_file_kind_invalid".to_string());
    }
    let parent = remote_parent_path(&root_path, &parent_path)?;
    let target = format!("{parent}/{}", name.trim());
    let quoted = posix_quote(&target);
    let exists = if overwrite {
        ""
    } else {
        "if [ -e \"$path\" ] || [ -L \"$path\" ]; then exit 73; fi; "
    };
    let action = if kind == "directory" {
        "mkdir -p -- \"$path\""
    } else {
        "mkdir -p -- \"$(dirname \"$path\")\"; : > \"$path\""
    };
    let script = format!("set -eu; path={quoted}; {exists}{action}; printf '%s' {quoted}");
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(10).min(310));
    let output =
        tauri::async_runtime::spawn_blocking(move || output_with_timeout(command, timeout))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(if output.status.code() == Some(73) {
            "target_exists".into()
        } else {
            error(&output.stderr, "ssh_remote_file_create_failed")
        });
    }
    Ok(serde_json::json!({ "path": String::from_utf8_lossy(&output.stdout).trim(), "kind": kind }))
}

#[tauri::command]
pub async fn ssh_read_file(
    spec: SshConnectionSpec,
    root_path: String,
    relative_path: String,
) -> Result<SshDirectFileRead, String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    let (remote_path, relative_path) = remote_file_path(&root_path, &relative_path)?;
    let script = format!(
        r#"set -eu; path={}; if [ ! -f "$path" ] || [ -L "$path" ]; then exit 66; fi; size=$(wc -c < "$path" | tr -d '[:space:]'); mtime=$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path"); if [ "$size" -gt {} ]; then exit 67; fi; printf '%s\n%s\n%s\n' '{}' "$size" "$mtime"; base64 "$path" | tr -d '\n'"#,
        posix_quote(&remote_path),
        MAX_DIRECT_REMOTE_FILE_BYTES,
        DIRECT_FILE_MAGIC,
    );
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(10).min(310));
    let output = tauri::async_runtime::spawn_blocking(move || {
        output_with_timeout_bounded(command, timeout, MAX_DIRECT_REMOTE_OUTPUT_BYTES)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("ssh_remote_file_read_failed".to_string());
    }
    if output.stdout_truncated {
        return Err("ssh_remote_file_too_large".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let mut lines = text.splitn(4, '\n').map(str::to_string);
    if lines.next().as_deref() != Some(DIRECT_FILE_MAGIC) {
        return Err("ssh_remote_file_read_invalid".to_string());
    }
    let size_bytes = lines
        .next()
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| "ssh_remote_file_read_invalid".to_string())?;
    let modified_ms = lines
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .map(|v| v.saturating_mul(1000));
    let data = general_purpose::STANDARD
        .decode(lines.next().unwrap_or_default())
        .map_err(|_| "ssh_remote_file_read_invalid".to_string())?;
    if data.len() as u64 != size_bytes {
        return Err("ssh_remote_file_read_invalid".to_string());
    }
    if let Some(mime) = mime(&relative_path) {
        return Ok(SshDirectFileRead {
            relative_path,
            kind: "image".into(),
            content: format!(
                "data:{mime};base64:{}",
                general_purpose::STANDARD.encode(data)
            ),
            size_bytes,
            modified_ms,
            truncated: false,
        });
    }
    let content = String::from_utf8(data).map_err(|_| "binary_file".to_string())?;
    Ok(SshDirectFileRead {
        relative_path,
        kind: "text".into(),
        content,
        size_bytes,
        modified_ms,
        truncated: false,
    })
}

#[tauri::command]
pub async fn ssh_write_file(
    spec: SshConnectionSpec,
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    if content.len() > MAX_DIRECT_REMOTE_FILE_BYTES {
        return Err("ssh_remote_file_too_large".into());
    }
    let (remote_path, _) = remote_file_path(&root_path, &relative_path)?;
    let script = format!(
        r#"set -eu; path={}; if [ -L "$path" ] || {{ [ -e "$path" ] && [ ! -f "$path" ]; }}; then exit 66; fi; cat > "$path""#,
        posix_quote(&remote_path)
    );
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(10).min(310));
    let output = tauri::async_runtime::spawn_blocking(move || {
        output_with_input_timeout_bounded(
            command,
            content.into_bytes(),
            timeout,
            8 * 1024,
            8 * 1024,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(error(&output.stderr, "ssh_remote_file_write_failed"))
    }
}

#[tauri::command]
pub async fn ssh_delete_file(
    spec: SshConnectionSpec,
    root_path: String,
    relative_path: String,
) -> Result<serde_json::Value, String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    let (remote_path, relative_path) = remote_file_path(&root_path, &relative_path)?;
    let script = format!(
        r#"set -eu; path={}; if [ ! -e "$path" ] && [ ! -L "$path" ]; then exit 66; fi; if [ -d "$path" ] && [ ! -L "$path" ]; then rm -rf -- "$path"; printf directory; else rm -f -- "$path"; printf file; fi"#,
        posix_quote(&remote_path)
    );
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(10).min(310));
    let output =
        tauri::async_runtime::spawn_blocking(move || output_with_timeout(command, timeout))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(error(&output.stderr, "ssh_remote_file_delete_failed"));
    }
    let kind = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !matches!(kind.as_str(), "file" | "directory") {
        return Err("ssh_remote_file_delete_invalid".into());
    }
    Ok(serde_json::json!({ "relativePath": relative_path, "kind": kind }))
}

#[tauri::command]
pub async fn ssh_put_file(
    spec: SshConnectionSpec,
    root_path: String,
    relative_directory: String,
    local_path: String,
) -> Result<String, String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    let local_path = local_upload_path(&local_path)?;
    let file_name = local_path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| "ssh_local_file_invalid".to_string())?;
    let directory = relative_directory.trim().trim_matches('/');
    let remote_relative_path = if directory.is_empty() {
        file_name.to_string()
    } else {
        format!("{directory}/{file_name}")
    };
    let (remote_path, _) = remote_file_path(&root_path, &remote_relative_path)?;
    let data = fs::read(&local_path).map_err(|_| "ssh_local_file_unavailable".to_string())?;
    let script = format!(
        r#"set -eu; path={}; if [ -L "$path" ] || {{ [ -e "$path" ] && [ ! -f "$path" ]; }}; then exit 66; fi; cat > "$path""#,
        posix_quote(&remote_path)
    );
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(15).min(315));
    let output = tauri::async_runtime::spawn_blocking(move || {
        output_with_input_timeout_bounded(command, data, timeout, 8 * 1024, 8 * 1024)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(remote_relative_path)
    } else {
        Err(error(&output.stderr, "ssh_remote_file_write_failed"))
    }
}

#[tauri::command]
pub async fn ssh_list_directories(
    spec: SshConnectionSpec,
    path: String,
) -> Result<Vec<SshDirectoryEntry>, String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    let path = validate_remote_path(&path)?.to_string();
    let script = format!(
        "find -- {} -mindepth 1 -maxdepth 1 -type d -print0",
        posix_quote(&path)
    );
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(10).min(310));
    let output =
        tauri::async_runtime::spawn_blocking(move || output_with_timeout(command, timeout))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(error(&output.stderr, "ssh_remote_directory_list_failed"));
    }
    let mut entries: Vec<SshDirectoryEntry> = output
        .stdout
        .split(|b| *b == 0)
        .filter(|v| !v.is_empty())
        .filter_map(|v| String::from_utf8(v.to_vec()).ok())
        .map(|entry_path| {
            let normalized = entry_path.trim_end_matches('/').to_string();
            let name = normalized
                .rsplit('/')
                .next()
                .unwrap_or(&normalized)
                .to_string();
            SshDirectoryEntry {
                name,
                path: normalized,
            }
        })
        .collect();
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub async fn ssh_list_file_entries(
    spec: SshConnectionSpec,
    path: String,
) -> Result<Vec<SshFileEntry>, String> {
    super::validate_spec(&spec)?;
    ensure_non_interactive(&spec)?;
    let path = validate_remote_path(&path)?.to_string();
    let script = format!(
        "find -- {} -mindepth 1 -maxdepth 1 -printf '%f\\0%y\\0%s\\0%T@\\0'",
        posix_quote(&path)
    );
    let command = super::ssh_remote_command(&spec, &script)?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.saturating_add(10).min(310));
    let output =
        tauri::async_runtime::spawn_blocking(move || output_with_timeout(command, timeout))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(error(&output.stderr, "ssh_remote_file_list_failed"));
    }
    let fields: Vec<&[u8]> = output
        .stdout
        .split(|b| *b == 0)
        .filter(|v| !v.is_empty())
        .collect();
    let mut entries = Vec::new();
    for chunk in fields.chunks_exact(4) {
        let name = String::from_utf8_lossy(chunk[0]).into_owned();
        let kind = match chunk[1].first().copied() {
            Some(b'd') => "directory",
            Some(b'f') => "file",
            _ => continue,
        };
        let size_bytes = String::from_utf8_lossy(chunk[2]).parse().unwrap_or(0);
        let modified_ms = String::from_utf8_lossy(chunk[3])
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
            .map(|v| (v * 1000.0) as i64);
        entries.push(SshFileEntry {
            name: name.clone(),
            path: name,
            kind: kind.into(),
            size_bytes,
            modified_ms,
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}
