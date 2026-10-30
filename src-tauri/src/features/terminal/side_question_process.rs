//! Owned one-shot process lifecycle. Cancellation never addresses a PID from the frontend.
use crate::commands::cc_connect::exit_process::{lock_until, reap_failed, OwnedProcess};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};

// Retain recent cancellation/completion identities to fence IPC scheduling races.
const TOMBSTONE_TTL: Duration = Duration::from_secs(300);
const MAX_TOMBSTONES: usize = 4096;
#[derive(Default)]
struct Registry {
    active: HashMap<String, Arc<AtomicBool>>,
    shutting_down: bool,
    retired: HashMap<String, Instant>,
}
impl Registry {
    fn prune(&mut self) {
        self.retired
            .retain(|_, time| time.elapsed() < TOMBSTONE_TTL);
    }
    fn retire(&mut self, id: String) {
        self.prune();
        if self.retired.len() >= MAX_TOMBSTONES && !self.retired.contains_key(&id) {
            if let Some(oldest) = self
                .retired
                .iter()
                .min_by_key(|(_, time)| *time)
                .map(|(id, _)| id.clone())
            {
                self.retired.remove(&oldest);
            }
        }
        self.retired.insert(id, Instant::now());
    }
    fn register(&mut self, id: &str) -> Result<Arc<AtomicBool>, String> {
        self.prune();
        if self.shutting_down {
            return Err("side_question_shutdown".into());
        }
        if self.active.contains_key(id) {
            return Err("side_question_duplicate_request".into());
        }
        if self.retired.contains_key(id) {
            return Err("side_question_cancelled".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        self.active.insert(id.into(), flag.clone());
        Ok(flag)
    }
}
static REQUESTS: OnceLock<Mutex<Registry>> = OnceLock::new();
fn requests() -> &'static Mutex<Registry> {
    REQUESTS.get_or_init(|| Mutex::new(Registry::default()))
}

pub(super) struct Registration {
    id: String,
    cancelled: Arc<AtomicBool>,
}
impl Registration {
    // Called synchronously in the async IPC handler, before dispatching blocking work.
    pub(super) fn new(id: String) -> Result<Self, String> {
        let mut active = requests().lock().map_err(|_| "side_question_registry")?;
        let cancelled = active.register(&id)?;
        Ok(Self { id, cancelled })
    }
    pub(super) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut active) = requests().lock() {
            if active
                .active
                .get(&self.id)
                .is_some_and(|value| Arc::ptr_eq(value, &self.cancelled))
            {
                active.active.remove(&self.id);
                active.retire(self.id.clone());
            }
        }
    }
}
pub(super) fn cancel(id: &str) {
    if id.trim().is_empty() || id.len() > 200 {
        return;
    }
    if let Ok(mut registry) = requests().lock() {
        if let Some(flag) = registry.active.get(id) {
            flag.store(true, Ordering::SeqCst);
        } else {
            registry.retire(id.into());
        }
    }
}

// Fence new work first, then wait until run_command has killed/reaped every owned child.
// This runs only for actual native exit, never for a tray/window hide.
pub(super) fn shutdown() {
    if let Err(error) = stop_for_exit(Instant::now() + Duration::from_secs(5)) {
        log::warn!("side-question exit cleanup: {error}");
    }
}
pub(crate) fn prepare_exit(deadline: Instant) -> Result<(), String> {
    lock_until(requests(), deadline)?.shutting_down = true;
    Ok(())
}
pub(crate) fn resume_after_exit() {
    if let Ok(mut registry) = requests().lock() {
        registry.shutting_down = false;
    }
}
pub(crate) fn stop_for_exit(deadline: Instant) -> Result<&'static str, String> {
    {
        let mut registry = lock_until(requests(), deadline)?;
        registry.shutting_down = true;
        for flag in registry.active.values() {
            flag.store(true, Ordering::SeqCst);
        }
    }
    loop {
        reap_closing(deadline)?;
        if lock_until(requests(), deadline)?.active.is_empty() {
            reap_failed(deadline)?;
            return Ok(if cfg!(windows) {
                "job_empty"
            } else {
                "process_signaled"
            });
        }
        if Instant::now() >= deadline {
            return Err("helper_timeout".into());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
struct Closing {
    owned: OwnedProcess,
    readers: Vec<std::thread::JoinHandle<()>>,
    _registration: Registration,
}
static CLOSING: OnceLock<Mutex<Vec<Closing>>> = OnceLock::new();
fn closing() -> &'static Mutex<Vec<Closing>> {
    CLOSING.get_or_init(Default::default)
}
fn reap_closing(deadline: Instant) -> Result<(), String> {
    let mut slots = lock_until(closing(), deadline)?;
    while let Some(slot) = slots.last_mut() {
        slot.owned.stop_until(deadline)?;
        while slot.readers.iter().any(|r| !r.is_finished()) {
            if Instant::now() >= deadline {
                return Err("helper_timeout".into());
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        for reader in slot.readers.drain(..) {
            let _ = reader.join();
        }
        slots.pop();
    }
    Ok(())
}

// Release builds use installed Tauri resources exclusively; no checkout fallback.
fn resolve_script(
    resource_dir: Option<&std::path::Path>,
    development: bool,
) -> Result<std::path::PathBuf, String> {
    // Dev must run the current checkout, even if a previous build left staged resources.
    // Installed/release builds still resolve exclusively from the resource directory.
    if development {
        let script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/piSideQuestionAgent.mjs");
        if script.is_file() {
            return Ok(script);
        }
    } else if let Some(root) = resource_dir {
        let runtime = root.join("resources/side-question");
        if runtime.join("launch.mjs").is_file()
            && runtime.join("piSideQuestionAgent.mjs").is_file()
            && runtime.join("piSideQuestionAgentCore.mjs").is_file()
            && runtime.join("runtime-manifest.json").is_file()
            && runtime
                .join("node_modules/@earendil-works/pi-coding-agent/package.json")
                .is_file()
        {
            return Ok(runtime.join("launch.mjs"));
        }
    }
    Err("side_question_packaged_runtime_missing: reinstall CLI-Manager (side-question runtime resources are missing)".into())
}

pub(super) fn run(
    resource_dir: Option<std::path::PathBuf>,
    payload: serde_json::Value,
    registration: Registration,
    timeout: Duration,
    progress: impl FnMut(String),
) -> Result<serde_json::Value, String> {
    run_runtime(
        resource_dir,
        payload,
        registration,
        timeout,
        progress,
        cfg!(debug_assertions),
    )
}

fn run_runtime(
    resource_dir: Option<std::path::PathBuf>,
    payload: serde_json::Value,
    registration: Registration,
    timeout: Duration,
    progress: impl FnMut(String),
    development: bool,
) -> Result<serde_json::Value, String> {
    if registration.is_cancelled() {
        return Err("side_question_cancelled".into());
    }
    let script = resolve_script(resource_dir.as_deref(), development)?;
    if payload["type"] == "context" {
        log::warn!(
            "side_question_context stage=resolve code={}",
            if development {
                "source_runtime_checkout"
            } else {
                "source_runtime_packaged"
            }
        );
    }
    let mut command = Command::new("node");
    command.arg(script);
    run_command(payload, registration, timeout, progress, command)
}

// Command injection stays private: tests exercise real owned-child pipes without an SDK/provider.
fn run_command(
    payload: serde_json::Value,
    registration: Registration,
    timeout: Duration,
    mut progress: impl FnMut(String),
    mut command: Command,
) -> Result<serde_json::Value, String> {
    if registration.is_cancelled() {
        return Err("side_question_cancelled".into());
    }
    let started = Instant::now();
    let encoded = serde_json::to_vec(&payload).map_err(|_| "side_question_encode")?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = OwnedProcess::spawn(&mut command)?;
    // Piped handles are guaranteed by the command setup above.
    let mut stdin = child.child.stdin.take().expect("configured stdin pipe");
    // Writer is separate so a nonreading child cannot block cancellation/timeout.
    let writer = std::thread::spawn(move || {
        let _ = stdin
            .write_all(&encoded)
            .and_then(|_| stdin.write_all(b"\n"));
    });
    let stdout = child.child.stdout.take().expect("configured stdout pipe");
    let (sender, receiver) = mpsc::sync_channel(32);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = Vec::new();
            // Bounded frame prevents runaway sidecar output allocation.
            match reader.by_ref().take(2_000_001).read_until(b'\n', &mut line) {
                Ok(0) => break,
                Ok(_) if line.len() <= 2_000_000 => {
                    if sender.send(Ok(line)).is_err() {
                        break;
                    }
                }
                _ => {
                    let _ = sender.send(Err("side_question_frame"));
                    break;
                }
            }
        }
    });
    let mut final_value = None;
    let result = (|| {
        loop {
            if registration.is_cancelled() {
                return Err("side_question_cancelled".into());
            }
            if started.elapsed() >= timeout {
                return Err("side_question_timeout".into());
            }
            match receiver.recv_timeout(Duration::from_millis(20)) {
                Ok(Ok(line)) => {
                    let value: serde_json::Value =
                        serde_json::from_slice(&line).map_err(|_| "side_question_protocol")?;
                    if final_value.is_some() {
                        return Err("side_question_protocol".into());
                    }
                    match value.get("type").and_then(|value| value.as_str()) {
                        Some("delta") => {
                            if value.get("requestId") != payload.get("requestId") || value.get("threadId") != payload.get("threadId") {
                                return Err("side_question_identity".into());
                            }
                            if let Some(text) = value.get("text").and_then(|value| value.as_str()) { progress(text.to_string()); }
                        }
                        Some("done") if payload["type"] == "ask" => {
                            if value.get("requestId") != payload.get("requestId") || value.get("threadId") != payload.get("threadId") {
                                return Err("side_question_identity".into());
                            }
                            final_value = Some(value);
                        }
                        Some("context") if payload["type"] == "context" => final_value = Some(value),
                        Some("error") if value.get("error").and_then(|v| v.as_str()) == Some("side_question_node_required") =>
                            return Err("side_question_node_required: install Node.js >=22.19.0 and restart CLI-Manager".into()),
                        Some("error") => return Err("side_question_failed".into()),
                        _ => return Err("side_question_protocol".into()),
                    }
                }
                Ok(Err(error)) => return Err(error.into()),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        // EOF can precede process exit. Polling remains cancellable until it is reaped.
        loop {
            if registration.is_cancelled() {
                return Err("side_question_cancelled".into());
            }
            if started.elapsed() >= timeout {
                return Err("side_question_timeout".into());
            }
            match child.child.try_wait().map_err(|_| "side_question_wait")? {
                Some(status) if status.success() => break,
                Some(_) => return Err("side_question_exit".into()),
                None => std::thread::sleep(Duration::from_millis(10)),
            }
        }
        final_value.ok_or_else(|| "side_question_empty_answer".into())
    })();
    // Drop receiver before joining: a full reader queue must not deadlock cleanup.
    drop(receiver);
    closing()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(Closing {
            owned: child,
            readers: vec![writer, reader],
            _registration: registration,
        });
    // An unsuccessful cleanup keeps the registration and all handles for exit retry.
    reap_closing(Instant::now() + Duration::from_secs(2))?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    // Run alone: shutdown intentionally closes the process-wide registry permanently.
    #[test]
    #[ignore = "process-wide exit fence; run explicitly in isolation"]
    fn application_exit_cancels_and_reaps_owned_subprocesses_before_return() {
        let registration = Registration::new("shutdown-owned-child".into()).unwrap();
        let child = std::thread::spawn(move || {
            run_command(
                payload(),
                registration,
                Duration::from_secs(30),
                |_| {},
                mock_command("setInterval(() => {}, 1000)"),
            )
        });
        std::thread::sleep(Duration::from_millis(100));
        shutdown();
        assert!(requests().lock().unwrap().active.is_empty());
        assert_eq!(
            child.join().unwrap().unwrap_err(),
            "side_question_cancelled"
        );
        assert!(Registration::new("after-shutdown".into()).is_err());
    }
    #[test]
    fn installed_runtime_resolution_relocates_and_release_never_uses_checkout() {
        let root =
            std::env::temp_dir().join(format!("side-question-resolver-{}", uuid::Uuid::new_v4()));
        assert!(resolve_script(Some(&root), false)
            .unwrap_err()
            .starts_with("side_question_packaged_runtime_missing"));
        assert!(resolve_script(None, false).is_err());
        let runtime = root.join("resources/side-question");
        std::fs::create_dir_all(runtime.join("node_modules/@earendil-works/pi-coding-agent"))
            .unwrap();
        for file in [
            "launch.mjs",
            "piSideQuestionAgent.mjs",
            "piSideQuestionAgentCore.mjs",
            "runtime-manifest.json",
            "node_modules/@earendil-works/pi-coding-agent/package.json",
        ] {
            std::fs::write(runtime.join(file), "{}").unwrap();
        }
        assert_eq!(
            resolve_script(Some(&root), false).unwrap(),
            runtime.join("launch.mjs")
        );
        assert_eq!(
            resolve_script(Some(&root), true).unwrap(),
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../scripts/piSideQuestionAgent.mjs")
        );
        let moved = root.with_extension("relocated");
        std::fs::rename(&root, &moved).unwrap();
        assert_eq!(
            resolve_script(Some(&moved), false).unwrap(),
            moved.join("resources/side-question/launch.mjs")
        );
        std::fs::remove_file(moved.join("resources/side-question/runtime-manifest.json")).unwrap();
        assert!(resolve_script(Some(&moved), false).is_err());
        std::fs::remove_dir_all(moved).unwrap();
    }
    #[test]
    fn missing_node_has_actionable_prerequisite_error() {
        let result = run_command(
            payload(),
            Registration::new("missing-node-test".into()).unwrap(),
            Duration::from_secs(1),
            |_| {},
            Command::new("cli-manager-nonexistent-node-runtime"),
        );
        assert!(result
            .unwrap_err()
            .starts_with("side_question_node_required: install Node.js >=22.19.0"));
    }
    #[test]
    fn registry_cancel_duplicate_cleanup_and_retirement() {
        let id = "registry-test";
        cancel("unknown");
        let first = Registration::new(id.into()).unwrap();
        assert!(Registration::new(id.into()).is_err());
        cancel(id);
        assert!(first.is_cancelled());
        drop(first);
        assert!(Registration::new(id.into()).is_err());
    }
    #[test]
    fn tombstones_fence_both_operation_types_and_are_bounded() {
        for id in ["cancel-before-inference", "cancel-before-context"] {
            cancel(id);
            cancel(id);
            assert!(Registration::new(id.into()).is_err());
        }
        let mut registry = Registry::default();
        for index in 0..MAX_TOMBSTONES + 20 {
            registry.retire(format!("bounded-{index}"));
        }
        assert_eq!(registry.retired.len(), MAX_TOMBSTONES);
        registry
            .retired
            .insert("expired".into(), Instant::now() - TOMBSTONE_TTL);
        assert!(registry.register("expired").is_ok());
    }
    #[test]
    fn pre_cancelled_request_does_not_spawn() {
        let registration = Registration::new("pre-cancel-test".into()).unwrap();
        cancel("pre-cancel-test");
        assert_eq!(
            run(
                None,
                serde_json::json!({}),
                registration,
                Duration::from_secs(1),
                |_| {}
            )
            .unwrap_err(),
            "side_question_cancelled"
        );
    }
    fn mock_command(code: &str) -> Command {
        let mut command = Command::new("node");
        command.arg("--eval").arg(code);
        command
    }
    fn payload() -> serde_json::Value {
        serde_json::json!({"type": "ask", "requestId": "r", "threadId": "t"})
    }
    #[test]
    fn mock_child_streams_and_flushes_final_before_exit() {
        let mut progress = Vec::new();
        let result = run_command(payload(), Registration::new("stream-test".into()).unwrap(),
            Duration::from_secs(5), |text| progress.push(text), mock_command(r#"
            process.stdin.once('data', () => {
                console.log(JSON.stringify({type:'delta',requestId:'r',threadId:'t',text:'first'}));
                console.log(JSON.stringify({type:'delta',requestId:'r',threadId:'t',text:'first second'}));
                process.stdout.write(JSON.stringify({type:'done',requestId:'r',threadId:'t',answer:'first second'})+'\n', () => process.exit(0));
            });"#)).unwrap();
        assert_eq!(progress, ["first", "first second"]);
        assert_eq!(result["answer"], "first second");
        assert!(Registration::new("stream-test".into()).is_err());
    }
    #[test]
    fn mock_child_timeout_and_cancel_release_owned_process() {
        let start = Instant::now();
        let result = run_command(
            payload(),
            Registration::new("timeout-test".into()).unwrap(),
            Duration::from_millis(100),
            |_| {},
            mock_command("setInterval(() => {}, 1000)"),
        );
        assert_eq!(result.unwrap_err(), "side_question_timeout");
        assert!(start.elapsed() < Duration::from_secs(5));
        let registration = Registration::new("cancel-running-test".into()).unwrap();
        let cancel_thread = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(100));
            cancel("cancel-running-test");
        });
        let result = run_command(
            payload(),
            registration,
            Duration::from_secs(5),
            |_| {},
            mock_command("setInterval(() => {}, 1000)"),
        );
        cancel_thread.join().unwrap();
        assert_eq!(result.unwrap_err(), "side_question_cancelled");
        assert!(Registration::new("cancel-running-test".into()).is_err());
    }
    #[test]
    fn context_registration_cancels_owned_child_and_pre_registration_cancel_fences_spawn() {
        let id = "owned-context-cancel";
        let registration = Registration::new(id.into()).unwrap();
        let cancelling = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            cancel(id);
        });
        let result = run_command(
            serde_json::json!({"type": "context"}),
            registration,
            Duration::from_secs(5),
            |_| {},
            mock_command("setInterval(() => {}, 1000)"),
        );
        cancelling.join().unwrap();
        assert_eq!(result.unwrap_err(), "side_question_cancelled");
        assert!(Registration::new(id.into()).is_err());
        // A duplicated cancellation arriving after cleanup cannot resurrect ownership.
        cancel(id);
        assert!(Registration::new(id.into()).is_err());
    }
    #[test]
    fn mock_child_rejects_invalid_protocol_identity_and_exit() {
        for (index, (code, expected)) in [
            ("console.log('not-json')", "side_question_protocol"),
            (
                "console.log(JSON.stringify({type:'done',requestId:'wrong',threadId:'t'}))",
                "side_question_identity",
            ),
            (
                "console.log(JSON.stringify({type:'context'}))",
                "side_question_protocol",
            ),
            ("process.exit(2)", "side_question_exit"),
            ("process.exit(0)", "side_question_empty_answer"),
            ("console.log('x'.repeat(2000001))", "side_question_frame"),
        ]
        .iter()
        .enumerate()
        {
            let result = run_command(
                payload(),
                Registration::new(format!("protocol-test-{index}")).unwrap(),
                Duration::from_secs(5),
                |_| {},
                mock_command(code),
            );
            assert_eq!(result.unwrap_err(), *expected);
        }
    }

    #[test]
    fn actual_runtime_context_protocol_source_and_relocated_staging() {
        let root = std::env::temp_dir().join(format!("side-question-ipc-{}", uuid::Uuid::new_v4()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone());
        std::fs::create_dir_all(&root).unwrap();
        let fixture = root.join("source with spaces 中文.jsonl");
        let original = [
            serde_json::json!({"type":"session","version":3,"id":"fixture-ipc","cwd":root,"timestamp":"2026-01-01T00:00:00Z"}),
            serde_json::json!({"type":"message","id":"u","parentId":null,"timestamp":"2026-01-01T00:00:01Z",
                "message":{"role":"user","content":[{"type":"text","text":"fixture snapshot"}],"timestamp":1}}),
        ].iter().map(|entry| format!("{}\n", entry)).collect::<String>();
        std::fs::write(&fixture, &original).unwrap();
        let payload = serde_json::json!({"type":"context","sourceSessionId":"fixture-ipc","sessionPath":fixture});
        // Exercise the public production process entry and its real Node/SDK JSON protocol.
        let source = run(
            None,
            payload.clone(),
            Registration::new(uuid::Uuid::new_v4().to_string()).unwrap(),
            Duration::from_secs(30),
            |_| {},
        )
        .unwrap();
        assert_eq!(source["type"], "context");
        assert_eq!(source["available"], true);
        assert_eq!(source["text"], "user: fixture snapshot");
        let output = root.join("build-output");
        let staging = Command::new("node")
            .arg(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../scripts/stage-side-question-runtime.mjs"),
            )
            .arg("--output")
            .arg(&output)
            .output()
            .unwrap();
        assert!(
            staging.status.success(),
            "runtime staging failed (output suppressed)"
        );
        let installed = root.join("installed application");
        std::fs::create_dir_all(installed.join("resources")).unwrap();
        std::fs::rename(output, installed.join("resources/side-question")).unwrap();
        // Same process implementation, explicitly exercising release-only resolution in a debug test.
        let relocated = run_runtime(
            Some(installed.clone()),
            payload.clone(),
            Registration::new(uuid::Uuid::new_v4().to_string()).unwrap(),
            Duration::from_secs(30),
            |_| {},
            false,
        )
        .unwrap();
        assert_eq!(relocated, source);
        let mut mismatch = payload.clone();
        mismatch["sourceSessionId"] = "wrong-exact-id".into();
        let rejected = run_runtime(
            Some(installed.clone()),
            mismatch,
            Registration::new(uuid::Uuid::new_v4().to_string()).unwrap(),
            Duration::from_secs(30),
            |_| {},
            false,
        )
        .unwrap();
        assert_eq!(rejected["reason"], "source_identity_mismatch");
        assert_eq!(std::fs::read_to_string(&fixture).unwrap(), original);
        std::fs::remove_file(&fixture).unwrap();
        let missing = run_runtime(
            Some(installed),
            payload,
            Registration::new(uuid::Uuid::new_v4().to_string()).unwrap(),
            Duration::from_secs(30),
            |_| {},
            false,
        )
        .unwrap();
        assert_eq!(missing["reason"], "source_read_failed");
    }

    /// Opt-in local diagnostic: never print source identity, path, payload or text.
    #[test]
    #[ignore = "requires an explicitly authorized local session fixture"]
    fn authorized_local_context_probe() {
        let path = std::env::var("SIDE_QUESTION_PROBE_PATH").expect("set authorized fixture path");
        let id = std::env::var("SIDE_QUESTION_PROBE_ID").expect("set exact fixture identity");
        let payload = serde_json::json!({"type":"context","sourceSessionId":id,"sessionPath":path});
        let resource_dir =
            std::env::var_os("SIDE_QUESTION_PROBE_RESOURCES").map(std::path::PathBuf::from);
        let value = if let Some(root) = resource_dir {
            run_runtime(
                Some(root),
                payload,
                Registration::new(uuid::Uuid::new_v4().to_string()).unwrap(),
                Duration::from_secs(30),
                |_| {},
                false,
            )
        } else {
            run(
                None,
                payload,
                Registration::new(uuid::Uuid::new_v4().to_string()).unwrap(),
                Duration::from_secs(30),
                |_| {},
            )
        }
        .unwrap_or_else(|error| {
            panic!(
                "context probe failed: {}",
                match error.as_str() {
                    "side_question_protocol" => "protocol",
                    "side_question_exit" => "exit",
                    "side_question_timeout" => "timeout",
                    _ => "process (details suppressed)",
                }
            )
        });
        eprintln!(
            "context probe available={} chars={} reason={}",
            value["available"],
            value["text"].as_str().unwrap_or_default().chars().count(),
            value["reason"]
                .as_str()
                .map(super::super::safe_snapshot_reason)
                .unwrap_or("context_available")
        );
        assert_eq!(
            value["available"], true,
            "context unavailable (payload suppressed)"
        );
    }
}
