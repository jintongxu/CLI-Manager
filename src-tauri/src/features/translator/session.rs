//! Pure retained-frame protocol; native effects are serialized by the caller's mutex.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Preparing,
    Selecting,
    Translating,
    Releasing,
}

pub struct Session<T> {
    pub(super) next: u64,
    pub active: Option<(u64, Phase, Option<T>)>,
}
impl<T> Default for Session<T> {
    fn default() -> Self {
        Self {
            next: 0,
            active: None,
        }
    }
}
impl<T: Clone> Session<T> {
    // Repeated trigger cancels, including a translation still in flight.
    pub fn trigger(&mut self) -> Option<u64> {
        if self.active.take().is_some() {
            return None;
        }
        self.next += 1;
        self.active = Some((self.next, Phase::Preparing, None));
        Some(self.next)
    }
    pub fn is(&self, id: u64, phase: Phase) -> bool {
        self.active
            .as_ref()
            .is_some_and(|s| s.0 == id && s.1 == phase)
    }
    pub fn publish(&mut self, id: u64, frame: T) -> bool {
        if !self.is(id, Phase::Preparing) {
            return false;
        }
        self.active.as_mut().unwrap().2 = Some(frame);
        true
    }
    // Reads are retained: StrictMode replay and lost event recovery cannot consume ownership.
    pub fn read(&self) -> Option<(u64, T)> {
        self.active
            .as_ref()
            .filter(|s| matches!(s.1, Phase::Preparing | Phase::Selecting))
            .and_then(|s| s.2.clone().map(|frame| (s.0, frame)))
    }
    pub fn ready(&mut self, id: u64) -> bool {
        if !self.is(id, Phase::Preparing) || self.active.as_ref().unwrap().2.is_none() {
            return false;
        }
        self.active.as_mut().unwrap().1 = Phase::Selecting;
        true
    }
    pub fn confirm(&mut self, id: u64) -> bool {
        if !self.is(id, Phase::Selecting) {
            return false;
        }
        let s = self.active.as_mut().unwrap();
        s.1 = Phase::Translating;
        s.2 = None;
        true
    }
    // Effects run while caller holds the same lock: stale callbacks cannot show/hide a newer opening.
    pub fn ready_with<E>(
        &mut self,
        id: u64,
        show: impl FnOnce() -> Result<(), E>,
    ) -> Result<bool, E> {
        if self.is(id, Phase::Selecting) {
            return Ok(true); // Retained-frame replay must not show/focus twice.
        }
        if !self.ready(id) {
            return Ok(false);
        }
        if let Err(error) = show() {
            self.active.as_mut().unwrap().1 = Phase::Releasing;
            return Err(error);
        }
        Ok(true)
    }
    pub fn confirm_with<E>(
        &mut self,
        id: u64,
        hide: impl FnOnce() -> Result<(), E>,
    ) -> Result<bool, E> {
        if !self.confirm(id) {
            return Ok(false);
        }
        if let Err(error) = hide() {
            self.active.as_mut().unwrap().1 = Phase::Releasing;
            return Err(error);
        }
        Ok(true)
    }
    // Small-card preparation is permitted only after native release succeeds.
    pub fn confirm_card_with<E, G>(&mut self, id: u64,
        release: impl FnOnce() -> Result<(), E>, loading: impl FnOnce() -> Result<G, E>,
    ) -> Result<Option<G>, E> {
        if !self.confirm_with(id, release)? { return Ok(None); }
        match loading() {
            Ok(opening) => Ok(Some(opening)),
            Err(error) => { self.finish(id); Err(error) }
        }
    }
    // Failed native release retains ownership so the watchdog retries rather than abandoning input.
    pub fn release_with<E>(&mut self, id: u64, release: impl FnOnce() -> Result<(), E>) -> Result<bool, E> {
        if !self.active.as_ref().is_some_and(|s| s.0 == id) {
            return Ok(false);
        }
        let s = self.active.as_mut().unwrap();
        s.1 = Phase::Releasing;
        s.2 = None;
        release()?;
        self.cancel(id);
        Ok(true)
    }
    pub fn cancel(&mut self, id: u64) -> bool {
        if !self.active.as_ref().is_some_and(|s| s.0 == id) {
            return false;
        }
        self.active = None;
        true
    }
    // Five-second preparation deadline plus a hard two-minute lease if the webview later hangs.
    pub fn should_abort(&self, id: u64, elapsed_ms: u64, escape: bool) -> bool {
        self.active.as_ref().is_some_and(|s| s.0 == id)
            && (self.is(id, Phase::Releasing)
                || escape
                || (self.is(id, Phase::Preparing) && elapsed_ms >= 5_000)
                || elapsed_ms >= 120_000)
    }
    #[cfg(test)]
    pub fn expire(&mut self, id: u64) -> bool {
        self.is(id, Phase::Preparing) && self.cancel(id)
    }
    pub fn finish(&mut self, id: u64) -> bool {
        self.is(id, Phase::Translating) && self.cancel(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prewarm_and_repeated_reads_do_not_consume_frame() {
        let mut s = Session::default();
        assert_eq!(s.read(), None);
        let id = s.trigger().unwrap();
        assert!(!s.ready(id));
        assert!(s.publish(id, "frame"));
        assert_eq!(s.read(), s.read());
        assert!(s.ready(id));
        assert!(!s.ready(id));
        assert!(s.confirm(id));
        assert_eq!(s.read(), None);
        assert!(s.finish(id));
    }
    #[test]
    fn repeat_hotkey_cancels_and_late_work_cannot_touch_next_session() {
        let mut s = Session::default();
        let old = s.trigger().unwrap();
        assert_eq!(s.trigger(), None);
        let new = s.trigger().unwrap();
        assert!(!s.publish(old, "late"));
        assert!(!s.cancel(old));
        assert!(!s.ready(old));
        assert!(!s.confirm(old));
        assert!(!s.finish(old));
        assert!(!s.expire(old));
        assert!(s.publish(new, "new"));
        assert_eq!(s.read(), Some((new, "new")));
    }
    #[test]
    fn timeout_and_decode_failure_fail_closed() {
        for publish in [false, true] {
            let mut s = Session::default();
            let id = s.trigger().unwrap();
            if publish {
                s.publish(id, "frame");
            }
            assert!(s.expire(id));
            assert!(!s.ready(id));
            assert!(!s.publish(id, "late"));
            assert_eq!(s.read(), None);
        }
    }
    #[test]
    fn cancellation_invalidates_translation_and_timeout_cannot_close_selection() {
        let mut s = Session::default();
        let id = s.trigger().unwrap();
        s.publish(id, "frame");
        s.ready(id);
        assert!(!s.expire(id));
        s.confirm(id);
        assert!(s.cancel(id));
        assert!(!s.finish(id));
    }
    #[test]
    fn native_show_hide_effects_are_fenced_and_failures_invalidate_ownership() {
        let mut s = Session::default();
        let id = s.trigger().unwrap();
        assert_eq!(
            s.ready_with(id, || -> Result<(), &str> {
                panic!("no frame must stay hidden")
            }),
            Ok(false)
        );
        s.publish(id, "frame");
        assert_eq!(s.ready_with(id, || Err("show failed")), Err("show failed"));
        assert!(s.is(id, Phase::Releasing));
        assert_eq!(s.release_with(id, || Ok::<_, &str>(())), Ok(true));
        let next = s.trigger().unwrap();
        s.publish(next, "new");
        assert_eq!(
            s.ready_with(id, || -> Result<(), &str> { panic!("stale show") }),
            Ok(false)
        );
        assert_eq!(s.ready_with(next, || Ok::<_, &str>(())), Ok(true));
        assert_eq!(
            s.confirm_with(id, || -> Result<(), &str> { panic!("stale hide") }),
            Ok(false)
        );
        assert_eq!(
            s.confirm_with(next, || Err("hide failed")),
            Err("hide failed")
        );
        assert!(!s.finish(next));
    }
    #[test]
    fn selecting_remount_retains_frame_and_duplicate_ready_does_not_reshow() {
        let mut s = Session::default();
        let id = s.trigger().unwrap();
        s.publish(id, "frame");
        assert_eq!(s.ready_with(id, || Ok::<_, &str>(())), Ok(true));
        assert_eq!(s.read(), Some((id, "frame")));
        assert_eq!(s.ready_with(id, || -> Result<(), &str> { panic!("already shown") }), Ok(true));
        assert!(s.confirm(id));
        assert_eq!(s.read(), None);
    }
    #[test]
    fn failed_release_keeps_watchdog_ownership_and_blocks_stale_effects() {
        let mut s = Session::default();
        let id = s.trigger().unwrap();
        s.publish(id, "frame");
        s.ready(id);
        assert_eq!(s.confirm_with(id, || Err("hide and destroy failed")), Err("hide and destroy failed"));
        assert!(s.active.is_some(), "release failure must not abandon native watchdog");
        assert!(s.should_abort(id, 0, false), "failed release must retry immediately");
        assert!(!s.finish(id));
        assert!(!s.ready(id));
        assert_eq!(s.read(), None);
        assert_eq!(s.release_with(id, || Err("retry failed")), Err("retry failed"));
        assert!(s.should_abort(id, 0, false));
        assert_eq!(s.release_with(id, || Ok::<_, &str>(())), Ok(true));
        assert!(s.active.is_none());
        let next = s.trigger().unwrap();
        assert_eq!(s.release_with(id, || -> Result<(), &str> { panic!("stale release") }), Ok(false));
        assert!(s.is(next, Phase::Preparing));
    }
    #[test]
    fn native_watchdog_handles_lost_frontend_and_escape_without_shortcuts() {
        let mut s = Session::default();
        let id = s.trigger().unwrap();
        assert!(!s.should_abort(id, 4_999, false));
        assert!(s.should_abort(id, 5_000, false));
        assert!(s.should_abort(id, 0, true));
        s.publish(id, "frame");
        s.ready(id);
        assert!(!s.should_abort(id, 5_000, false));
        assert!(s.should_abort(id, 5_000, true));
        assert!(s.should_abort(id, 120_000, false));
        s.confirm(id);
        assert!(s.should_abort(id, 120_000, false));
        s.cancel(id);
        assert!(!s.should_abort(id, 120_000, true));
    }
}

#[cfg(test)]
mod card_order_tests {
    use super::*;
    use std::cell::RefCell;
    #[test]
    fn release_precedes_loading_and_failures_never_restore_fullscreen() {
        for fail in ["none", "release", "loading"] {
            let mut s = Session::default();
            let id = s.trigger().unwrap();
            s.publish(id, "frame"); s.ready(id);
            let events = RefCell::new(Vec::new());
            let outcome = s.confirm_card_with(id, || {
                events.borrow_mut().push("release");
                if fail == "release" { Err("release") } else { Ok(()) }
            }, || {
                events.borrow_mut().push("loading");
                if fail == "loading" { Err("loading") } else { Ok(9) }
            });
            assert_eq!(*events.borrow(), if fail == "release" { vec!["release"] } else { vec!["release", "loading"] });
            match fail {
                "release" => { assert!(outcome.is_err()); assert!(s.is(id, Phase::Releasing)); assert!(s.should_abort(id, 0, false)); },
                "loading" => { assert!(outcome.is_err()); assert!(s.active.is_none()); },
                _ => { assert_eq!(outcome, Ok(Some(9))); assert!(s.is(id, Phase::Translating)); }
            }
            assert!(!s.is(id, Phase::Selecting));
            assert_eq!(s.confirm_card_with(id, || -> Result<(), &str> { panic!("duplicate release") },
                || -> Result<u64, &str> { panic!("duplicate loading") }), Ok(None));
        }
    }
}
