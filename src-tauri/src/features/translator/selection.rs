//! 前台应用选中文本捕获：模拟 Ctrl+C + 剪贴板快照还原。
//!
//! Windows 下不依赖 UI Automation，因此浏览器、Office、终端等任意应用都能命中；
//! 代价是短暂占用剪贴板，捕获结束后立即还原用户原有的文本内容。
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// 轮询剪贴板的总等待时间：太短会读不到目标应用的复制结果，太长会拖慢热键响应。
const CAPTURE_TIMEOUT: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(20);

/// 纯函数：判断捕获结果是否是一次有效的“新选区”。
/// 与快照相同说明目标应用没有响应复制（无选区或复制被拒绝），应视为未捕获。
pub fn selection_from_capture(snapshot: Option<&str>, captured: Option<&str>) -> Option<String> {
    let captured = captured?.trim();
    if captured.is_empty() {
        return None;
    }
    if snapshot.map(str::trim) == Some(captured) {
        return None;
    }
    Some(captured.to_string())
}

#[cfg(target_os = "windows")]
fn send_copy_shortcut() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_C,
    };

    fn key(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    // Ctrl 按下 → C 按下 → C 抬起 → Ctrl 抬起；顺序颠倒会让目标应用收到裸 C。
    let inputs = [
        key(VK_CONTROL, false),
        key(VK_C, false),
        key(VK_C, true),
        key(VK_CONTROL, true),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        log::warn!("translator selection: SendInput injected {sent}/{} events", inputs.len());
    }
}

#[cfg(not(target_os = "windows"))]
fn send_copy_shortcut() {
    log::warn!("translator selection capture is implemented for Windows only");
}

/// 捕获当前前台应用的选中文本；无选区或读取失败时返回 `None`。
pub fn capture_selected_text(app: &AppHandle) -> Option<String> {
    let clipboard = app.clipboard();
    let snapshot = clipboard.read_text().ok();
    send_copy_shortcut();

    let deadline = Instant::now() + CAPTURE_TIMEOUT;
    let mut captured: Option<String> = None;
    while Instant::now() < deadline {
        std::thread::sleep(POLL_INTERVAL);
        let current = clipboard.read_text().ok();
        if let Some(text) = selection_from_capture(snapshot.as_deref(), current.as_deref()) {
            captured = Some(text);
            break;
        }
    }

    // 只在确实改写了剪贴板时还原，避免覆盖用户在此期间的新复制内容。
    if let (Some(original), Some(captured_text)) = (snapshot.as_ref(), captured.as_ref()) {
        if original.trim() != captured_text {
            if let Err(err) = clipboard.write_text(original) {
                log::warn!("translator selection: clipboard restore failed: {err}");
            }
        }
    }

    captured
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_text_means_the_copy_never_reached_the_clipboard() {
        assert_eq!(selection_from_capture(Some("same"), Some("same")), None);
        assert_eq!(selection_from_capture(Some("  same "), Some("same")), None);
    }

    #[test]
    fn empty_or_missing_capture_is_treated_as_no_selection() {
        assert_eq!(selection_from_capture(None, None), None);
        assert_eq!(selection_from_capture(Some("before"), None), None);
        assert_eq!(selection_from_capture(None, Some("   ")), None);
    }

    #[test]
    fn a_new_non_empty_value_is_the_selection() {
        assert_eq!(
            selection_from_capture(None, Some(" hello ")),
            Some("hello".to_string())
        );
        assert_eq!(
            selection_from_capture(Some("before"), Some("after")),
            Some("after".to_string())
        );
    }
}
