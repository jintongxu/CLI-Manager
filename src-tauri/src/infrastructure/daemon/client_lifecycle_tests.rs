use super::*;
use std::time::Instant;

fn fixture() -> (tempfile::TempDir, std::process::Child, DaemonInfo) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.json");
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "daemon::server::ownership_tests::owner_daemon_fixture",
            "--nocapture",
        ])
        .env("CLI_MANAGER_OWNED_DAEMON_FIXTURE", &path)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let info = loop {
        if let Ok(Some(info)) = super::super::discovery::read_daemon_info(&path) {
            break info;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(child.id(), info.pid);
    (dir, child, info)
}
fn dispatch(client: &DaemonClient, frame: DaemonFrame) {
    if let Some(id) = serde_json::to_value(&frame)
        .ok()
        .and_then(|v| v["id"].as_u64())
    {
        if let Some(sender) = client.pending.lock().unwrap().remove(&id) {
            let _ = sender.send(frame);
        }
    }
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(10)
}

#[test]
fn owner_client_last_stop_resume_allows_new_clean_connection() {
    let (_dir, mut child, info) = fixture();
    let bridge = DaemonBridge::new();
    let client = bridge
        .connect(|| DaemonClient::connect_transport(info, dispatch))
        .unwrap();
    bridge.prepare_exit("stop").unwrap();
    client.prepare_owner_exit("stop", deadline()).unwrap();
    let receipt = client.owner_exit_until("stop", deadline()).unwrap();
    assert_eq!(receipt.daemon_status, "stopped");
    assert!(child.wait().unwrap().success());
    // This succeeds with a closed socket, preserving the verified receipt.
    client.resume_owner_exit("stop", deadline()).unwrap();
    bridge.resume_exit("stop").unwrap();
    let (_next_dir, mut next_child, next_info) = fixture();
    let next = bridge
        .connect(|| DaemonClient::connect_transport(next_info, dispatch))
        .unwrap();
    assert_ne!(next.owner_binding(), client.owner_binding());
    next.prepare_owner_exit("next", deadline()).unwrap();
    assert_eq!(
        next.owner_exit_until("next", deadline())
            .unwrap()
            .daemon_status,
        "stopped"
    );
    assert!(next_child.wait().unwrap().success());
}

#[test]
fn owner_client_shared_resume_reconnect_restores_same_identity() {
    let (_dir, mut child, info) = fixture();
    let first = DaemonClient::connect_transport(info.clone(), dispatch).unwrap();
    // Separate simulated native owner, on an authenticated socket.
    super::super::client_owner::released(&info.token, first.owner_binding().unwrap());
    let other = DaemonClient::connect_transport(info.clone(), dispatch).unwrap();
    super::super::client_owner::released(&info.token, other.owner_binding().unwrap());
    // Restore first's cache via the same bind handshake, before release.
    super::super::client_owner::restore(&info.token, first.owner_binding().unwrap()).unwrap();
    let session = uuid::Uuid::new_v4().to_string();
    let id = first.next_request_id();
    assert!(matches!(
        first
            .request(
                id,
                &ClientFrame::Create {
                    id,
                    session_id: session.clone(),
                    cwd: None,
                    env_vars: None,
                    shell: Some("cmd.exe".into()),
                    ssh_launch: None,
                    terminal_colors: None
                }
            )
            .unwrap(),
        DaemonFrame::Created { .. }
    ));
    first.prepare_owner_exit("shared", deadline()).unwrap();
    let receipt = first.owner_exit_until("shared", deadline()).unwrap();
    assert_eq!(receipt.daemon_status, "retained_shared");
    assert_eq!(
        receipt.sessions.get(&session).map(String::as_str),
        Some("stopped")
    );
    first.resume_owner_exit("shared", deadline()).unwrap();
    let reconnect = DaemonClient::connect_transport(info.clone(), dispatch).unwrap();
    assert_eq!(first.owner_binding(), reconnect.owner_binding());
    reconnect
        .prepare_owner_exit("final-first", deadline())
        .unwrap();
    assert_eq!(
        reconnect
            .owner_exit_until("final-first", deadline())
            .unwrap()
            .daemon_status,
        "retained_shared"
    );
    other.prepare_owner_exit("final-other", deadline()).unwrap();
    assert_eq!(
        other
            .owner_exit_until("final-other", deadline())
            .unwrap()
            .daemon_status,
        "stopped"
    );
    assert!(child.wait().unwrap().success());
}

#[test]
fn owner_client_disconnected_is_not_absent_and_partial_prepare_abort() {
    let (_dir, mut child, info) = fixture();
    let bridge = DaemonBridge::new();
    let client = bridge
        .connect(|| DaemonClient::connect_transport(info.clone(), dispatch))
        .unwrap();
    client.connected.store(false, Ordering::SeqCst);
    assert!(bridge.get().is_none());
    assert!(bridge.prepare_exit("disconnected").unwrap().is_some());
    bridge.resume_exit("disconnected").unwrap();
    client.connected.store(true, Ordering::SeqCst);
    // A legacy adapter has no owner capability: prepare never sent a remote fence.
    let mut legacy_info = info.clone();
    legacy_info.features.clear();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (_peer, _) = listener.accept().unwrap();
    let legacy = DaemonClient {
        info: legacy_info,
        owner: None,
        process: None,
        exit_receipt: Mutex::new(None),
        spawned_child: Mutex::new(None),
        writer: Mutex::new(stream),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        connected: Arc::new(AtomicBool::new(true)),
        owner_released: AtomicBool::new(false),
        prepare_pending: Mutex::new(None),
    };
    let cc = crate::commands::cc_connect::CcConnectManager::new();
    let live = crate::live_server::LiveServerManager::new();
    cc.prepare_exit(deadline()).unwrap();
    live.prepare_exit(deadline()).unwrap();
    assert_eq!(
        legacy
            .prepare_owner_exit("partial", deadline())
            .unwrap_err(),
        "daemon_ownership_unsupported"
    );
    legacy.abort_owner_exit("partial", deadline()).unwrap();
    cc.resume_after_exit();
    live.resume_after_exit();
    cc.prepare_exit(deadline()).unwrap();
    live.prepare_exit(deadline()).unwrap();
    cc.resume_after_exit();
    live.resume_after_exit();
    assert_eq!(legacy.next_id.load(Ordering::SeqCst), 1); // no remote reopen RPC
    assert_eq!(
        client
            .prepare_owner_exit("expired", Instant::now())
            .unwrap_err(),
        "owner_prepare_timeout"
    );
    // Uncertain fence state requires an authenticated remote acknowledgement.
    client.abort_owner_exit("expired", deadline()).unwrap();
    client.prepare_owner_exit("cleanup", deadline()).unwrap();
    assert_eq!(
        client
            .owner_exit_until("cleanup", deadline())
            .unwrap()
            .daemon_status,
        "stopped"
    );
    assert!(child.wait().unwrap().success());
}
