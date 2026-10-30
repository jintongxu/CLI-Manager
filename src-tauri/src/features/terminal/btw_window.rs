//! Native BTW transport: window identity is supplied by Tauri, never by JSON.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

const CHILD: &str = "btw-thread";
#[derive(Default)]
pub struct BtwWindowState(Mutex<Session>);
#[derive(Default)]
struct Session {
    epoch: Option<String>,
    revision: u64,
    command_session: u64,
    command_sequence: u64,
    snapshot: Option<serde_json::Value>,
    intents: Option<tauri::ipc::Channel<Intent>>,
}

// Shared IPC gate also rejects every unrelated application command from this reader.
pub fn child_command_allowed(label: &str, command: &str) -> bool {
    label != CHILD || matches!(command, "btw_window_ready" | "btw_window_intent")
}
fn require(label: &str, expected: &str) -> Result<(), String> {
    if label == expected {
        Ok(())
    } else {
        Err("btw_window_sender".into())
    }
}

// Register only after the main listener is installed; a new owner clears the previous epoch.
#[tauri::command]
pub fn btw_window_register(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    on_intent: tauri::ipc::Channel<Intent>,
) -> Result<String, String> {
    require(window.label(), "main")?;
    let epoch = uuid::Uuid::new_v4().to_string();
    let state = app.state::<BtwWindowState>();
    let mut session = state.0.lock().map_err(|_| "btw_window_lock")?;
    *session = Session {
        epoch: Some(epoch.clone()),
        intents: Some(on_intent),
        ..Session::default()
    };
    if let Some(child) = app.get_webview_window(CHILD) {
        child.hide().map_err(|_| "btw_window_hide")?;
        child
            .emit("btw-window-snapshot", serde_json::Value::Null)
            .map_err(|_| "btw_window_emit")?;
    }
    Ok(epoch)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ready {
    snapshot: Option<serde_json::Value>,
    command_session: u64,
}
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

// Cached replay makes refresh/late-ready independent of main React render scheduling.
#[tauri::command]
pub fn btw_window_ready(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Ready, String> {
    require(window.label(), CHILD)?;
    let state = app.state::<BtwWindowState>();
    let mut session = state.0.lock().map_err(|_| "btw_window_lock")?;
    if session.command_session >= MAX_SAFE_INTEGER {
        return Err("btw_window_sequence".into());
    }
    session.command_session += 1;
    session.command_sequence = 0;
    Ok(Ready {
        snapshot: session.snapshot.clone(),
        command_session: session.command_session,
    })
}

// Main publishes only the selected thread. Monotonic revisions fence reordered invoke calls.
#[tauri::command]
pub fn btw_window_publish(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
    reveal: bool,
) -> Result<(), String> {
    require(window.label(), "main")?;
    let state = app.state::<BtwWindowState>();
    let mut session = state.0.lock().map_err(|_| "btw_window_lock")?;
    let epoch = snapshot["ownerEpoch"].as_str().ok_or("btw_window_epoch")?;
    let revision = snapshot["revision"].as_u64().ok_or("btw_window_revision")?;
    if session.epoch.as_deref() != Some(epoch) || revision <= session.revision {
        return Ok(());
    }
    let child = app.get_webview_window(CHILD).ok_or("btw_window_missing")?;
    let theme = native_theme(&snapshot)?;
    if session
        .snapshot
        .as_ref()
        .and_then(|previous| previous["dark"].as_bool())
        != snapshot["dark"].as_bool()
    {
        child
            .set_theme(Some(theme))
            .map_err(|_| "btw_window_theme")?;
    }
    session.revision = revision;
    session.snapshot = Some(snapshot.clone());
    child
        .emit("btw-window-snapshot", snapshot.clone())
        .map_err(|_| "btw_window_emit")?;
    if snapshot["thread"].is_null() {
        child.hide().map_err(|_| "btw_window_hide")?;
    } else if reveal {
        child.show().map_err(|_| "btw_window_show")?;
        child.unminimize().map_err(|_| "btw_window_unminimize")?;
        child.set_focus().map_err(|_| "btw_window_focus")?;
    }
    Ok(())
}

fn native_theme(snapshot: &serde_json::Value) -> Result<tauri::Theme, String> {
    match snapshot["dark"].as_bool() {
        Some(true) => Ok(tauri::Theme::Dark),
        Some(false) => Ok(tauri::Theme::Light),
        None => Err("btw_window_theme_invalid".into()),
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Intent {
    command_session: u64,
    command_sequence: u64,
    owner_epoch: String,
    revision: u64,
    selection_revision: u64,
    thread_id: String,
    generation: u64,
    action: String,
    draft: Option<String>,
    inherit: Option<bool>,
}
// Validate before relay; payload cannot impersonate the native sender or target window.
#[tauri::command]
pub fn btw_window_intent(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    intent: Intent,
) -> Result<(), String> {
    require(window.label(), CHILD)?;
    if !valid_intent(&intent) {
        return Err("btw_window_intent".into());
    }
    let state = app.state::<BtwWindowState>();
    let mut session = state.0.lock().map_err(|_| "btw_window_lock")?;
    if session.epoch.as_deref() != Some(&intent.owner_epoch) || intent.revision > session.revision {
        return Err("btw_window_stale".into());
    }
    if !accept_sequence(&mut session, &intent) {
        return Err("btw_window_replay".into());
    }
    // Private IPC channel, not an event another frontend can emit/spoof.
    session
        .intents
        .as_ref()
        .ok_or("btw_window_owner_missing")?
        .send(intent)
        .map_err(|_| "btw_window_emit".into())
}
// Only the latest native handshake may send, including after child refresh.
fn accept_sequence(session: &mut Session, intent: &Intent) -> bool {
    if intent.command_session != session.command_session
        || intent.command_sequence <= session.command_sequence
    {
        return false;
    }
    session.command_sequence = intent.command_sequence;
    true
}
fn valid_intent(intent: &Intent) -> bool {
    intent.command_session > 0
        && intent.command_session <= MAX_SAFE_INTEGER
        && intent.command_sequence > 0
        && intent.command_sequence <= MAX_SAFE_INTEGER
        && intent.thread_id.len() <= 200
        && intent.owner_epoch.len() <= 200
        && matches!(
            intent.action.as_str(),
            "draft" | "send" | "retry" | "stop" | "reset" | "close"
        )
        && intent
            .draft
            .as_ref()
            .map_or(true, |draft| draft.len() <= 400_000)
        && (!matches!(intent.action.as_str(), "draft" | "send") || intent.draft.is_some())
        && (intent.action != "reset" || intent.inherit.is_some())
}

// Old owner cleanup must not invalidate its replacement.
#[tauri::command]
pub fn btw_window_release(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    owner_epoch: String,
) -> Result<(), String> {
    require(window.label(), "main")?;
    let state = app.state::<BtwWindowState>();
    let mut session = state.0.lock().map_err(|_| "btw_window_lock")?;
    if session.epoch.as_deref() != Some(&owner_epoch) {
        return Ok(());
    }
    *session = Session::default();
    if let Some(child) = app.get_webview_window(CHILD) {
        let _ = child.emit("btw-window-snapshot", serde_json::Value::Null);
        let _ = child.hide();
    }
    Ok(())
}

// Native close preserves the webview, selection, history and in-flight inference.
pub fn setup(app: &tauri::AppHandle) {
    if let Some(child) = app.get_webview_window(CHILD) {
        let handle = child.clone();
        child.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = handle.hide();
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_titlebar_tracks_snapshot_theme() {
        assert_eq!(
            native_theme(&serde_json::json!({"dark": true})).unwrap(),
            tauri::Theme::Dark
        );
        assert_eq!(
            native_theme(&serde_json::json!({"dark": false})).unwrap(),
            tauri::Theme::Light
        );
        assert!(native_theme(&serde_json::json!({"dark": "dark"})).is_err());
        assert!(native_theme(&serde_json::json!({})).is_err());
    }
    #[test]
    fn sender_authority_and_child_application_command_allowlist() {
        assert!(require("btw-thread", "main").is_err());
        assert!(require("desktop-pet", CHILD).is_err());
        for command in [
            "side_question_ask",
            "side_question_context",
            "app_exit",
            "pty_create",
            "btw_window_publish",
        ] {
            assert!(!child_command_allowed(CHILD, command));
        }
        assert!(child_command_allowed(CHILD, "btw_window_ready"));
        assert!(child_command_allowed(CHILD, "btw_window_intent"));
        assert!(child_command_allowed("main", "side_question_ask"));
    }
    #[test]
    fn bounded_sequence_fences_survive_budget_and_reader_replacement() {
        let mut session = Session {
            command_session: 1,
            ..Session::default()
        };
        let mut intent: Intent = serde_json::from_value(serde_json::json!({"commandSession":1,
            "commandSequence":1,"ownerEpoch":"e","revision":1,"selectionRevision":1,
            "threadId":"t","generation":0,"action":"stop"}))
        .unwrap();
        for sequence in 1..=100_001 {
            intent.command_sequence = sequence;
            assert!(accept_sequence(&mut session, &intent));
            assert!(!accept_sequence(&mut session, &intent));
        }
        intent.command_sequence = 1;
        assert!(!accept_sequence(&mut session, &intent));
        session.command_session = 2;
        session.command_sequence = 0;
        assert!(!accept_sequence(&mut session, &intent));
        intent.command_session = 2;
        assert!(accept_sequence(&mut session, &intent));
    }
    #[test]
    fn intents_reject_unknown_fields_actions_and_invalid_arguments() {
        let value = serde_json::json!({"commandSession":1,"commandSequence":1, "ownerEpoch":"e", "revision":1,
            "selectionRevision":1,"threadId":"t","generation":0,"action":"send","draft":"hello"});
        let intent: Intent = serde_json::from_value(value.clone()).unwrap();
        assert!(valid_intent(&intent));
        for (key, field) in [
            ("action", serde_json::json!("ask")),
            ("draft", serde_json::Value::Null),
            ("commandSession", serde_json::json!(0)),
            ("commandSequence", serde_json::json!(0)),
            ("commandSession", serde_json::json!(MAX_SAFE_INTEGER + 1)),
            ("commandSequence", serde_json::json!(MAX_SAFE_INTEGER + 1)),
        ] {
            let mut invalid = value.clone();
            invalid[key] = field;
            assert!(!valid_intent(&serde_json::from_value(invalid).unwrap()));
        }
        let mut spoof = value;
        spoof["sender"] = "main".into();
        assert!(serde_json::from_value::<Intent>(spoof).is_err());
    }
}
