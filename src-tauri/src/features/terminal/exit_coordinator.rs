//! Native exit authority. No receipt supplied by JavaScript is trusted.
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
#[path = "exit_coordinator_backend.rs"]
mod backend;
#[cfg(test)]
#[path = "exit_coordinator_tests.rs"]
mod tests;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub kind: String, pub resource_id: String, pub ownership: String,
    pub status: String, pub evidence: Option<String>, pub error_code: Option<String>, pub retryable: bool,
}
impl Resource {
    fn result(id: &str, result: Result<&str, String>) -> Self {
        let (status, evidence, error) = match result {
            Ok("absent") => ("absent", Some("never_created".into()), None),
            Ok("retained_shared") => ("released_shared", Some("owner_released".into()), None),
            Ok(proof) => ("stopped", Some(proof.into()), None),
            Err(e) => (if e.contains("unsupported") { "unsupported" } else if e.contains("timeout") { "timeout" } else { "failed" }, None, Some(e)),
        };
        Self { kind: id.into(), resource_id: id.into(), ownership: if status == "released_shared" {"shared"} else {"exclusive"}.into(), status: status.into(), evidence, retryable: error.is_some(), error_code: error }
    }
    fn complete(&self) -> bool { matches!(self.status.as_str(), "stopped" | "absent" | "released_shared") && self.evidence.is_some() }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonReceipt { pub epoch: Option<String>, pub status: String }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitError { resource_id: String, code: String }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    protocol_version: u8, transaction_id: String, instance_id: String, generation: u64,
    phase: String, can_exit: bool, resources: Vec<Resource>, daemon: DaemonReceipt,
    errors: Vec<ExitError>, worker_running: bool, metadata_saved: bool,
}
pub(super) trait Backend: Send + Sync {
    fn prepare(&self, transaction: &str, deadline: Instant) -> Result<(), String>;
    fn stop(&self, transaction: &str, deadline: Instant) -> (Vec<Resource>, DaemonReceipt);
    fn resume(&self, transaction: &str, abort: bool, deadline: Instant) -> Result<(), String>;
}
struct Transaction { receipt: Receipt, backend: Arc<dyn Backend>, stopped: bool, started: Option<Instant> }
struct State { generation: u64, transaction: Option<Transaction> }
pub struct Coordinator { instance: String, state: Mutex<State> }
impl Default for Coordinator {
    fn default() -> Self { Self { instance: uuid::Uuid::new_v4().to_string(), state: Mutex::new(State { generation: 0, transaction: None }) } }
}
impl Coordinator {
    fn prepare(&self, backend: Arc<dyn Backend>) -> Result<Receipt, String> {
        let id;
        {
            let mut state = self.state.lock().map_err(|_| "exit_state_poisoned")?;
            if let Some(tx) = &state.transaction { return Ok(tx.receipt.clone()); }
            id = uuid::Uuid::new_v4().to_string();
            let receipt = Receipt { protocol_version: 1, transaction_id: id.clone(), instance_id: self.instance.clone(), generation: state.generation, phase: "preparing".into(), can_exit: false, resources: vec![], daemon: DaemonReceipt { epoch: None, status: "pending".into() }, errors: vec![], worker_running: true, metadata_saved: false };
            state.transaction = Some(Transaction { receipt, backend: backend.clone(), stopped: false, started: None });
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| backend.prepare(&id, Instant::now() + Duration::from_secs(15)))).unwrap_or_else(|_| Err("exit_prepare_panicked".into()));
        let mut state = self.state.lock().map_err(|_| "exit_state_poisoned")?;
        let tx = state.transaction.as_mut().ok_or("exit_transaction_missing")?;
        tx.receipt.worker_running = false;
        tx.receipt.phase = if result.is_ok() { "prepared" } else { "blocked" }.into();
        if let Err(code) = result { tx.receipt.errors.push(ExitError { resource_id: "prepare".into(), code }); }
        Ok(tx.receipt.clone())
    }
    fn status(&self, id: &str) -> Result<Receipt, String> {
        let state = self.state.lock().map_err(|_| "exit_state_poisoned")?;
        let tx = state.transaction.as_ref().ok_or("exit_transaction_missing")?;
        if tx.receipt.transaction_id != id { return Err("exit_transaction_stale".into()); }
        let mut receipt = tx.receipt.clone();
        if receipt.worker_running && tx.started.is_some_and(|start| start.elapsed() >= Duration::from_secs(15)) {
            receipt.phase = "blocked".into();
            receipt.errors.push(ExitError { resource_id: "worker".into(), code: "exit_worker_timeout_retained".into() });
        }
        Ok(receipt)
    }
    fn cleanup(self: &Arc<Self>, id: &str, metadata_saved: bool) -> Result<Receipt, String> {
        let mut state = self.state.lock().map_err(|_| "exit_state_poisoned")?;
        let tx = state.transaction.as_mut().ok_or("exit_transaction_missing")?;
        if tx.receipt.transaction_id != id { return Err("exit_transaction_stale".into()); }
        if tx.receipt.worker_running || tx.receipt.can_exit { return Ok(tx.receipt.clone()); }
        if !metadata_saved { return Err("exit_metadata_not_saved".into()); }
        if !tx.stopped && tx.receipt.phase != "prepared" { return Err("exit_not_prepared".into()); }
        tx.stopped = true;
        tx.started = Some(Instant::now());
        tx.receipt.metadata_saved = true;
        tx.receipt.worker_running = true;
        tx.receipt.phase = "stopping".into();
        let receipt = tx.receipt.clone();
        let backend = tx.backend.clone();
        let owner = self.clone();
        let transaction = id.to_string();
        let generation = receipt.generation;
        // One retained logical worker per transaction. A timeout never detaches its authority.
        if std::thread::Builder::new().name("app-exit-cleanup".into()).spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| backend.stop(&transaction, Instant::now() + Duration::from_secs(15))));
            if let Ok(mut state) = owner.state.lock() {
                if state.generation != generation { return; }
                if let Some(tx) = state.transaction.as_mut().filter(|t| t.receipt.transaction_id == transaction) {
                    let (resources, daemon) = result.unwrap_or_else(|_| (vec![Resource::result("worker", Err("exit_worker_panicked".into()))], DaemonReceipt { epoch: None, status: "failed".into() }));
                    tx.receipt.errors = resources.iter().filter_map(|r| r.error_code.as_ref().map(|code| ExitError { resource_id: r.resource_id.clone(), code: code.clone() })).collect();
                    tx.receipt.can_exit = tx.receipt.metadata_saved && !resources.is_empty() && resources.iter().all(Resource::complete) && matches!(daemon.status.as_str(), "absent" | "stopped" | "retained_shared");
                    tx.receipt.phase = if tx.receipt.can_exit { "ready" } else { "blocked" }.into();
                    tx.receipt.resources = resources; tx.receipt.daemon = daemon; tx.receipt.worker_running = false;
                }
            }
        }).is_err() { tx.receipt.worker_running = false; tx.receipt.phase = "blocked".into(); return Err("exit_worker_spawn_failed".into()); }
        Ok(receipt)
    }
    fn release(&self, id: &str, abort: bool) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "exit_state_poisoned")?;
        let tx = state.transaction.as_ref().ok_or("exit_transaction_missing")?;
        if tx.receipt.transaction_id != id { return Err("exit_transaction_stale".into()); }
        if tx.receipt.worker_running { return Err("exit_worker_running".into()); }
        if tx.receipt.phase == "committed" { return Err("exit_already_committed".into()); }
        if abort && tx.stopped { return Err("exit_already_stopping_use_resume".into()); }
        if tx.stopped && !tx.receipt.can_exit {
            return Err(format!("exit_resume_unsettled:{}", tx.receipt.resources.iter().filter(|r| !r.complete()).map(|r| r.resource_id.as_str()).collect::<Vec<_>>().join(",")));
        }
        if let Err(code) = tx.backend.resume(id, abort, Instant::now() + Duration::from_secs(15)) {
            let tx = state.transaction.as_mut().unwrap();
            tx.receipt.errors.push(ExitError { resource_id: "resume".into(), code: code.clone() });
            return Err(code);
        }
        state.generation += 1; state.transaction = None; Ok(())
    }
    fn commit(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "exit_state_poisoned")?;
        let generation = state.generation;
        let tx = state.transaction.as_mut().ok_or("exit_transaction_missing")?;
        if tx.receipt.transaction_id != id || tx.receipt.generation != generation || !tx.receipt.can_exit || tx.receipt.worker_running || tx.receipt.phase != "ready" { return Err("exit_not_ready".into()); }
        tx.receipt.phase = "committed".into(); Ok(())
    }
}
fn main_only(window: &WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("exit_main_window_only".into()) } }
fn coordinator(app: &AppHandle) -> Arc<Coordinator> { app.state::<Arc<Coordinator>>().inner().clone() }
#[tauri::command]
pub async fn app_exit_prepare(app: AppHandle, window: WebviewWindow, source: String) -> Result<Receipt, String> {
    main_only(&window)?;
    if !matches!(source.as_str(), "window" | "tray" | "menu" | "native" | "quit") { return Err("exit_source_invalid".into()); }
    let owner = coordinator(&app);
    tauri::async_runtime::spawn_blocking(move || owner.prepare(Arc::new(backend::Native::new(app)))).await.map_err(|_| "exit_prepare_join_failed".to_string())?
}
#[tauri::command]
pub fn app_exit_cleanup(app: AppHandle, window: WebviewWindow, transaction_id: String, metadata_saved: bool) -> Result<Receipt, String> { main_only(&window)?; coordinator(&app).cleanup(&transaction_id, metadata_saved) }
#[tauri::command]
pub fn app_exit_status(app: AppHandle, window: WebviewWindow, transaction_id: String) -> Result<Receipt, String> { main_only(&window)?; coordinator(&app).status(&transaction_id) }
async fn release(app: AppHandle, window: WebviewWindow, id: String, abort: bool) -> Result<(), String> {
    main_only(&window)?; let owner = coordinator(&app);
    tauri::async_runtime::spawn_blocking(move || owner.release(&id, abort)).await.map_err(|_| "exit_resume_join_failed".to_string())?
}
#[tauri::command]
pub async fn app_exit_abort(app: AppHandle, window: WebviewWindow, transaction_id: String) -> Result<(), String> { release(app, window, transaction_id, true).await }
#[tauri::command]
pub async fn app_exit_resume(app: AppHandle, window: WebviewWindow, transaction_id: String) -> Result<(), String> { release(app, window, transaction_id, false).await }
#[tauri::command]
pub fn app_exit_commit(app: AppHandle, window: WebviewWindow, transaction_id: String) -> Result<(), String> { main_only(&window)?; coordinator(&app).commit(&transaction_id)?; app.exit(0); Ok(()) }

/// Additional native IPC fence; storage plugin commands remain available for metadata saves.
pub fn command_allowed(app: &AppHandle, command: &str) -> bool {
    if command.starts_with("app_exit_") { return true; }
    let owner = coordinator(app);
    let fenced = owner.state.lock().map(|s| s.transaction.is_some()).unwrap_or(true);
    !fenced || !["pty_", "side_question_", "cc_connect_", "live_server_", "web_server_", "web_device_", "routing_", "ssh_"].iter().any(|p| command.starts_with(p))
}

pub fn committed(app: &AppHandle) -> bool {
    coordinator(app).state.lock().map(|s| s.transaction.as_ref().is_some_and(|t| t.receipt.phase == "committed")).unwrap_or(false)
}
pub fn guard_requested(app: &AppHandle) -> bool {
    // Only a native ready -> committed transition permits exit. Before the main
    // listener is ready, fail closed; a later request can be retried normally.
    if committed(app) { return false; }
    let _ = app.emit_to("main", "app-exit-requested", ());
    true
}
