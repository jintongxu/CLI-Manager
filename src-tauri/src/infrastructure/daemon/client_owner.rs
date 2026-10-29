//! Native ownership handshake; process-local capability cache survives transport reconnects only.
use super::protocol::*;
use std::collections::HashMap;
use std::io::{BufReader, Write};
use std::net::TcpStream;
use std::sync::{Mutex, OnceLock};

static BINDINGS: OnceLock<Mutex<HashMap<String, OwnerBinding>>> = OnceLock::new();

pub(super) fn released(token: &str, binding: &OwnerBinding) {
    if let Some(cache) = BINDINGS.get() {
        if let Ok(mut cache) = cache.lock() {
            if cache.get(token) == Some(binding) { cache.remove(token); }
        }
    }
}

pub(super) fn restore(token: &str, binding: &OwnerBinding) -> Result<(), String> {
    let mut cache = BINDINGS.get_or_init(|| Mutex::new(HashMap::new())).lock().map_err(|_| "owner_cache_unavailable")?;
    if cache.get(token).is_some_and(|current| current != binding) { return Err("owner_cache_identity_conflict".into()); }
    cache.insert(token.into(), binding.clone());
    Ok(())
}

pub(super) fn establish(features: &[String], daemon_token: &str, writer: &mut TcpStream,
    reader: &mut BufReader<TcpStream>) -> Result<Option<OwnerBinding>, String> {
    if !features.iter().any(|f| f == FEATURE_SESSION_OWNER) { return Ok(None); }
    let instance = InstanceId(uuid::Uuid::new_v4().to_string());
    let mut bindings = BINDINGS.get_or_init(|| Mutex::new(HashMap::new())).lock()
        .map_err(|_| "owner_cache_unavailable")?;
    let cached = bindings.get(daemon_token).cloned();
    let frame = match &cached {
        Some(binding) => ClientFrame::BindOwner { id: 0, binding: binding.clone() },
        None => ClientFrame::RegisterOwner { id: 0, instance_id: instance.clone() },
    };
    writer.write_all(encode_frame(&frame).as_bytes()).map_err(|_| "owner_handshake_write_failed")?;
    let line = super::client::read_line_bounded(reader).ok_or("owner_handshake_read_failed")?;
    match decode_daemon_frame(&line) {
        Ok(DaemonFrame::OwnerRegistered { binding, .. }) if cached.is_none() && binding.instance_id == instance => {
            bindings.insert(daemon_token.to_string(), binding.clone());
            Ok(Some(binding))
        }
        Ok(DaemonFrame::Ok { .. }) if cached.is_some() => Ok(cached),
        _ => Err("owner_handshake_rejected".to_string()),
    }
}
