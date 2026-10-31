//! Logical sizing policy and opening identity, independent of native window APIs.
use super::result::ScreenshotResult;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Input,
    Screenshot,
}
impl Mode {
    pub fn dimensions(self, height: f64) -> (f64, f64) {
        match self {
            Self::Input => (460.0, height.clamp(220.0, 520.0)),
            Self::Screenshot => (560.0, height.clamp(300.0, 680.0)),
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opening {
    pub generation: u64,
    pub revision: u64,
    pub card: Option<super::card::Card>,
    pub mode: Mode,
    pub text: String,
    pub result: Option<ScreenshotResult>,
}
pub struct Sizing {
    pub authority: super::attempt::Authority,
    pub crop: Option<String>,
    pub opening: Opening,
    sequence: u64,
    started: Option<std::time::Instant>,
}
impl Sizing {
    pub const fn new() -> Self {
        Self {
            authority: super::attempt::Authority::new(),
            crop: None,
            opening: Opening {
                generation: 0,
                revision: 0,
                card: None,
                mode: Mode::Input,
                text: String::new(),
                result: None,
            },
            sequence: 0,
            started: None,
        }
    }
    pub fn open(&mut self, mode: Mode, text: String, result: Option<ScreenshotResult>) -> Opening {
        self.authority = super::attempt::Authority::new();
        self.crop = None;
        self.opening = Opening {
            generation: self.opening.generation + 1,
            revision: 0,
            card: None,
            mode,
            text,
            result,
        };
        self.sequence = 0;
        self.started = None;
        self.opening.clone()
    }
    pub fn loading(&mut self, expected: u64, id: u64) -> Result<Opening, String> {
        if !self.can_deliver(expected) { return Err("stale_translator_opening".into()); }
        self.open(Mode::Screenshot, String::new(), None);
        self.started = Some(std::time::Instant::now());
        self.opening.card = Some(super::card::Card { attempt: 0, error_code: None, session_id: id, phase: "loading",
            image_base64: String::new(), started_at: super::card::now(), elapsed_ms: 0 });
        Ok(self.opening.clone())
    }
    pub fn update_card(&mut self, generation: u64, id: u64, image: Option<String>,
        result: Option<ScreenshotResult>, failed: bool) -> Result<Opening, String> {
        if self.opening.generation != generation || self.opening.mode != Mode::Screenshot {
            return Err("stale_translator_opening".into());
        }
        let card = self.opening.card.as_mut().filter(|c| c.session_id == id && c.phase == "loading")
            .ok_or("stale_translator_card")?;
        if let Some(image) = image { card.image_base64 = image; }
        if failed || result.is_some() {
            card.phase = if failed { "error" } else { "success" };
            card.elapsed_ms = self.started.map(|s| s.elapsed().as_millis() as u64).unwrap_or(0);
        }
        if let Some(mut result) = result {
            result.elapsed_ms = card.elapsed_ms;
            self.opening.result = Some(result);
        }
        self.opening.revision += 1;
        Ok(self.opening.clone())
    }
    pub fn accept(&mut self, generation: u64, sequence: u64, mode: Mode) -> bool {
        if generation != self.opening.generation
            || mode != self.opening.mode
            || sequence <= self.sequence
        {
            return false;
        }
        self.sequence = sequence;
        true
    }
    pub fn can_deliver(&self, capture_generation: u64) -> bool {
        self.opening.generation == capture_generation
    }
}

pub fn clamp_physical(
    position: (i32, i32),
    size: (u32, u32),
    origin: (i32, i32),
    monitor: (u32, u32),
) -> (i32, i32) {
    (
        position.0.clamp(
            origin.0,
            (origin.0 + monitor.0 as i32 - size.0 as i32).max(origin.0),
        ),
        position.1.clamp(
            origin.1,
            (origin.1 + monitor.1 as i32 - size.1 as i32).max(origin.1),
        ),
    )
}
pub fn monitor_dimensions(mode: Mode, height: f64, physical: (u32, u32), scale: f64) -> (f64, f64) {
    let (width, height) = mode.dimensions(height);
    (
        width.min(physical.0 as f64 / scale),
        height.min(physical.1 as f64 / scale),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reopen_and_mode_change_reject_late_sizes_and_capture_delivery() {
        let mut s = Sizing::new();
        let first = s.open(Mode::Input, String::new(), None);
        assert!(s.accept(first.generation, 2, Mode::Input));
        assert!(!s.accept(first.generation, 1, Mode::Input));
        let next = s.open(Mode::Input, String::new(), None);
        assert_eq!(Mode::Input.dimensions(0.0), (460.0, 220.0));
        assert!(!s.can_deliver(first.generation));
        assert!(!s.accept(first.generation, 3, Mode::Input));
        assert!(s.accept(next.generation, 1, Mode::Input));
        assert!(!s.accept(next.generation, 2, Mode::Screenshot));
        let shot = s.open(Mode::Screenshot, String::new(), None);
        assert_eq!(Mode::Screenshot.dimensions(900.0), (560.0, 680.0));
        assert!(s.accept(shot.generation, 1, Mode::Screenshot));
    }
    #[test]
    fn dpi_and_negative_monitor_origins_use_physical_bounds() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let logical = monitor_dimensions(Mode::Input, 220.0, (1920, 1080), scale);
            assert_eq!(logical, (460.0, 220.0));
            let pixels = (
                (logical.0 * scale).round() as u32,
                (logical.1 * scale).round() as u32,
            );
            let (x, y) = clamp_physical((-5, 1075), pixels, (-1920, 0), (1920, 1080));
            assert_eq!(x, -(pixels.0 as i32));
            assert_eq!(y, 1080 - pixels.1 as i32);
            assert_eq!(
                clamp_physical((-9999, -9999), pixels, (-1920, -1080), (1920, 1080)),
                (-1920, -1080)
            );
        }
        assert_eq!(
            monitor_dimensions(Mode::Screenshot, 680.0, (800, 600), 2.0),
            (400.0, 300.0)
        );
    }
}

#[cfg(test)]
mod card_tests {
    use super::*;
    #[test]
    fn retained_progress_same_opening_and_sequence_terminal_and_identity_fences() {
        for failed in [false, true] {
            let mut state = Sizing::new();
            let baseline = state.open(Mode::Input, String::new(), None).generation;
            let loading = state.loading(baseline, 7).unwrap();
            let g = loading.generation;
            assert_eq!(loading.card.unwrap().phase, "loading");
            assert!(state.accept(g, 1, Mode::Screenshot));
            assert!(state.update_card(g, 8, Some("bad".into()), None, false).is_err());
            let thumb = state.update_card(g, 7, Some("crop".into()), None, false).unwrap();
            assert_eq!(thumb.generation, g);
            assert_eq!(thumb.revision, 1);
            assert_eq!(thumb.card.unwrap().image_base64, "crop");
            assert!(!state.accept(g, 1, Mode::Screenshot), "update cannot reset resize sequence");
            let result = (!failed).then(|| ScreenshotResult { translated: "translation".into(),
                original: None, image_base64: "crop".into(), elapsed_ms: 999999 });
            let terminal = state.update_card(g, 7, None, result, failed).unwrap();
            assert_eq!(terminal.generation, g);
            assert_eq!(terminal.revision, 2);
            assert_eq!(terminal.card.as_ref().unwrap().phase, if failed { "error" } else { "success" });
            if let Some(result) = terminal.result { assert_ne!(result.elapsed_ms, 999999); }
            assert!(state.update_card(g, 7, None, None, true).is_err(), "terminal cannot regress");
        }
        for _reason in ["AltT", "close", "newcapture"] {
            let mut state = Sizing::new();
            let old = state.loading(0, 1).unwrap();
            let next = state.open(Mode::Input, String::new(), None);
            assert!(state.update_card(old.generation, 1, Some("late".into()), None, false).is_err());
            assert!(state.update_card(old.generation, 1, None, None, true).is_err());
            assert!(state.loading(old.generation, 1).is_err());
            let fresh = state.loading(next.generation, 2).unwrap();
            assert!(state.update_card(fresh.generation, 1, None, None, true).is_err());
            assert_eq!(state.opening.card.as_ref().unwrap().session_id, 2);
        }
    }
}

#[cfg(test)]
mod attempt_tests {
    use super::*;
    #[test]
    fn close_new_open_drop_crop_and_reject_previous_attempt() {
        let mut state = Sizing::new();
        let first = state.open(Mode::Input, String::new(), None);
        let id = state.authority.begin(first.generation, 1).unwrap();
        state.crop = Some("private crop".into());
        state.open(Mode::Screenshot, String::new(), None);
        assert!(state.crop.is_none());
        assert!(state.authority.accept(id).is_err());
    }
}
