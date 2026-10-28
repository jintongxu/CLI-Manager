use serde::Serialize;
use sha2::{Digest, Sha256};
use ssh2::{FileStat, OpenFlags, OpenType, Session, Sftp};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::Emitter;

use super::{validate_remote_path, SshConnectionSpec};

const MAX_SFTP_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const SFTP_TRANSFER_CHUNK_BYTES: usize = 256 * 1024;
const SFTP_PART_SUFFIX: &str = ".cli-manager.part";
const SFTP_PART_METADATA_SUFFIX: &str = ".cli-manager.part.json";

fn upload_cancellations() -> &'static Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpFileEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: String,
    pub size_bytes: u64,
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpPartMetadata {
    pub remote_path: String,
    pub local_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub transfer_id: String,
    #[serde(default)]
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpOrphanPart {
    pub remote_path: String,
    pub part_path: String,
    pub local_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub uploaded_bytes: u64,
    pub transfer_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpFileRead {
    pub relative_path: String,
    pub kind: String,
    pub content: String,
    pub size_bytes: u64,
    pub modified_ms: Option<i64>,
    pub truncated: bool,
}

fn error(fallback: &str) -> String {
    fallback.to_string()
}

struct ResolvedTarget {
    host: String,
    port: u16,
    username: String,
    identity_file: Option<String>,
}

fn resolve_target(spec: &SshConnectionSpec) -> Result<ResolvedTarget, String> {
    if spec.auth_mode != "ssh_config" && spec.config_alias.trim().is_empty() {
        return Ok(ResolvedTarget {
            host: spec.host.trim().to_string(),
            port: if spec.port == 0 { 22 } else { spec.port },
            username: spec.username.trim().to_string(),
            identity_file: None,
        });
    }
    let alias = if spec.config_alias.trim().is_empty() {
        spec.host.trim()
    } else {
        spec.config_alias.trim()
    };
    let mut command = std::process::Command::new("ssh");
    command.args(["-G", alias]);
    if !spec.config_file.trim().is_empty() {
        command.args(["-F", spec.config_file.trim()]);
    }
    let output = command.output().map_err(|_| "ssh_config_resolve_failed")?;
    if !output.status.success() {
        return Err("ssh_config_resolve_failed".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let value = |key: &str| {
        text.lines().find_map(|line| {
            line.strip_prefix(&format!("{key} "))
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        })
    };
    Ok(ResolvedTarget {
        host: value("hostname").unwrap_or_else(|| spec.host.trim().to_string()),
        port: value("port")
            .and_then(|v| v.parse().ok())
            .unwrap_or(if spec.port == 0 { 22 } else { spec.port }),
        username: value("user")
            .or_else(|| {
                (!spec.username.trim().is_empty()).then(|| spec.username.trim().to_string())
            })
            .ok_or("ssh_username_required")?,
        identity_file: value("identityfile").filter(|v| v != "/dev/null"),
    })
}

fn connect(spec: &SshConnectionSpec) -> Result<(Session, Sftp), String> {
    super::validate_spec(spec)?;
    if !spec.jump_target.trim().is_empty()
        || spec.proxy_type != "none"
        || !spec.proxy_command.trim().is_empty()
    {
        return Err("ssh_sftp_route_unsupported".into());
    }
    let resolved = resolve_target(spec)?;
    let address = (resolved.host.as_str(), resolved.port)
        .to_socket_addrs()
        .map_err(|_| "ssh_sftp_connect_failed")?
        .next()
        .ok_or("ssh_sftp_connect_failed")?;
    let timeout = Duration::from_secs(spec.connect_timeout_sec.clamp(1, 300));
    let tcp =
        TcpStream::connect_timeout(&address, timeout).map_err(|_| "ssh_sftp_connect_failed")?;
    let mut session = Session::new().map_err(|_| "ssh_sftp_connect_failed")?;
    session.set_timeout(timeout.as_millis().min(u32::MAX as u128) as u32);
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|_| "ssh_sftp_handshake_failed")?;
    authenticate(&session, spec, &resolved)?;
    let sftp = session
        .sftp()
        .map_err(|_| "ssh_sftp_subsystem_unavailable")?;
    Ok((session, sftp))
}

fn authenticate(
    session: &Session,
    spec: &SshConnectionSpec,
    resolved: &ResolvedTarget,
) -> Result<(), String> {
    let username = resolved.username.trim();
    match spec.auth_mode.as_str() {
        "identity_file" => session
            .userauth_pubkey_file(username, None, Path::new(spec.identity_file.trim()), None)
            .map_err(|_| "ssh_authentication_failed".to_string())?,
        "ssh_config" if resolved.identity_file.is_some() => session
            .userauth_pubkey_file(
                username,
                None,
                Path::new(resolved.identity_file.as_deref().unwrap()),
                None,
            )
            .map_err(|_| "ssh_authentication_failed".to_string())?,
        "agent" | "ssh_config" => session
            .userauth_agent(username)
            .map_err(|_| "ssh_authentication_failed".to_string())?,
        "credential_ref" | "password_prompt" => {
            let reference = spec.credential_ref.trim();
            let password = crate::credential_store::get(reference)
                .map_err(|_| "ssh_credential_missing".to_string())?
                .filter(|v| !v.is_empty())
                .ok_or("ssh_credential_missing")?;
            session
                .userauth_password(username, &password)
                .map_err(|_| "ssh_authentication_failed".to_string())?;
        }
        "interactive" => return Err("ssh_interactive_auth_required".to_string()),
        _ => return Err("ssh_auth_mode_invalid".into()),
    }
    session
        .authenticated()
        .then_some(())
        .ok_or("ssh_authentication_failed".into())
}

fn validate_path(path: &str) -> Result<PathBuf, String> {
    let path = validate_remote_path(path)?.trim_end_matches('/');
    Ok(PathBuf::from(if path.is_empty() { "/" } else { path }))
}

fn modified_ms(stat: &FileStat) -> Option<i64> {
    stat.mtime
        .map(|seconds| (seconds as i64).saturating_mul(1000))
}

fn stat_kind(stat: &FileStat) -> &'static str {
    match stat.file_type() {
        ssh2::FileType::Directory => "directory",
        ssh2::FileType::RegularFile => "file",
        _ => "other",
    }
}

#[tauri::command]
pub async fn ssh_sftp_list(
    spec: SshConnectionSpec,
    path: String,
) -> Result<Vec<SftpFileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let path = validate_path(&path)?;
        let mut entries = sftp
            .readdir(&path)
            .map_err(|_| error("ssh_sftp_list_failed"))?
            .into_iter()
            .filter_map(|(entry_path, stat)| {
                let name = entry_path.file_name()?.to_string_lossy().into_owned();
                if name == "."
                    || name == ".."
                    || name.ends_with(SFTP_PART_SUFFIX)
                    || name.ends_with(SFTP_PART_METADATA_SUFFIX)
                {
                    return None;
                }
                Some(SftpFileEntry {
                    relative_path: name.clone(),
                    name,
                    kind: stat_kind(&stat).into(),
                    size_bytes: stat.size.unwrap_or(0),
                    modified_ms: modified_ms(&stat),
                })
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.name.to_lowercase());
        Ok(entries)
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_read(spec: SshConnectionSpec, path: String) -> Result<SftpFileRead, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let path_buf = validate_path(&path)?;
        let stat = sftp
            .stat(&path_buf)
            .map_err(|_| error("ssh_sftp_stat_failed"))?;
        let size = stat.size.unwrap_or(0);
        if size > MAX_SFTP_FILE_BYTES {
            return Err("ssh_remote_file_too_large".into());
        }
        let mut file = sftp
            .open(&path_buf)
            .map_err(|_| error("ssh_sftp_read_failed"))?;
        let mut data = Vec::with_capacity(size as usize);
        file.read_to_end(&mut data)
            .map_err(|_| error("ssh_sftp_read_failed"))?;
        let relative = path.trim_start_matches('/').to_string();
        let content = String::from_utf8(data).map_err(|_| "binary_file".to_string())?;
        Ok(SftpFileRead {
            relative_path: relative,
            kind: "text".into(),
            content,
            size_bytes: size,
            modified_ms: modified_ms(&stat),
            truncated: false,
        })
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_write(
    spec: SshConnectionSpec,
    path: String,
    content: String,
) -> Result<(), String> {
    if content.len() as u64 > MAX_SFTP_FILE_BYTES {
        return Err("ssh_remote_file_too_large".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let path_buf = validate_path(&path)?;
        let mut file = sftp
            .create(&path_buf)
            .map_err(|_| error("ssh_sftp_write_failed"))?;
        file.write_all(content.as_bytes())
            .map_err(|_| error("ssh_sftp_write_failed"))
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_mkdir(spec: SshConnectionSpec, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        sftp.mkdir(&validate_path(&path)?, 0o755)
            .map_err(|_| error("ssh_sftp_mkdir_failed"))
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_delete(
    spec: SshConnectionSpec,
    path: String,
    directory: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let path = validate_path(&path)?;
        if directory {
            sftp.rmdir(&path)
        } else {
            sftp.unlink(&path)
        }
        .map_err(|_| error("ssh_sftp_delete_failed"))
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_rename(
    spec: SshConnectionSpec,
    from: String,
    to: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        sftp.rename(&validate_path(&from)?, &validate_path(&to)?, None)
            .map_err(|_| error("ssh_sftp_rename_failed"))
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_list_orphan_parts(
    spec: SshConnectionSpec,
    path: String,
) -> Result<Vec<SftpOrphanPart>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let directory = validate_path(&path)?;
        let mut parts = Vec::new();
        for (entry_path, stat) in sftp
            .readdir(&directory)
            .map_err(|_| error("ssh_sftp_list_failed"))?
        {
            let name = match entry_path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
            {
                Some(value)
                    if value.ends_with(SFTP_PART_SUFFIX)
                        && !value.ends_with(SFTP_PART_METADATA_SUFFIX) =>
                {
                    value
                }
                _ => continue,
            };
            let target_name = name.trim_end_matches(SFTP_PART_SUFFIX);
            let target = directory.join(target_name);
            let metadata_path = PathBuf::from(format!("{}{}", entry_path.display(), ".json"));
            let metadata = sftp.open(&metadata_path).ok().and_then(|mut file| {
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes).ok()?;
                serde_json::from_slice::<SftpPartMetadata>(&bytes).ok()
            });
            parts.push(SftpOrphanPart {
                remote_path: target.to_string_lossy().into_owned(),
                part_path: entry_path.to_string_lossy().into_owned(),
                local_path: metadata
                    .as_ref()
                    .map(|value| value.local_path.clone())
                    .unwrap_or_default(),
                file_name: metadata
                    .as_ref()
                    .map(|value| value.file_name.clone())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| target_name.to_string()),
                size_bytes: metadata.as_ref().map(|value| value.size_bytes).unwrap_or(0),
                uploaded_bytes: stat.size.unwrap_or(0),
                transfer_id: metadata
                    .as_ref()
                    .map(|value| value.transfer_id.clone())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| format!("orphan:{}", target.to_string_lossy())),
            });
        }
        Ok(parts)
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_cleanup_upload(
    spec: SshConnectionSpec,
    remote_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let target = validate_path(&remote_path)?;
        let part = PathBuf::from(format!("{}{}", target.display(), SFTP_PART_SUFFIX));
        let metadata = PathBuf::from(format!("{}{}", target.display(), SFTP_PART_METADATA_SUFFIX));
        let _ = sftp.unlink(&part);
        let _ = sftp.unlink(&metadata);
        Ok(())
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}

fn sha256_local_file(path: &str) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "ssh_local_file_unavailable".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; SFTP_TRANSFER_CHUNK_BYTES];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "ssh_local_file_unavailable".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_remote_file(sftp: &Sftp, path: &Path) -> Result<String, String> {
    let mut file = sftp
        .open(path)
        .map_err(|_| "ssh_sftp_checksum_failed".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; SFTP_TRANSFER_CHUNK_BYTES];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "ssh_sftp_checksum_failed".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn ssh_sftp_resume_upload(
    app: tauri::AppHandle,
    spec: SshConnectionSpec,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<serde_json::Value, String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    upload_cancellations()
        .lock()
        .unwrap()
        .insert(transfer_id.clone(), cancellation.clone());
    let event_transfer_id = transfer_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let metadata = fs::metadata(&local_path).map_err(|_| "ssh_local_file_unavailable")?;
        let size = metadata.len();
        if !metadata.is_file() || size > MAX_SFTP_FILE_BYTES { return Err("ssh_local_file_invalid".into()); }
        let local_sha256 = sha256_local_file(&local_path)?;
        let (_session, sftp) = connect(&spec)?;
        let target = validate_path(&remote_path)?;
        if sftp.stat(&target).is_ok() {
            return Err("attachment_target_exists".into());
        }
        let part = PathBuf::from(format!("{}{}", target.display(), SFTP_PART_SUFFIX));
        let metadata_path = PathBuf::from(format!("{}{}", target.display(), SFTP_PART_METADATA_SUFFIX));
        let transfer_metadata = SftpPartMetadata {
            remote_path: target.to_string_lossy().into_owned(),
            local_path: local_path.clone(),
            file_name: target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
            size_bytes: size,
            transfer_id: event_transfer_id.clone(),
            sha256: local_sha256.clone(),
        };
        let metadata_bytes = serde_json::to_vec(&transfer_metadata).map_err(|_| "ssh_sftp_metadata_failed")?;
        let mut metadata_file = sftp.create(&metadata_path).map_err(|_| "ssh_sftp_metadata_failed")?;
        metadata_file.write_all(&metadata_bytes).map_err(|_| "ssh_sftp_metadata_failed")?;
        let mut completed = sftp.stat(&part).ok().and_then(|stat| stat.size).unwrap_or(0);
        if completed > size { let _ = sftp.unlink(&part); completed = 0; }
        let mut source = fs::File::open(&local_path).map_err(|_| "ssh_local_file_unavailable")?;
        source.seek(SeekFrom::Start(completed)).map_err(|_| "ssh_local_file_unavailable")?;
        let mut remote = sftp.open_mode(&part, OpenFlags::WRITE | OpenFlags::CREATE, 0o644, OpenType::File).map_err(|_| error("ssh_sftp_write_failed"))?;
        remote.seek(SeekFrom::Start(completed)).map_err(|_| error("ssh_sftp_write_failed"))?;
        let mut buffer = vec![0u8; SFTP_TRANSFER_CHUNK_BYTES];
        let mut written = completed;
        let _ = app.emit(&format!("ssh-sftp-progress-{event_transfer_id}"), serde_json::json!({ "bytesDone": completed, "bytesTotal": size }));
        loop {
            if cancellation.load(Ordering::Relaxed) { drop(remote); return Err("ssh_sftp_upload_cancelled".into()); }
            let count = source.read(&mut buffer).map_err(|_| "ssh_local_file_unavailable")?;
            if count == 0 { break; }
            remote.write_all(&buffer[..count]).map_err(|_| error("ssh_sftp_write_failed"))?;
            written += count as u64;
            let _ = app.emit(&format!("ssh-sftp-progress-{event_transfer_id}"), serde_json::json!({ "bytesDone": written, "bytesTotal": size }));
        }
        drop(remote);
        let remote_sha256 = sha256_remote_file(&sftp, &part)?;
        if remote_sha256 != local_sha256 { return Err("ssh_sftp_checksum_mismatch".into()); }
        sftp.rename(&part, &target, None).map_err(|_| error("ssh_sftp_rename_failed"))?;
        let _ = sftp.unlink(&metadata_path);
        Ok(serde_json::json!({ "path": target.to_string_lossy(), "sizeBytes": written, "resumedBytes": completed, "sha256": local_sha256, "verification": "verified" }))
    }).await.map_err(|_| "ssh_sftp_task_failed".to_string())?;
    upload_cancellations().lock().unwrap().remove(&transfer_id);
    result
}

#[tauri::command]
pub async fn ssh_sftp_cancel_upload(transfer_id: String) -> Result<(), String> {
    let cancellation = upload_cancellations()
        .lock()
        .unwrap()
        .get(&transfer_id)
        .cloned()
        .ok_or("ssh_sftp_upload_not_found")?;
    cancellation.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn ssh_sftp_download(
    app: tauri::AppHandle,
    spec: SshConnectionSpec,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&spec)?;
        let target = validate_path(&remote_path)?;
        let stat = sftp.stat(&target).map_err(|_| error("ssh_sftp_stat_failed"))?;
        let size = stat.size.unwrap_or(0);
        if size > MAX_SFTP_FILE_BYTES { return Err("ssh_remote_file_too_large".into()); }
        let temp_path = PathBuf::from(format!("{}{}", local_path, SFTP_PART_SUFFIX));
        let mut completed = fs::metadata(&temp_path).ok().map(|meta| meta.len()).unwrap_or(0);
        if completed > size { let _ = fs::remove_file(&temp_path); completed = 0; }
        let mut remote = sftp.open(&target).map_err(|_| error("ssh_sftp_read_failed"))?;
        remote.seek(SeekFrom::Start(completed)).map_err(|_| error("ssh_sftp_read_failed"))?;
        let mut local = fs::OpenOptions::new().create(true).write(true).open(&temp_path).map_err(|_| "ssh_local_file_write_failed")?;
        local.seek(SeekFrom::Start(completed)).map_err(|_| "ssh_local_file_write_failed")?;
        let mut buffer = vec![0u8; SFTP_TRANSFER_CHUNK_BYTES];
        let mut written = completed;
        loop { let count = remote.read(&mut buffer).map_err(|_| error("ssh_sftp_read_failed"))?; if count == 0 { break; } local.write_all(&buffer[..count]).map_err(|_| "ssh_local_file_write_failed")?; written += count as u64; let _ = app.emit(&format!("ssh-sftp-progress-{transfer_id}"), serde_json::json!({ "bytesDone": written, "bytesTotal": size })); }
        local.flush().map_err(|_| "ssh_local_file_write_failed")?;
        drop(local);
        fs::rename(&temp_path, &local_path).map_err(|_| "ssh_local_file_write_failed")?;
        Ok(serde_json::json!({ "path": local_path, "sizeBytes": written, "resumedBytes": completed }))
    }).await.map_err(|_| "ssh_sftp_task_failed".to_string())?
}

#[tauri::command]
pub async fn ssh_sftp_put(
    spec: SshConnectionSpec,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = fs::metadata(&local_path).map_err(|_| "ssh_local_file_unavailable")?;
        if !metadata.is_file() || metadata.len() > MAX_SFTP_FILE_BYTES {
            return Err("ssh_local_file_invalid".into());
        }
        let data = fs::read(&local_path).map_err(|_| "ssh_local_file_unavailable")?;
        let (_session, sftp) = connect(&spec)?;
        let mut file = sftp
            .create(&validate_path(&remote_path)?)
            .map_err(|_| error("ssh_sftp_write_failed"))?;
        file.write_all(&data)
            .map_err(|_| error("ssh_sftp_write_failed"))
    })
    .await
    .map_err(|_| "ssh_sftp_task_failed".to_string())?
}
