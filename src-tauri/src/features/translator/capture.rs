//! Windows GDI 虚拟屏幕捕获与区域裁剪。
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::WebviewWindow;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapture {
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub image_base64: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 光标所在显示器的物理像素边界；无光标信息时回退主显示器。
pub fn cursor_monitor_bounds(app: &tauri::AppHandle) -> MonitorBounds {
    let cursor = app.cursor_position().ok();
    let monitors = app.available_monitors().unwrap_or_default();
    let picked = cursor.and_then(|cursor| {
        monitors.into_iter().find(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            let x = cursor.x as i32;
            let y = cursor.y as i32;
            x >= origin.x
                && y >= origin.y
                && x < origin.x + size.width as i32
                && y < origin.y + size.height as i32
        })
    });
    match picked.or_else(|| app.primary_monitor().ok().flatten()) {
        Some(monitor) => {
            let origin = monitor.position();
            let size = monitor.size();
            MonitorBounds {
                x: origin.x,
                y: origin.y,
                width: size.width,
                height: size.height,
            }
        }
        None => MonitorBounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
    }
}

/// 抓取指定物理像素区域并编码为极速 JPEG base64。
///
/// 全屏冻结帧仅用于用户在前端做框选的视觉背景；用 JPEG（85 质量）替代 PNG，
/// 实际捕获与编码耗时分段记录；不据编码格式推断用户机器上的延迟。
pub fn capture_region(bounds: MonitorBounds) -> Result<ScreenCapture, String> {
    let start = std::time::Instant::now();
    let (rgba, width, height) = capture_screen_region_raw(bounds)?;
    let captured = start.elapsed();
    let encode_start = std::time::Instant::now();
    let image_base64 = encode_fast_screen_base64(width, height, &rgba)?;
    log::debug!("capture timing: capture_ms={} encode_ms={}",
        captured.as_millis(), encode_start.elapsed().as_millis());
    Ok(ScreenCapture {
        width,
        height,
        origin_x: bounds.x,
        origin_y: bounds.y,
        image_base64,
    })
}

/// 快速将全屏 RGBA 编码为 JPEG Base64（带 data:image/jpeg;base64 前缀）。
pub fn encode_fast_screen_base64(width: u32, height: u32, rgba: &[u8]) -> Result<String, String> {
    if (width * height * 4) as usize != rgba.len() {
        return Err("Buffer size does not match dimensions".into());
    }
    use image::codecs::jpeg::JpegEncoder;
    let rgb = image::RgbImage::from_fn(width, height, |x, y| {
        let idx = ((y * width + x) * 4) as usize;
        image::Rgb([rgba[idx], rgba[idx + 1], rgba[idx + 2]])
    });
    let mut cursor = Cursor::new(Vec::with_capacity((width * height / 4) as usize));
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 85);
    encoder
        .encode_image(&rgb)
        .map_err(|e| format!("JPEG encoding error: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

#[cfg(target_os = "windows")]
pub fn capture_screen_region_raw(bounds: MonitorBounds) -> Result<(Vec<u8>, u32, u32), String> {
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };

    unsafe {
        let origin_x = bounds.x;
        let origin_y = bounds.y;
        let width = bounds.width;
        let height = bounds.height;
        if width == 0 || height == 0 {
            return Err("Invalid capture dimensions".into());
        }

        let hdc_screen = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() {
            return Err("Failed to get desktop DC".into());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbitmap = CreateCompatibleBitmap(hdc_screen, width as i32, height as i32);
        let h_old = SelectObject(hdc_mem, hbitmap);

        let blt_ok = BitBlt(
            hdc_mem,
            0,
            0,
            width as i32,
            height as i32,
            hdc_screen,
            origin_x,
            origin_y,
            SRCCOPY,
        );

        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            // 负数高度表示从上到下扫描（Top-down DIB），否则为倒置图像。
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: width * height * 4,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };

        let mut bgra_buf: Vec<u8> = vec![0u8; (width * height * 4) as usize];
        let lines_copied = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height,
            bgra_buf.as_mut_ptr() as *mut _,
            &mut bi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, h_old);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(std::ptr::null_mut(), hdc_screen);

        if blt_ok == 0 || lines_copied == 0 {
            return Err("Failed to copy virtual screen bitmap".into());
        }

        // BGRA 转换为 RGBA
        for pixel in bgra_buf.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        Ok((bgra_buf, width, height))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_screen_region_raw(_bounds: MonitorBounds) -> Result<(Vec<u8>, u32, u32), String> {
    Err("Screen capture is currently supported on Windows only".into())
}

/// 抓取整个虚拟屏幕（多显示器合并），保留给需要全屏快照的调用方。
pub fn capture_virtual_screen() -> Result<ScreenCapture, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN,
        };
        let bounds = unsafe {
            MonitorBounds {
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                width: GetSystemMetrics(SM_CXVIRTUALSCREEN).max(0) as u32,
                height: GetSystemMetrics(SM_CYVIRTUALSCREEN).max(0) as u32,
            }
        };
        return capture_region(bounds);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Screen capture is currently supported on Windows only".into())
    }
}

/// 编码为 PNG base64。
pub fn encode_png_base64(width: u32, height: u32, rgba: &[u8]) -> Result<String, String> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| "Failed to construct RgbaImage from raw bytes".to_string())?;
    let mut cursor = Cursor::new(Vec::new());
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encoding error: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(cursor.into_inner()))
}

#[tauri::command]
pub async fn translator_capture_screen(window: WebviewWindow) -> Result<ScreenCapture, String> {
    if window.label() != "main" {
        return Err("main_window_required".into());
    }
    capture_virtual_screen()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_encoding_produces_a_decodable_image() {
        let width = 4u32;
        let height = 3u32;
        let rgba = vec![200u8; (width * height * 4) as usize];
        let encoded = encode_png_base64(width, height, &rgba).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), width);
        assert_eq!(decoded.height(), height);
    }

    #[test]
    fn png_encoding_rejects_mismatched_buffer_sizes() {
        assert!(encode_png_base64(4, 4, &[0u8; 8]).is_err());
    }

    #[test]
    fn fast_jpeg_encoding_produces_valid_data_uri() {
        let width = 8u32;
        let height = 8u32;
        let rgba = vec![128u8; (width * height * 4) as usize];
        let uri = encode_fast_screen_base64(width, height, &rgba).unwrap();
        assert!(uri.starts_with("data:image/jpeg;base64,"));
        let base64_str = uri.strip_prefix("data:image/jpeg;base64,").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64_str.as_bytes())
            .unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), width);
        assert_eq!(decoded.height(), height);
    }
}
