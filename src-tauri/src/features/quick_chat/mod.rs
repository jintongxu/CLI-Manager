//! Authenticated presentation bridge. Existing chat IPC remains main-only.
mod placement;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const LABEL: &str = "quick-chat";
static MAIN_CHANNEL: std::sync::Mutex<Option<tauri::ipc::Channel<Envelope>>> =
    std::sync::Mutex::new(None);
static REMOTE_CHANNEL: std::sync::Mutex<Option<tauri::ipc::Channel<serde_json::Value>>> =
    std::sync::Mutex::new(None);
static WINDOW: std::sync::Mutex<()> = std::sync::Mutex::new(());
static HOTKEY: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn require(window: &WebviewWindow, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err("quick_chat_forbidden".into())
    }
}

pub fn toggle(app: &AppHandle) -> Result<(), String> {
    let _guard = WINDOW.lock().map_err(|_| "quick_chat_locked")?;
    let window = if let Some(w) = app.get_webview_window(LABEL) {
        w
    } else {
        let w = tauri::WebviewWindowBuilder::new(
            app,
            LABEL,
            tauri::WebviewUrl::App("index.html#quick-chat".into()),
        )
        .title("Quick Chat")
        .inner_size(480.0, 640.0)
        .min_inner_size(320.0, 360.0)
        .resizable(true)
        .decorations(false)
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
        let retained = w.clone();
        w.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = retained.hide();
            }
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut remote_ch) = REMOTE_CHANNEL.lock() {
                    *remote_ch = None;
                }
            }
        });
        w
    };
    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        return window.hide().map_err(|e| e.to_string());
    }
    placement::place_near_cursor(app, &window);
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())?;
    window
        .emit("quick-chat:focus", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_chat_configure(
    window: WebviewWindow,
    enabled: bool,
    shortcut: String,
) -> Result<(), String> {
    require(&window, "main")?;
    let app = window.app_handle();
    let mut owned = HOTKEY.lock().map_err(|_| "quick_chat_locked")?;
    if let Some(old) = owned.as_ref() {
        app.global_shortcut()
            .unregister(old.as_str())
            .map_err(|_| "quick_chat_shortcut_failed")?;
        *owned = None;
    }
    if enabled && !shortcut.trim().is_empty() {
        let key = shortcut.trim();
        if app.global_shortcut().is_registered(key) {
            return Err("quick_chat_shortcut_conflict_or_invalid".into());
        }
        app.global_shortcut()
            .on_shortcut(key, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    if let Err(error) = toggle(app) {
                        log::warn!("quick chat toggle: {error}");
                    }
                }
            })
            .map_err(|_| "quick_chat_shortcut_conflict_or_invalid")?;
        *owned = Some(key.into());
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Hello {},
    Create {},
    Continue {},
    Select {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    Stop {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    Draft {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        text: String,
    },
    Update {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "providerId")]
        provider_id: String,
        model: String,
    },
    Generate {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        retry: bool,
        reasoning: Reasoning,
        images: Vec<String>,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Reasoning {
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    id: String,
    epoch: Option<String>,
    seq: Option<u64>,
    command: Command,
}

#[tauri::command]
pub async fn quick_chat_command(window: WebviewWindow, envelope: Envelope) -> Result<(), String> {
    require(&window, LABEL)?;
    if envelope.id.is_empty() || envelope.id.len() > 128 {
        return Err("quick_chat_invalid_id".into());
    }
    if let Command::Generate { images, .. } = &envelope.command {
        if images.len() > 4
            || images
                .iter()
                .any(|i| i.len() > 9 * 1024 * 1024 || !i.starts_with("data:image/"))
        {
            return Err("quick_chat_invalid_images".into());
        }
    }
    MAIN_CHANNEL
        .lock()
        .map_err(|_| "quick_chat_locked")?
        .as_ref()
        .ok_or("quick_chat_not_ready")?
        .send(envelope)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_chat_connect_main(
    window: WebviewWindow,
    channel: tauri::ipc::Channel<Envelope>,
) -> Result<(), String> {
    require(&window, "main")?;
    *MAIN_CHANNEL.lock().map_err(|_| "quick_chat_locked")? = Some(channel);
    Ok(())
}
#[tauri::command]
pub async fn quick_chat_connect(
    window: WebviewWindow,
    channel: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    require(&window, LABEL)?;
    *REMOTE_CHANNEL.lock().map_err(|_| "quick_chat_locked")? = Some(channel);
    Ok(())
}

#[tauri::command]
pub async fn quick_chat_publish(
    window: WebviewWindow,
    kind: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    require(&window, "main")?;
    if !["snapshot", "ack"].contains(&kind.as_str()) {
        return Err("quick_chat_invalid_kind".into());
    }
    if let Some(channel) = REMOTE_CHANNEL
        .lock()
        .map_err(|_| "quick_chat_locked")?
        .as_ref()
    {
        channel
            .send(serde_json::json!({ "kind": kind, "payload": payload }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Each step is fallible: a failed reveal must leave quick chat available for retry.
fn continue_window<E>(
    show: impl FnOnce() -> Result<(), E>,
    unminimize: impl FnOnce() -> Result<(), E>,
    focus: impl FnOnce() -> Result<(), E>,
    hide: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    show()?;
    unminimize()?;
    focus()?;
    hide()
}

#[tauri::command]
pub async fn quick_chat_window(
    window: WebviewWindow,
    action: String,
    pinned: Option<bool>,
) -> Result<(), String> {
    require(&window, LABEL)?;
    match action.as_str() {
        "hide" => window.hide().map_err(|e| e.to_string()),
        "pin" => window
            .set_always_on_top(pinned.unwrap_or(false))
            .map_err(|e| e.to_string()),
        "drag" => window.start_dragging().map_err(|e| e.to_string()),
        "main" => {
            let main = window
                .app_handle()
                .get_webview_window("main")
                .ok_or("quick_chat_main_unavailable")?;
            continue_window(
                || main.show(),
                || main.unminimize(),
                || main.set_focus(),
                || window.hide(),
            )
            .map_err(|e| e.to_string())
        }
        _ => Err("quick_chat_invalid_action".into()),
    }
}

pub fn cleanup(app: &AppHandle) {
    cleanup_channels_and_hotkey(|key| {
        let _ = app.global_shortcut().unregister(key);
    });
    if let Some(target) = app.get_webview_window(LABEL) {
        let _ = target.destroy();
    }
}

pub fn cleanup_channels_and_hotkey(mut unregister: impl FnMut(&str)) {
    if let Ok(mut main_ch) = MAIN_CHANNEL.lock() {
        *main_ch = None;
    }
    if let Ok(mut remote_ch) = REMOTE_CHANNEL.lock() {
        *remote_ch = None;
    }
    if let Ok(mut hotkey) = HOTKEY.lock() {
        if let Some(key) = hotkey.take() {
            unregister(key.as_str());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_releases_channels_and_unregisters_hotkey() {
        {
            let mut hotkey = HOTKEY.lock().unwrap();
            *hotkey = Some("Ctrl+Shift+Q".into());
        }
        let mut unregistered = Vec::new();
        cleanup_channels_and_hotkey(|k| unregistered.push(k.to_string()));
        assert_eq!(unregistered, vec!["Ctrl+Shift+Q".to_string()]);
        assert!(HOTKEY.lock().unwrap().is_none());
        assert!(MAIN_CHANNEL.lock().unwrap().is_none());
        assert!(REMOTE_CHANNEL.lock().unwrap().is_none());
    }
    #[test]
    fn continuation_hides_only_after_successful_main_reveal() {
        use std::cell::RefCell;
        for failed_step in [None, Some(0), Some(1), Some(2), Some(3)] {
            let calls = RefCell::new(Vec::new());
            let step = |index| {
                calls.borrow_mut().push(index);
                if failed_step == Some(index) { Err("window_failed") } else { Ok(()) }
            };
            let result = continue_window(|| step(0), || step(1), || step(2), || step(3));
            assert_eq!(result.is_ok(), failed_step.is_none());
            let end = failed_step.unwrap_or(3);
            assert_eq!(*calls.borrow(), (0..=end).collect::<Vec<_>>());
        }
    }
    #[test]
    fn narrow_commands_reject_unknown_operations_and_reasoning() {
        assert!(
            serde_json::from_str::<Envelope>(r#"{"id":"a","command":{"op":"delete"}}"#).is_err()
        );
        assert!(serde_json::from_str::<Envelope>(
            r#"{"id":"a","command":{"op":"hello","credentials":true}}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Reasoning>(r#""extreme""#).is_err());
        // The extended scale must survive the narrow command envelope verbatim.
        for level in ["off", "minimal", "low", "medium", "high", "xhigh", "max"] {
            assert!(serde_json::from_str::<Reasoning>(&format!("\"{level}\"")).is_ok());
        }
        assert!(serde_json::from_str::<Envelope>(
            r#"{"id":"a","command":{"op":"draft","conversationId":"c","text":"hello"}}"#
        )
        .is_ok());
    }
}
