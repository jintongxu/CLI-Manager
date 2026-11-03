//! Physical desktop placement; keep the retained window's logical dimensions.
use tauri::{AppHandle, PhysicalPosition, WebviewWindow};

// Same physical pointer acquisition as translator/window.rs. Existing Win32 dep.
#[cfg(target_os = "windows")]
fn cursor_position(app: &AppHandle) -> Option<(i32, i32)> {
    use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut p = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut p) } != 0 {
        return Some((p.x, p.y));
    }
    app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32))
}
#[cfg(not(target_os = "windows"))]
fn cursor_position(app: &AppHandle) -> Option<(i32, i32)> {
    app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32))
}

#[derive(Clone, Copy)]
struct Area {
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
}
fn scale(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        1.0
    }
}
fn near_cursor(
    cursor: (i32, i32),
    size: (u32, u32),
    source_scale: f64,
    area: Option<Area>,
) -> (i32, i32) {
    let destination_scale = area.map_or(scale(source_scale), |a| scale(a.scale));
    let offset = (12.0 * destination_scale).round() as i64;
    let requested = (cursor.0 as i64 + offset, cursor.1 as i64 + offset);
    let Some(area) = area else {
        return (
            requested.0.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
            requested.1.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
        );
    };
    let ratio = destination_scale / scale(source_scale);
    let width = (size.0 as f64 * ratio).round() as u64;
    let height = (size.1 as f64 * ratio).round() as u64;
    let axis = |requested: i64, origin: i32, extent: u32, window: u64| {
        // Oversized windows anchor at the work-area origin without changing size.
        let max = origin as i64 + (extent as u64).saturating_sub(window) as i64;
        requested
            .clamp(origin as i64, max)
            .clamp(i32::MIN as i64, i32::MAX as i64) as i32
    };
    (
        axis(requested.0, area.origin.0, area.size.0, width),
        axis(requested.1, area.origin.1, area.size.1, height),
    )
}

pub(super) fn place_near_cursor(app: &AppHandle, window: &WebviewWindow) {
    let Some(cursor) = cursor_position(app) else {
        return;
    };
    // Containment uses the full monitor (cursor may be on the taskbar); placement
    // uses its WORK AREA, never its full screen. Do not use retained current_monitor.
    let monitor = app
        .monitor_from_point(cursor.0 as f64, cursor.1 as f64)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let area = monitor.map(|m| {
        let a = m.work_area();
        Area {
            origin: (a.position.x, a.position.y),
            size: (a.size.width, a.size.height),
            scale: m.scale_factor(),
        }
    });
    let Ok(size) = window.outer_size() else {
        return;
    };
    let (x, y) = near_cursor(
        cursor,
        (size.width, size.height),
        window.scale_factor().unwrap_or(1.0),
        area,
    );
    if window.set_position(PhysicalPosition::new(x, y)).is_err() {
        log::warn!("quick chat placement failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quick_chat_geometry_negative_origin_edges_work_area_and_oversize() {
        let area = Some(Area {
            origin: (-1920, -100),
            size: (1920, 1040),
            scale: 1.0,
        });
        assert_eq!(
            near_cursor((-1500, 100), (480, 640), 1.0, area),
            (-1488, 112)
        );
        assert_eq!(near_cursor((-1, 970), (480, 640), 1.0, area), (-480, 300));
        assert_eq!(
            near_cursor((-2000, -200), (480, 640), 1.0, area),
            (-1920, -100)
        );
        assert_eq!(
            near_cursor((-500, 600), (3000, 2000), 1.0, area),
            (-1920, -100)
        );
    }
    #[test]
    fn quick_chat_geometry_destination_dpi_offset_and_missing_monitor() {
        let area = Some(Area {
            origin: (1920, 0),
            size: (2560, 1400),
            scale: 2.0,
        });
        assert_eq!(near_cursor((2000, 20), (480, 640), 1.0, area), (2024, 44));
        assert_eq!(
            near_cursor((4479, 1399), (480, 640), 1.0, area),
            (3520, 120)
        );
        assert_eq!(near_cursor((-100, 50), (480, 640), 1.5, None), (-82, 68));
        assert_eq!(
            near_cursor((i32::MAX, i32::MAX), (480, 640), 1.0, None),
            (i32::MAX, i32::MAX)
        );
    }
}
