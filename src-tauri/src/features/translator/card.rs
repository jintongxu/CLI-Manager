//! Retained screenshot progress and physical selection geometry. No native effects here.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }
impl Anchor {
    pub fn validate(&self, frame: &super::capture::ScreenCapture) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height].iter().all(|v| v.is_finite())
            || self.width < 4.0 || self.height < 4.0
            || self.x < frame.origin_x as f64 || self.y < frame.origin_y as f64
            || self.x + self.width > frame.origin_x as f64 + frame.width as f64
            || self.y + self.height > frame.origin_y as f64 + frame.height as f64 {
            return Err("capture_invalid_selection".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub attempt: u64,
    pub error_code: Option<String>,
    pub session_id: u64,
    pub phase: &'static str,
    pub image_base64: String,
    pub started_at: u64,
    pub elapsed_ms: u64,
}
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}
pub fn place(anchor: &Anchor, size: (u32, u32), origin: (i32, i32), bounds: (u32, u32), scale: f64) -> (i32, i32) {
    let gap = (12.0 * scale).round() as i32;
    let (x, y) = (anchor.x.round() as i32, anchor.y.round() as i32);
    let right = (anchor.x + anchor.width).round() as i32 + gap;
    let bottom = (anchor.y + anchor.height).round() as i32 + gap;
    let left = x - gap - size.0 as i32;
    let top = y - gap - size.1 as i32;
    let position = if right + size.0 as i32 <= origin.0 + bounds.0 as i32 { (right, y) }
        else if left >= origin.0 { (left, y) }
        else if bottom + size.1 as i32 <= origin.1 + bounds.1 as i32 { (x, bottom) }
        else { (x, top) };
    super::sizing::clamp_physical(position, size, origin, bounds)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn anchor_rejects_invalid_or_outside_frozen_frame() {
        let frame = super::super::capture::ScreenCapture { width: 1920, height: 1080,
            origin_x: -1920, origin_y: -1080, image_base64: String::new() };
        let valid = Anchor { x: -1900.0, y: -1000.0, width: 400.0, height: 100.0 };
        assert!(valid.validate(&frame).is_ok());
        for bad in [Anchor { x: f64::NAN, ..valid.clone() }, Anchor { width: f64::INFINITY, ..valid.clone() },
            Anchor { height: 0.0, ..valid.clone() }, Anchor { width: -1.0, ..valid.clone() },
            Anchor { x: -1921.0, ..valid.clone() }, Anchor { y: -1081.0, ..valid.clone() },
            Anchor { x: -50.0, ..valid.clone() }, Anchor { y: -10.0, ..valid.clone() }] {
            assert!(bad.validate(&frame).is_err());
        }
    }
    #[test]
    fn selection_anchored_edges_negative_origins_and_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let size = ((560.0 * scale) as u32, (300.0 * scale) as u32);
            let origin = (-2400, -1400);
            let bounds = (2400, 1400);
            let gap = (12.0_f64 * scale).round() as i32;
            let a = Anchor { x: -2200.0, y: -1200.0, width: 100.0, height: 100.0 };
            assert_eq!(place(&a, size, origin, bounds, scale), (-2100 + gap, -1200));
            let a = Anchor { x: -150.0, ..a.clone() };
            assert_eq!(place(&a, size, origin, bounds, scale), (-150 - gap - size.0 as i32, -1200));
            // Wide selections have neither side free: below then above, finally clamp.
            let a = Anchor { x: -2400.0, y: -1400.0, width: 2400.0, height: 100.0 };
            assert_eq!(place(&a, size, origin, bounds, scale), (-2400, -1300 + gap));
            let a = Anchor { y: -100.0, ..a.clone() };
            assert_eq!(place(&a, size, origin, bounds, scale), (-2400, -100 - gap - size.1 as i32));
            let a = Anchor { height: 1400.0, y: -1400.0, ..a };
            assert_eq!(place(&a, size, origin, bounds, scale), origin);
        }
    }
}
