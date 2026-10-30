use crate::daemon::{
    client::DaemonBridge,
    protocol::{ClientFrame, DaemonFrame},
    terminal_resources::{self, Snapshot},
};
#[tauri::command]
pub async fn terminal_resources_get_snapshot(
    window: tauri::Window,
    bridge: tauri::State<'_, DaemonBridge>,
    session_ids: Vec<String>,
) -> Result<Snapshot, String> {
    if window.label() != "main" {
        return Err(terminal_resources::NATIVE_ONLY.into());
    }
    let ids = terminal_resources::validate(session_ids)?;
    let (client, revision) = bridge
        .resource_client()
        .ok_or("terminal_resources_unsupported")?;
    if client.owner_binding().is_none()
        || !client
            .info()
            .features
            .iter()
            .any(|f| f == terminal_resources::FEATURE)
    {
        return Err("terminal_resources_unsupported".into());
    }
    let worker = client.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let id = worker.next_request_id();
        match worker.request(
            id,
            &ClientFrame::TerminalResources {
                id,
                session_ids: ids,
            },
        ) {
            Ok(DaemonFrame::TerminalResources { snapshot, .. }) => Ok(snapshot),
            Ok(DaemonFrame::Err { .. }) => Err("terminal_resources_owner_rejected".to_string()),
            _ => Err("terminal_resources_unavailable".to_string()),
        }
    })
    .await
    .map_err(|_| "terminal_resources_unavailable")?;
    if !bridge.resource_current(&client, revision) {
        return Err(terminal_resources::INVALIDATED.into());
    }
    result
}
