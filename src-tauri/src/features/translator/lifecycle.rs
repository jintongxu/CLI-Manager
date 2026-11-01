//! Identity-fenced native overlay effects. No frontend-independent show path exists.
use super::{
    capture::ScreenCapture,
    session::{Phase, Session},
    window,
};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

static CAPTURE_OPENING: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static SESSION: Mutex<Session<ScreenCapture>> = Mutex::new(Session {
    next: 0,
    active: None,
});

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePayload {
    session_id: u64,
    capture: ScreenCapture,
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != window::CAPTURE_WINDOW_LABEL {
        return Err("capture_window_required".into());
    }
    Ok(())
}

// Hide is mandatory before clearing ownership; destroy is the fallback if native hide fails.
fn release(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(window::CAPTURE_WINDOW_LABEL) {
        if let Err(hide) = w.hide() {
            if let Err(destroy) = w.destroy() {
                // Last input-safety fallback; ownership remains Releasing and watchdog retries.
                let unblock = w.set_ignore_cursor_events(true);
                return Err(format!("capture_release_failed: {hide}; {destroy}; unblock: {unblock:?}"));
            }
        }
    }
    Ok(())
}

fn cancel_locked(app: &AppHandle, s: &mut Session<ScreenCapture>, id: u64) -> Result<(), String> {
    if !s.active.as_ref().is_some_and(|v| v.0 == id) {
        return Ok(());
    }
    let released = s.release_with(id, || release(app)).map(|_| ());
    if released.is_ok() {
        window::cancel_screenshot(app, id);
        let _ = app.emit_to(
            window::CAPTURE_WINDOW_LABEL,
            "translator:capture-changed",
            (),
        );
    }
    released
}

// Window events produced by our own hide/show must not re-enter the protocol mutex.
pub fn cancel_for_window_event(app: &AppHandle, event: &tauri::WindowEvent) {
    let Ok(mut s) = SESSION.try_lock() else {
        return;
    };
    if let Some((id, phase, _)) = s.active.as_ref() {
        let id = *id;
        let should_cancel = match event {
            tauri::WindowEvent::Focused(false) => {
                *phase == Phase::Selecting
                    && app
                        .get_webview_window(window::CAPTURE_WINDOW_LABEL)
                        .is_some_and(|w| !w.is_focused().unwrap_or(false))
            }
            _ => true,
        };
        if should_cancel {
            let _ = cancel_locked(app, &mut s, id);
        }
    }
}

// Never registers temporary Escape: polling leaves every user's global binding untouched.
#[cfg(target_os = "windows")]
fn escape_pressed() -> bool {
    unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x1B) < 0 }
}
#[cfg(not(target_os = "windows"))]
fn escape_pressed() -> bool {
    false
}

// Repeated hotkey cancels; watchdog covers capture worker, lost event and failed/hung JS.
pub fn begin_capture(app: &AppHandle) -> Result<Option<u64>, String> {
    let mut s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    if let Some((id, _, _)) = s.active.as_ref() {
        let id = *id;
        cancel_locked(app, &mut s, id)?;
        return Ok(None);
    }
    release(app)?;
    let id = s.trigger().unwrap();
    // SESSION -> OPENING is also the delivery lock order. Bind the baseline before another
    // capture can cancel/restart, and never adopt an intervening Alt+T generation.
    let generation = match window::hide_for_capture(app) {
        Ok(generation) => generation,
        Err(error) => {
            s.cancel(id);
            return Err(error);
        }
    };
    CAPTURE_OPENING.store(generation, std::sync::atomic::Ordering::SeqCst);
    drop(s);
    let started = Instant::now();
    let bounds = super::capture::cursor_monitor_bounds(app);
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(40));
        let expired = {
            let Ok(s) = SESSION.lock() else {
                break;
            };
            if !s.active.as_ref().is_some_and(|v| v.0 == id) {
                break;
            }
            s.should_abort(id, started.elapsed().as_millis() as u64, escape_pressed())
        };
        // All window API queries and mutations stay on the main thread, outside the worker lock.
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Ok(mut s) = SESSION.lock() {
                let lost_window = s.is(id, Phase::Selecting)
                    && !app
                        .get_webview_window(window::CAPTURE_WINDOW_LABEL)
                        .is_some_and(|w| {
                            w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)
                        });
                if expired || lost_window {
                    let _ = cancel_locked(&app, &mut s, id);
                }
            }
        });
        // Do not stop at the deadline: failed hide/destroy must retain a retrying watchdog.
    });
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        let frame = super::capture::capture_region(bounds);
        let app = handle.clone();
        let dispatch = handle.run_on_main_thread(move || {
            let Ok(mut s) = SESSION.lock() else {
                return;
            };
            if !s.is(id, Phase::Preparing) {
                return;
            }
            let prepared = (|| -> Result<(), String> {
                let capture = frame?;
                let w = window::ensure_capture_window(&app)?;
                w.set_size(PhysicalSize::new(capture.width, capture.height))
                    .map_err(|e| e.to_string())?;
                w.set_position(PhysicalPosition::new(capture.origin_x, capture.origin_y))
                    .map_err(|e| e.to_string())?;
                s.publish(id, capture);
                w.emit("translator:capture-changed", ())
                    .map_err(|e| e.to_string())
            })();
            if let Err(e) = prepared {
                log::warn!("capture preparation failed: {e}");
                let _ = cancel_locked(&app, &mut s, id);
            }
        });
        if dispatch.is_err() {
            // Nothing has been shown at this point; invalidate worker ownership without native calls.
            if let Ok(mut s) = SESSION.lock() {
                s.cancel(id);
            }
        }
    });
    Ok(Some(id))
}

// Subscribe first, then call this retained read to close cold-mount/event delivery races.
#[tauri::command]
pub fn translator_take_capture(window: WebviewWindow) -> Result<Option<CapturePayload>, String> {
    authorize(&window)?;
    let s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    Ok(s.read().map(|(session_id, capture)| CapturePayload {
        session_id,
        capture,
    }))
}

#[tauri::command]
pub fn translator_capture_begin(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<u64>, String> {
    if window.label() != "main" {
        return Err("main_window_required".into());
    }
    begin_capture(&app)
}

// The only show gate: retained frame + matching preparing identity + frontend decode/paint ACK.
#[tauri::command]
pub fn translator_capture_ready(
    app: AppHandle,
    window: WebviewWindow,
    session_id: u64,
) -> Result<(), String> {
    authorize(&window)?;
    let mut s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    let shown = s.ready_with(session_id, || {
        window
            .set_ignore_cursor_events(false)
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
            .map_err(|e| e.to_string())
    });
    match shown {
        Ok(true) => Ok(()),
        Ok(false) => Err("stale_capture_session".into()),
        Err(e) => {
            let _ = cancel_locked(&app, &mut s, session_id);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn translator_capture_end(
    app: AppHandle,
    window: WebviewWindow,
    session_id: u64,
) -> Result<(), String> {
    authorize(&window)?;
    let mut s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    cancel_locked(&app, &mut s, session_id)
}

// Resolve only after the fullscreen input interceptor has been hidden/destroyed.
#[tauri::command]
pub fn translator_capture_confirm(
    app: AppHandle, window: WebviewWindow, session_id: u64, anchor: super::card::Anchor,
) -> Result<u64, String> {
    authorize(&window)?;
    let mut s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    let frame = s.read().filter(|(id, _)| *id == session_id).map(|(_, frame)| frame)
        .ok_or("stale_capture_session")?;
    if let Err(error) = anchor.validate(&frame) {
        let _ = cancel_locked(&app, &mut s, session_id);
        return Err(error);
    }
    s.confirm_card_with(session_id, || release(&app), || {
        window::show_screenshot_loading(&app,
            CAPTURE_OPENING.load(std::sync::atomic::Ordering::SeqCst), session_id, &anchor, &frame)
    })?.ok_or_else(|| "stale_capture_session".into())
}

#[tauri::command]
pub fn translator_update_thumbnail(app: AppHandle, window: WebviewWindow,
    session_id: u64, generation: u64, image_base64: String) -> Result<(), String> {
    authorize(&window)?;
    let s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    if !s.is(session_id, Phase::Translating) { return Err("stale_capture_session".into()); }
    {
        let state = window::OPENING.lock().map_err(|_| "translator_storage")?;
        if state.authority.has_started() { return Err("translator_obsolete".into()); }
    }
    window::update_screenshot(&app, generation, session_id, Some(image_base64), None, false)
}

pub(super) fn validate_translation(session_id: u64, generation: u64) -> Result<(), String> {
    let s = SESSION.lock().map_err(|_| "capture_state_poisoned")?;
    let opening = window::OPENING.lock().map_err(|_| "translator_state_poisoned")?;
    if !s.is(session_id, Phase::Translating) || opening.opening.generation != generation
        || !opening.opening.card.as_ref().is_some_and(|c| c.session_id == session_id && c.phase == "loading") {
        return Err("stale_capture_session".into());
    }
    Ok(())
}

// Retire capture selection ownership after native completion; retry owns only opening+crop.
pub(super) fn finish_translation(session_id: u64) {
    if let Ok(mut s) = SESSION.lock() { s.finish(session_id); }
}

// Pre-submission crop/discovery failures carry no untrusted provider text or success payload.
#[tauri::command]
pub fn translator_capture_failed(app: AppHandle, window: WebviewWindow,
    session_id: u64, generation: u64) -> Result<(), String> {
    authorize(&window)?;
    let mut s = SESSION.lock().map_err(|_| "translator_storage")?;
    if !s.is(session_id, Phase::Translating) { return Err("translator_obsolete".into()); }
    let updated = window::update_screenshot(&app, generation, session_id, None, None, true);
    s.finish(session_id);
    updated
}
