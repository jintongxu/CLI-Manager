//! 系统级全局热键：输入翻译 / 选中文本翻译 / 截图翻译。
//!
//! 热键由 Rust 侧注册（不经前端 IPC），因此应用在后台时同样生效。
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const DEFAULT_INPUT_HOTKEY: &str = "Alt+T";
pub const DEFAULT_SELECTION_HOTKEY: &str = "Ctrl+Alt+T";
pub const DEFAULT_SCREENSHOT_HOTKEY: &str = "Alt+S";

/// 主窗口内翻译浮窗的打开事件。
pub const EVENT_OPEN: &str = "translator:open";
/// 携带已捕获选区的打开事件，payload 为 `{ text: string }`。
pub const EVENT_OPEN_WITH_TEXT: &str = "translator:open-with-text";
/// 截图翻译入口事件。
pub const EVENT_SCREENSHOT: &str = "translator:screenshot";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyScope {
    Input,
    Selection,
    Screenshot,
}

impl HotkeyScope {
    pub fn as_str(self) -> &'static str {
        match self {
            HotkeyScope::Input => "input",
            HotkeyScope::Selection => "selection",
            HotkeyScope::Screenshot => "screenshot",
        }
    }
}

/// 单条热键的注册失败原因；界面据此提示冲突或非法键位。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyError {
    pub scope: String,
    pub hotkey: String,
    pub kind: String,
    pub raw: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HotkeyBindings {
    pub input: String,
    pub selection: String,
    pub screenshot: String,
}

impl Default for HotkeyBindings {
    fn default() -> Self {
        Self {
            input: DEFAULT_INPUT_HOTKEY.to_string(),
            selection: DEFAULT_SELECTION_HOTKEY.to_string(),
            screenshot: DEFAULT_SCREENSHOT_HOTKEY.to_string(),
        }
    }
}

impl HotkeyBindings {
    fn entries(&self) -> [(HotkeyScope, &str); 3] {
        [
            (HotkeyScope::Input, &self.input),
            (HotkeyScope::Selection, &self.selection),
            (HotkeyScope::Screenshot, &self.screenshot),
        ]
    }
}

/// 纯函数：把配置整理成待注册列表。空键表示禁用（跳过），重复键位只保留首个并报冲突。
pub fn plan_registrations(
    bindings: &HotkeyBindings,
) -> (Vec<(HotkeyScope, String)>, Vec<HotkeyError>) {
    let mut planned: Vec<(HotkeyScope, String)> = Vec::new();
    let mut errors: Vec<HotkeyError> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for (scope, raw) in bindings.entries() {
        let hotkey = raw.trim();
        if hotkey.is_empty() {
            continue;
        }
        let key = hotkey.to_lowercase();
        if seen.contains(&key) {
            errors.push(HotkeyError {
                scope: scope.as_str().to_string(),
                hotkey: hotkey.to_string(),
                kind: "duplicate".to_string(),
                raw: None,
            });
            continue;
        }
        seen.push(key);
        planned.push((scope, hotkey.to_string()));
    }
    (planned, errors)
}

fn classify(scope: HotkeyScope, hotkey: String, raw: String) -> HotkeyError {
    let normalized = raw.to_lowercase();
    let kind = if normalized.contains("already registered") || normalized.contains("already in use")
    {
        "conflict"
    } else if normalized.contains("parse") || normalized.contains("invalid") {
        "invalid"
    } else {
        "unknown"
    };
    HotkeyError {
        scope: scope.as_str().to_string(),
        hotkey,
        kind: kind.to_string(),
        raw: Some(raw),
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_trigger(app: &AppHandle, scope: HotkeyScope) {
    match scope {
        HotkeyScope::Input => {
            // 只弹独立浮窗，绝不把主窗口带到前台。
            if let Err(err) = super::window::toggle_translator_window(app) {
                log::warn!("translator window toggle failed: {err}");
            }
        }
        HotkeyScope::Selection => {
            // 选区必须在浮窗抢焦点之前抓取，否则读到的是本应用自己的内容。
            let captured = super::selection::capture_selected_text(app);
            match captured {
                Some(text) => {
                    if let Err(err) = super::window::show_translator_window(app, Some(text)) {
                        log::warn!("translator selection window failed: {err}");
                    }
                }
                None => log::debug!("translator selection hotkey: no selection captured"),
            }
        }
        HotkeyScope::Screenshot => {
            if let Err(err) = super::lifecycle::begin_capture(app) {
                log::warn!("translator capture failed: {err}");
            }
        }
    }
}

/// 注册全部全局热键；返回逐条失败信息而不是中断启动。
pub fn register_hotkeys(app: &AppHandle, bindings: &HotkeyBindings) -> Vec<HotkeyError> {
    let manager = app.global_shortcut();
    // Only release bindings this feature owns; never unregister another feature's/user's Escape.
    static REGISTERED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    let Ok(mut registered) = REGISTERED.lock() else {
        return Vec::new();
    };
    for hotkey in registered.drain(..) {
        if let Err(err) = manager.unregister(hotkey.as_str()) {
            log::warn!("translator hotkey unregister failed: {err}");
        }
    }

    let (planned, mut errors) = plan_registrations(bindings);
    for (scope, hotkey) in planned {
        let result = manager.on_shortcut(hotkey.as_str(), move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                handle_trigger(app, scope);
            }
        });
        if let Err(err) = result {
            errors.push(classify(scope, hotkey, err.to_string()));
        } else {
            registered.push(hotkey);
        }
    }
    for error in &errors {
        log::warn!(
            "translator hotkey registration issue: scope={} hotkey={} kind={}",
            error.scope,
            error.hotkey,
            error.kind
        );
    }
    errors
}

/// 启动时用默认键位注册；后续设置变更通过 `translator_set_hotkeys` 重新注册。
pub fn register_default_hotkeys(app: &AppHandle) {
    let errors = register_hotkeys(app, &HotkeyBindings::default());
    if errors.is_empty() {
        log::info!("translator global hotkeys registered");
    }
}

#[tauri::command]
pub async fn translator_set_hotkeys(
    window: tauri::WebviewWindow,
    bindings: HotkeyBindings,
) -> Result<Vec<HotkeyError>, String> {
    if window.label() != "main" {
        return Err("main_window_required".into());
    }
    Ok(register_hotkeys(&window.app_handle().clone(), &bindings))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bindings(input: &str, selection: &str, screenshot: &str) -> HotkeyBindings {
        HotkeyBindings {
            input: input.into(),
            selection: selection.into(),
            screenshot: screenshot.into(),
        }
    }

    #[test]
    fn defaults_are_registered_in_scope_order() {
        let (planned, errors) = plan_registrations(&HotkeyBindings::default());
        assert!(errors.is_empty());
        assert_eq!(
            planned,
            vec![
                (HotkeyScope::Input, "Alt+T".to_string()),
                (HotkeyScope::Selection, "Ctrl+Alt+T".to_string()),
                (HotkeyScope::Screenshot, "Alt+S".to_string()),
            ]
        );
    }

    #[test]
    fn blank_bindings_disable_a_hotkey_without_reporting_an_error() {
        let (planned, errors) = plan_registrations(&bindings("Alt+T", "   ", ""));
        assert!(errors.is_empty());
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].0, HotkeyScope::Input);
    }

    #[test]
    fn duplicate_bindings_keep_the_first_scope_and_report_the_rest() {
        // 大小写不同也算同一个键位，否则注册时才会暴露冲突。
        let (planned, errors) = plan_registrations(&bindings("Alt+T", "alt+t", "Alt+S"));
        assert_eq!(planned.len(), 2);
        assert_eq!(planned[0].0, HotkeyScope::Input);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].scope, "selection");
        assert_eq!(errors[0].kind, "duplicate");
    }

    #[test]
    fn registration_errors_are_classified_for_the_settings_ui() {
        assert_eq!(
            classify(
                HotkeyScope::Screenshot,
                "Alt+S".into(),
                "HotKey already registered".into()
            )
            .kind,
            "conflict"
        );
        assert_eq!(
            classify(
                HotkeyScope::Input,
                "Bogus".into(),
                "failed to parse shortcut".into()
            )
            .kind,
            "invalid"
        );
        assert_eq!(
            classify(
                HotkeyScope::Input,
                "Alt+T".into(),
                "platform exploded".into()
            )
            .kind,
            "unknown"
        );
    }
}
