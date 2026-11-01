//! 独立翻译浮窗与截图框选窗口的生命周期管理。
//!
//! 两条链路都用独立 WebView 窗口而不是主窗口内弹层：输入翻译不应激活主应用，
//! 截图框选必须覆盖整个屏幕且不能把自己画进截图里。
use tauri::{
    webview::WebviewWindowBuilder, AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
};

pub const TRANSLATOR_WINDOW_LABEL: &str = "translator";
pub const CAPTURE_WINDOW_LABEL: &str = "translator-capture";
pub(super) static OPENING: std::sync::Mutex<super::sizing::Sizing> =
    std::sync::Mutex::new(super::sizing::Sizing::new());
static CAPTURE_INCARNATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

const TRANSLATOR_WIDTH: f64 = 460.0;
/// 初始高度对齐 Kivio（220px），收起状态下正好容纳卡片内容。
const TRANSLATOR_HEIGHT: f64 = 220.0;
/// 浮窗高度由前端按内容测量后回调，这里只做区间保护。
const TRANSLATOR_MIN_HEIGHT: f64 = 220.0;
const TRANSLATOR_MAX_HEIGHT: f64 = 520.0;
/// 浮窗相对鼠标的偏移，避免挡住用户刚选中的内容。
const CURSOR_OFFSET: i32 = 12;

fn transparent_window<'a>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    builder
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .visible(false)
}

pub(super) fn ensure_translator_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) {
        return Ok(window);
    }
    transparent_window(
        WebviewWindowBuilder::new(
            app,
            TRANSLATOR_WINDOW_LABEL,
            WebviewUrl::App("index.html#translator".into()),
        )
        .title("Translator")
        .inner_size(TRANSLATOR_WIDTH, TRANSLATOR_HEIGHT)
        // 高度由前端内容驱动（set_size 对非 resizable 窗口依然生效）；
        // 保持 resizable(false) 可避免边缘误拖和拖拽区双击最大化。
        .resizable(false)
        .maximizable(false)
        .minimizable(false),
    )
    .build()
    .map(|window| {
        window.on_window_event(|event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                if let Ok(mut state) = OPENING.lock() {
                    state.open(super::sizing::Mode::Input, String::new(), None);
                }
            }
        });
        window
    })
    .map_err(|err| format!("translator_window_build_failed: {err}"))
}

pub(super) fn ensure_capture_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        return Ok(window);
    }
    transparent_window(
        WebviewWindowBuilder::new(
            app,
            CAPTURE_WINDOW_LABEL,
            WebviewUrl::App("index.html#translator-capture".into()),
        )
        .title("Translator Capture")
        .inner_size(TRANSLATOR_WIDTH, TRANSLATOR_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(true),
    )
    .build()
    .map(|window| {
        let app = app.clone();
        let incarnation = CAPTURE_INCARNATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        window.on_window_event(move |event| {
            if incarnation == CAPTURE_INCARNATION.load(std::sync::atomic::Ordering::SeqCst)
                && matches!(
                    event,
                    tauri::WindowEvent::Focused(false)
                        | tauri::WindowEvent::CloseRequested { .. }
                        | tauri::WindowEvent::Destroyed
                )
            {
                super::lifecycle::cancel_for_window_event(&app, event);
            }
        });
        window
    })
    .map_err(|err| format!("capture_window_build_failed: {err}"))
}

/// 取桌面光标物理坐标。`AppHandle::cursor_position` 在部分环境下失败，Windows 直接问 Win32。
#[cfg(target_os = "windows")]
fn cursor_position(app: &AppHandle) -> Option<PhysicalPosition<i32>> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok != 0 {
        return Some(PhysicalPosition::new(point.x, point.y));
    }
    app.cursor_position()
        .ok()
        .map(|pos| PhysicalPosition::new(pos.x as i32, pos.y as i32))
}

#[cfg(not(target_os = "windows"))]
fn cursor_position(app: &AppHandle) -> Option<PhysicalPosition<i32>> {
    app.cursor_position()
        .ok()
        .map(|pos| PhysicalPosition::new(pos.x as i32, pos.y as i32))
}

/// 把浮窗放到鼠标附近，并夹取到光标所在显示器可视范围内。
pub(super) fn place_near_cursor(app: &AppHandle, window: &WebviewWindow) {
    let Some(cursor) = cursor_position(app) else {
        log::debug!("translator window: cursor position unavailable, keeping default placement");
        return;
    };
    let monitor = app.available_monitors().ok().and_then(|monitors| {
        monitors.into_iter().find(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            cursor.x >= origin.x
                && cursor.y >= origin.y
                && cursor.x < origin.x + size.width as i32
                && cursor.y < origin.y + size.height as i32
        })
    });

    let mut x = cursor.x + CURSOR_OFFSET;
    let mut y = cursor.y + CURSOR_OFFSET;
    if let Some(monitor) = monitor {
        let origin = monitor.position();
        let size = monitor.size();
        // The destination scale is authoritative before moving between DPI monitors.
        let actual = window
            .outer_size()
            .ok()
            .map(|v| {
                let ratio = monitor.scale_factor() / window.scale_factor().unwrap_or(1.0);
                (
                    (v.width as f64 * ratio).round() as u32,
                    (v.height as f64 * ratio).round() as u32,
                )
            })
            .unwrap_or((460, 220));
        (x, y) = super::sizing::clamp_physical(
            (x, y),
            actual,
            (origin.x, origin.y),
            (size.width, size.height),
        );
    }
    if let Err(err) = window.set_position(PhysicalPosition::new(x, y)) {
        log::warn!("translator window positioning failed: {err}");
    }
}

/// 显示输入翻译浮窗；`text` 非空时由前端事件填入并立即翻译。
pub fn show_translator_window(app: &AppHandle, text: Option<String>) -> Result<(), String> {
    let mut state = OPENING.lock().map_err(|_| "translator_state_poisoned")?;
    let opening = state.open(super::sizing::Mode::Input, text.unwrap_or_default(), None);
    show_opening(app, &opening)
}

fn show_opening(app: &AppHandle, opening: &super::sizing::Opening) -> Result<(), String> {
    use tauri::Emitter;
    let window = ensure_translator_window(app)?;
    let (width, height) = opening.mode.dimensions(0.0);
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    place_near_cursor(app, &window);
    clamp_position_to_monitor(&window);
    window
        .emit("translator:prefill", opening)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    place_near_cursor(app, &window);
    clamp_position_to_monitor(&window);
    Ok(())
}

pub(super) fn show_screenshot_loading(app: &AppHandle, expected: u64, id: u64,
    anchor: &super::card::Anchor, frame: &super::capture::ScreenCapture) -> Result<u64, String> {
    use tauri::Emitter;
    let mut state = OPENING.lock().map_err(|_| "translator_state_poisoned")?;
    let opening = state.loading(expected, id)?;
    let prepared = (|| -> Result<(), String> {
        let window = ensure_translator_window(app)?;
        let monitor = app.available_monitors().map_err(|e| e.to_string())?.into_iter()
            .find(|m| m.position().x == frame.origin_x && m.position().y == frame.origin_y)
            .ok_or("capture_monitor_unavailable")?;
        let scale = monitor.scale_factor();
        let bounds = (monitor.size().width, monitor.size().height);
        let (w, h) = super::sizing::monitor_dimensions(super::sizing::Mode::Screenshot, 300.0, bounds, scale);
        let size = ((w * scale).round() as u32, (h * scale).round() as u32);
        let (x, y) = super::card::place(anchor, size, (frame.origin_x, frame.origin_y), bounds, scale);
        window.set_size(tauri::PhysicalSize::new(size.0, size.1)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        window.emit("translator:prefill", &opening).map_err(|e| e.to_string())?;
        window.show().and_then(|_| window.set_focus()).map_err(|e| e.to_string())
    })();
    if let Err(error) = prepared {
        state.open(super::sizing::Mode::Input, String::new(), None);
        if let Some(w) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) { let _ = w.hide(); }
        return Err(error);
    }
    Ok(opening.generation)
}

pub(super) fn update_screenshot(app: &AppHandle, generation: u64, id: u64,
    image: Option<String>, result: Option<super::result::ScreenshotResult>, failed: bool) -> Result<(), String> {
    use tauri::Emitter;
    let mut state = OPENING.lock().map_err(|_| "translator_state_poisoned")?;
    let retained = image.clone();
    let opening = state.update_card(generation, id, image, result, failed)?;
    if let Some(image) = retained { state.crop = Some(image); }
    // Retain even if the event is lost. Never show, focus or reposition on update.
    if let Some(w) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) {
        let _ = w.emit("translator:prefill", &opening);
    }
    Ok(())
}

#[tauri::command]
pub fn translator_take_opening(window: WebviewWindow) -> Result<super::sizing::Opening, String> {
    if window.label() != TRANSLATOR_WINDOW_LABEL {
        return Err("translator_window_required".into());
    }
    Ok(OPENING
        .lock()
        .map_err(|_| "translator_state_poisoned")?
        .opening
        .clone())
}

/// 热键切换：可见则隐藏，否则显示。主窗口全程不参与。
pub fn toggle_translator_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            hide_translator_window(app);
            return Ok(());
        }
    }
    show_translator_window(app, None)
}

pub fn hide_translator_window(app: &AppHandle) {
    let _ = hide_for_capture(app);
}

/// Keep invalidation, native hide and its returned identity in the same opening transaction.
/// Otherwise a newer Alt+T can be hidden or accidentally adopted as a capture's baseline.
pub(super) fn hide_for_capture(app: &AppHandle) -> Result<u64, String> {
    let mut state = OPENING.lock().map_err(|_| "translator_state_poisoned")?;
    let opening = state.open(super::sizing::Mode::Input, String::new(), None);
    if let Some(window) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    if let Some(window) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) {
        use tauri::Emitter;
        let _ = window.emit("translator:prefill", &opening);
    }
    Ok(opening.generation)
}

// Called under SESSION; only a still-loading card from that capture may be hidden.
pub(super) fn cancel_screenshot(app: &AppHandle, id: u64) {
    use tauri::Emitter;
    let Ok(mut state) = OPENING.lock() else { return; };
    if !state.opening.card.as_ref().is_some_and(|c| c.session_id == id && c.phase == "loading") { return; }
    let opening = state.open(super::sizing::Mode::Input, String::new(), None);
    if let Some(w) = app.get_webview_window(TRANSLATOR_WINDOW_LABEL) {
        let _ = w.hide();
        let _ = w.emit("translator:prefill", &opening);
    }
}

/// 启动后预热两个隐藏浮窗，消除首次唤出时的 WebView2 冷启动（约 0.5~1.5s）。
pub fn prewarm_translator_windows(app: &AppHandle) {
    if let Err(err) = ensure_translator_window(app) {
        log::debug!("translator window prewarm skipped: {err}");
    }
    if let Err(err) = ensure_capture_window(app) {
        log::debug!("translator capture window prewarm skipped: {err}");
    }
}

#[tauri::command]
pub async fn translator_show(app: AppHandle, text: Option<String>) -> Result<(), String> {
    show_translator_window(&app, text)
}

#[tauri::command]
pub async fn translator_hide(app: AppHandle) -> Result<(), String> {
    hide_translator_window(&app);
    Ok(())
}

/// 前端 ResizeObserver 测量内容高度后回调：窗口跟着内容长高/变矮。
/// 宽度固定，高度只做区间保护；变更后重新夹取位置，避免向下超出屏幕。
#[tauri::command]
pub async fn translator_resize(
    window: WebviewWindow,
    height: f64,
    generation: u64,
    sequence: u64,
    mode: super::sizing::Mode,
) -> Result<(), String> {
    if window.label() != TRANSLATOR_WINDOW_LABEL {
        return Err("translator_window_required".into());
    }
    if !height.is_finite() {
        return Err("translator_resize_invalid_height".into());
    }
    let mut state = OPENING.lock().map_err(|_| "translator_state_poisoned")?;
    if !state.accept(generation, sequence, mode) {
        return Err("stale_translator_resize".into());
    }
    let bounded = if mode == super::sizing::Mode::Input {
        height.clamp(TRANSLATOR_MIN_HEIGHT, TRANSLATOR_MAX_HEIGHT)
    } else {
        height
    };
    let (mut width, mut height) = mode.dimensions(bounded);
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        (width, height) = super::sizing::monitor_dimensions(
            mode,
            bounded,
            (size.width, size.height),
            monitor.scale_factor(),
        );
    }
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| format!("translator_resize_failed: {e}"))?;
    if mode == super::sizing::Mode::Input { clamp_position_to_monitor(&window); }
    Ok(())
}

fn clamp_position_to_monitor(window: &WebviewWindow) {
    let (Ok(position), Ok(size), Ok(Some(monitor))) = (
        window.outer_position(),
        window.outer_size(),
        window.current_monitor(),
    ) else {
        return;
    };
    let origin = monitor.position();
    let bounds = monitor.size();
    let (x, y) = super::sizing::clamp_physical(
        (position.x, position.y),
        (size.width, size.height),
        (origin.x, origin.y),
        (bounds.width, bounds.height),
    );
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// 浮窗内“去配置模型”：才需要把主窗口带到前台并打开翻译设置。
#[tauri::command]
pub async fn translator_open_settings(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let label = window.label();
    if label != TRANSLATOR_WINDOW_LABEL && label != "main" {
        return Err("translator_window_required".into());
    }
    hide_translator_window(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        use tauri::Emitter;
        let _ = main.emit("translator:open-settings", ());
    }
    Ok(())
}
