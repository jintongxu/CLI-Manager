use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
struct Fixture { calls: AtomicUsize, fail: AtomicBool, hold: AtomicBool, shared: bool }
impl Fixture { fn new(shared: bool) -> Arc<Self> { Arc::new(Self { calls: AtomicUsize::new(0), fail: AtomicBool::new(false), hold: AtomicBool::new(false), shared }) } }
impl Backend for Fixture {
    fn prepare(&self, _: &str, _: Instant) -> Result<(), String> { Ok(()) }
    fn stop(&self, _: &str, _: Instant) -> (Vec<Resource>, DaemonReceipt) {
        self.calls.fetch_add(1, Ordering::SeqCst);
        while self.hold.load(Ordering::SeqCst) { std::thread::sleep(Duration::from_millis(1)); }
        let result = if self.fail.load(Ordering::SeqCst) { Err("helper_timeout".into()) } else { Ok("job_empty") };
        (vec![Resource::result("fixture", result)], DaemonReceipt { epoch: Some("test".into()), status: if self.shared { "retained_shared" } else { "stopped" }.into() })
    }
    fn resume(&self, _: &str, _: bool, _: Instant) -> Result<(), String> { Ok(()) }
}
fn settled(c: &Coordinator, id: &str) -> Receipt {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop { let r = c.status(id).unwrap(); if !r.worker_running { return r; } assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(1)); }
}
#[test]
fn metadata_abort_and_generation_fence() {
    let c = Arc::new(Coordinator::default()); let f = Fixture::new(false);
    let r = c.prepare(f.clone()).unwrap();
    assert!(c.cleanup(&r.transaction_id, false).is_err());
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    c.release(&r.transaction_id, true).unwrap();
    let next = c.prepare(f).unwrap(); assert_eq!(next.generation, r.generation + 1);
    assert!(c.commit(&r.transaction_id).is_err()); assert!(c.status(&r.transaction_id).is_err());
}
#[test]
fn success_shared_duplicate_and_commit() {
    for shared in [false, true] {
        let c = Arc::new(Coordinator::default()); let f = Fixture::new(shared);
        let r = c.prepare(f.clone()).unwrap(); assert_eq!(c.prepare(f.clone()).unwrap().transaction_id, r.transaction_id);
        c.cleanup(&r.transaction_id, true).unwrap();
        assert!(settled(&c, &r.transaction_id).can_exit);
        c.cleanup(&r.transaction_id, true).unwrap(); assert_eq!(f.calls.load(Ordering::SeqCst), 1);
        c.commit(&r.transaction_id).unwrap(); assert!(c.commit(&r.transaction_id).is_err());
    }
}
#[test]
fn timeout_retry_and_running_worker_resume_rejected() {
    let c = Arc::new(Coordinator::default()); let f = Fixture::new(false);
    f.fail.store(true, Ordering::SeqCst); f.hold.store(true, Ordering::SeqCst);
    let r = c.prepare(f.clone()).unwrap(); c.cleanup(&r.transaction_id, true).unwrap();
    c.cleanup(&r.transaction_id, true).unwrap(); assert!(c.release(&r.transaction_id, false).is_err());
    f.hold.store(false, Ordering::SeqCst);
    let failed = settled(&c, &r.transaction_id); assert!(!failed.can_exit); assert_eq!(failed.resources[0].status, "timeout");
    assert!(c.release(&r.transaction_id, true).is_err());
    assert!(c.release(&r.transaction_id, false).unwrap_err().contains("fixture"));
    f.fail.store(false, Ordering::SeqCst); c.cleanup(&r.transaction_id, true).unwrap();
    assert!(settled(&c, &r.transaction_id).can_exit); assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    c.release(&r.transaction_id, false).unwrap(); assert!(c.commit(&r.transaction_id).is_err());
}

#[test]
fn pending_unknown_or_missing_proof_never_ready() {
    for status in ["pending", "failed", "timeout", "unsupported", "retained_shared"] {
        let resource = Resource { status: status.into(), ..Resource::result("fixture", Ok("job_empty")) };
        assert!(!resource.complete());
    }
    let resource = Resource { evidence: None, ..Resource::result("fixture", Ok("job_empty")) };
    assert!(!resource.complete());
    let c = Arc::new(Coordinator::default());
    assert!(c.commit("forged").is_err());
    let r = c.prepare(Fixture::new(false)).unwrap();
    assert!(c.commit(&r.transaction_id).is_err());
}

#[test]
fn native_exit_guard_has_only_committed_permit_and_frontend_listener() {
    let native = include_str!("../../lib.rs");
    let legacy = native.split("fn app_exit(").nth(1).unwrap().split("#[tauri::command]").next().unwrap();
    assert!(!legacy.contains("app.exit(0)"));
    assert!(legacy.contains("guard_requested"));
    assert!(native.contains("if exit_coordinator::guard_requested(app) { api.prevent_exit(); }"));
    let app = include_str!("../../../../src/app/App.tsx");
    assert!(app.contains("listen(\"app-exit-requested\""));
    assert!(app.contains("requestExitGuardedByRunningTasks(\"native\")"));
}
