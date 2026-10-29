use super::*;
use crate::daemon::protocol::{encode_frame, decode_daemon_frame, InstanceId, OwnerBinding, SessionScope};
use std::io::Write;
use tungstenite::client::IntoClientRequest;

fn native(server: &Arc<DaemonServer>) -> (TcpStream, BufReader<TcpStream>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let server = server.clone();
    std::thread::spawn(move || server.handle_connection(listener.accept().unwrap().0));
    let stream = TcpStream::connect(addr).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut writer = stream.try_clone().unwrap();
    let mut reader = BufReader::new(stream);
    writer.write_all(encode_frame(&ClientFrame::Auth { token: "test".into(), client_version: "test".into() }).as_bytes()).unwrap();
    assert!(matches!(decode_daemon_frame(&read_line_bounded(&mut reader).unwrap()).unwrap(), DaemonFrame::AuthOk { .. }));
    (writer, reader)
}
fn rpc(writer: &mut TcpStream, reader: &mut BufReader<TcpStream>, frame: ClientFrame) -> DaemonFrame {
    writer.write_all(encode_frame(&frame).as_bytes()).unwrap();
    decode_daemon_frame(&read_line_bounded(reader).unwrap()).unwrap()
}
fn ws_rpc(ws: &mut WebSocket<TcpStream>, frame: ClientFrame, id: u64) -> DaemonFrame {
    ws.send(Message::Text(encode_frame(&frame).into())).unwrap();
    loop {
        if let Message::Text(text) = ws.read().unwrap() {
            let value: serde_json::Value = serde_json::from_str(&text).unwrap();
            if value["id"].as_u64() == Some(id) { return decode_daemon_frame(&text).unwrap(); }
        }
    }
}
#[test]
fn owner_native_ws_execution_isolation_and_reconnect() {
    let server = Arc::new(DaemonServer { host: Arc::new(DaemonHost::new()),
        next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() });
    let (mut a, mut ar) = native(&server);
    // Exercise the exact handshake used by DaemonClient (no Tauri runtime required).
    let cache_key = uuid::Uuid::new_v4().to_string();
    let binding = crate::daemon::client_owner::establish(&supported_features(), &cache_key, &mut a, &mut ar).unwrap().unwrap();
    let (mut b, mut br) = native(&server);
    assert!(matches!(rpc(&mut b, &mut br, ClientFrame::RegisterOwner { id: 1, instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }), DaemonFrame::OwnerRegistered { .. }));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let serving = server.clone();
    std::thread::spawn(move || serving.handle_websocket_connection(listener.accept().unwrap().0));
    let stream = TcpStream::connect(addr).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let mut request = format!("ws://{addr}/pty").into_client_request().unwrap();
    request.headers_mut().insert("origin", "http://localhost:1420".parse().unwrap());
    let (mut ws, _) = tungstenite::client(request, stream).unwrap();
    ws.send(Message::Text(encode_frame(&ClientFrame::Auth { token: "test".into(), client_version: "test".into() }).into())).unwrap();
    assert!(matches!(ws.read().unwrap(), Message::Text(_)));
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::TerminalResources { id: 77, session_ids: vec![] }, 77),
        DaemonFrame::Err { message, .. } if message == crate::daemon::terminal_resources::NATIVE_ONLY));
    let mut stale: OwnerBinding = binding.clone();
    stale.daemon_epoch.0 = uuid::Uuid::new_v4().to_string();
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::BindOwner { id: 2, binding: stale }, 2), DaemonFrame::Err { .. }));
    let mut wrong_token = binding.clone();
    wrong_token.owner_token.0 = uuid::Uuid::new_v4().to_string();
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::BindOwner { id: 2, binding: wrong_token }, 2), DaemonFrame::Err { .. }));
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::BindOwner { id: 3, binding: binding.clone() }, 3), DaemonFrame::Ok { .. }));
    let session = uuid::Uuid::new_v4().to_string();
    // Only this test's shell is created or terminated.
    let shell = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::Create { id: 4, session_id: session.clone(), cwd: None, env_vars: None,
        shell: Some(shell.into()), ssh_launch: None, terminal_colors: None }, 4), DaemonFrame::Created { .. }));
    for frame in [ClientFrame::Write { id: 5, session_id: session.clone(), data: "echo forbidden\r".into() },
        ClientFrame::Resize { id: 5, session_id: session.clone(), cols: 90, rows: 30, pixel_width: None, pixel_height: None },
        ClientFrame::Close { id: 5, session_id: session.clone() }] {
        assert!(matches!(rpc(&mut b, &mut br, frame), DaemonFrame::Err { message, .. } if message == "session_owner_mismatch"));
    }
    assert!(matches!(rpc(&mut b, &mut br, ClientFrame::CloseAll { id: 6 }), DaemonFrame::Ok { .. }));
    assert!(server.host.get_session(&session).is_some());
    assert!(matches!(rpc(&mut b, &mut br, ClientFrame::Shutdown { id: 6 }), DaemonFrame::Ok { .. }));
    let DaemonFrame::SessionScopes { scopes, .. } = rpc(&mut b, &mut br, ClientFrame::SessionScopes { id: 6 }) else { panic!("foreign scopes"); };
    assert_eq!(scopes.get(&session), Some(&SessionScope::Foreign));
    let (mut legacy, mut lr) = native(&server);
    assert!(matches!(rpc(&mut legacy, &mut lr, ClientFrame::Close { id: 7, session_id: session.clone() }), DaemonFrame::Err { .. }));
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::Write { id: 8, session_id: session.clone(), data: "echo owned\r".into() }, 8), DaemonFrame::Ok { .. }));
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::Resize { id: 9, session_id: session.clone(), cols: 90, rows: 30, pixel_width: None, pixel_height: None }, 9), DaemonFrame::Ok { .. }));
    // Failed spawn must remove both the reservation and ownership entry so retry is possible.
    let failed_session = uuid::Uuid::new_v4().to_string();
    assert!(matches!(ws_rpc(&mut ws, ClientFrame::Create { id: 12, session_id: failed_session.clone(), cwd: None,
        env_vars: None, shell: Some("/definitely-missing/owner-test-shell".into()), ssh_launch: None, terminal_colors: None }, 12), DaemonFrame::Err { .. }));
    assert!(server.host.get_session(&failed_session).is_none());
    let _ = ws.close(None);
    drop(a); drop(ar);
    let (mut reconnect, mut rr) = native(&server);
    assert_eq!(crate::daemon::client_owner::establish(&supported_features(), &cache_key, &mut reconnect, &mut rr).unwrap(), Some(binding.clone()));
    let DaemonFrame::SessionScopes { scopes, .. } = rpc(&mut reconnect, &mut rr, ClientFrame::SessionScopes { id: 10 }) else { panic!("scopes"); };
    assert_eq!(scopes.get(&session), Some(&SessionScope::Owned));
    assert!(matches!(rpc(&mut reconnect, &mut rr, ClientFrame::CloseAll { id: 11 }), DaemonFrame::Ok { .. }));
    assert!(server.host.get_session(&session).is_none());
    let DaemonFrame::OwnerExitResult { receipt, .. } = rpc(&mut reconnect, &mut rr,
        ClientFrame::OwnerExit { id: 13, transaction_id: "native-empty".into(), binding }) else { panic!("native owner exit"); };
    assert!(receipt.owner_released);
    assert_eq!(receipt.daemon_status, "retained_shared");
}

#[cfg(windows)]
fn exit_test_connection(server: &DaemonServer, client: u64) -> TcpStream {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (accepted, _) = listener.accept().unwrap();
    server.host.clients.lock().unwrap().insert(client, ClientHandle {
        writer: ClientWriter::new(ClientTransport::Ndjson(Mutex::new(accepted))),
        attached: HashSet::new(), unacknowledged_chars: HashMap::new(), flow_control_paused: HashSet::new(),
        last_sent_sequence: HashMap::new(), last_acknowledged_sequence: HashMap::new(), attaching: HashMap::new(),
    });
    stream
}

#[cfg(windows)]
#[test]
fn owner_exit_two_owners_retry_and_fenced_creation() {
    let server = Arc::new(DaemonServer { host: Arc::new(DaemonHost::new()),
        next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() });
    let _a = exit_test_connection(&server, 501);
    let _b = exit_test_connection(&server, 502);
    let mut bindings = Vec::new();
    for client in [501, 502] {
        let DaemonFrame::OwnerRegistered { binding, .. } = server.handle_frame(client,
            ClientFrame::RegisterOwner { id: 1, instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }) else { panic!("register"); };
        bindings.push(binding);
        assert!(matches!(server.handle_frame(client, ClientFrame::Create { id: 2,
            session_id: format!("exit-owned-{client}"), cwd: None, env_vars: None,
            shell: Some("cmd.exe".into()), ssh_launch: None, terminal_colors: None }), DaemonFrame::Created { .. }));
    }
    // Zero budget does not discard the child/controller/reader: subsequent owner drain retries it.
    assert!(server.host.pty.close_until("exit-owned-501", Instant::now()).is_err());
    let exit = ClientFrame::OwnerExit { id: 3, transaction_id: "txn".into(), binding: bindings[0].clone() };
    let DaemonFrame::OwnerExitResult { receipt, .. } = server.handle_frame(501, exit.clone()) else { panic!("exit"); };
    assert!(receipt.owner_released, "{receipt:?}");
    assert_eq!(receipt.sessions["exit-owned-501"], "stopped");
    assert_eq!(receipt.daemon_status, "retained_shared");
    assert!(server.host.get_session("exit-owned-502").is_some());
    assert_eq!(server.handle_frame(501, exit), DaemonFrame::OwnerExitResult { id: 3, receipt });
    assert!(matches!(server.handle_frame(501, ClientFrame::Create { id: 4, session_id: "late".into(),
        cwd: None, env_vars: None, shell: Some("cmd.exe".into()), ssh_launch: None, terminal_colors: None }),
        DaemonFrame::Err { message, .. } if message == "owner_draining"));
    let DaemonFrame::OwnerExitResult { receipt, .. } = server.handle_frame(502, ClientFrame::OwnerExit {
        id: 5, transaction_id: "other".into(), binding: bindings[1].clone() }) else { panic!("cleanup"); };
    assert!(receipt.owner_released);
}

#[cfg(windows)]
#[test]
fn owner_exit_creation_race_and_protocol_compatibility() {
    let server = Arc::new(DaemonServer { host: Arc::new(DaemonHost::new()),
        next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() });
    let _connection = exit_test_connection(&server, 600);
    let DaemonFrame::OwnerRegistered { binding, .. } = server.handle_frame(600,
        ClientFrame::RegisterOwner { id: 1, instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }) else { panic!("register"); };
    let other = server.clone();
    let spawn = std::thread::spawn(move || other.handle_frame(600, ClientFrame::Create { id: 2,
        session_id: "racing-owned".into(), cwd: None, env_vars: None, shell: Some("cmd.exe".into()),
        ssh_launch: None, terminal_colors: None }));
    let exit = ClientFrame::OwnerExit { id: 3, transaction_id: "race".into(), binding };
    let wire = encode_frame(&exit);
    assert_eq!(crate::daemon::protocol::decode_client_frame(&wire).unwrap(), exit);
    let mut result = server.handle_frame(600, exit.clone());
    let created = spawn.join().unwrap();
    for _ in 0..3 {
        if matches!(&result, DaemonFrame::OwnerExitResult { receipt, .. } if receipt.owner_released) { break; }
        result = server.handle_frame(600, exit.clone());
    }
    assert!(matches!(created, DaemonFrame::Created { .. } | DaemonFrame::Err { .. }));
    assert!(matches!(result, DaemonFrame::OwnerExitResult { receipt, .. } if receipt.owner_released));
    assert!(server.host.get_session("racing-owned").is_none());
    assert!(matches!(crate::daemon::protocol::decode_client_frame("{\"type\":\"future_owner_exit\"}"),
        Err(crate::daemon::protocol::ProtocolError::UnknownType(_))));
}

#[test]
fn owner_daemon_fixture() {
    let Ok(path) = std::env::var("CLI_MANAGER_OWNED_DAEMON_FIXTURE") else { return; };
    DaemonServer::run(DaemonServerConfig { info_path: PathBuf::from(path), version: "fixture".into() }).unwrap();
}

#[cfg(windows)]
#[test]
fn owner_last_runtime_drain_os_exit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.json");
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "daemon::server::ownership_tests::owner_daemon_fixture", "--nocapture"])
        .env("CLI_MANAGER_OWNED_DAEMON_FIXTURE", &path).spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let info = loop {
        if let Ok(Some(info)) = crate::daemon::discovery::read_daemon_info(&path) { break info; }
        assert!(Instant::now() < deadline, "fixture discovery timeout");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(info.pid, child.id());
    let mut stream = TcpStream::connect(("127.0.0.1", info.port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let auth = rpc(&mut stream, &mut reader, ClientFrame::Auth { token: info.token, client_version: "test".into() });
    let DaemonFrame::AuthOk { pid, process_start_time: Some(start), .. } = auth else { panic!("identity handshake"); };
    let process = crate::daemon::process_identity::VerifiedProcess::open(pid, start).unwrap();
    let DaemonFrame::OwnerRegistered { binding, .. } = rpc(&mut stream, &mut reader,
        ClientFrame::RegisterOwner { id: 1, instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }) else { panic!("register"); };
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let _ = rpc(&mut stream, &mut reader, ClientFrame::RoutingStart { id: 2, listen_address: None,
        preferred_port: Some(port), last_actual_port: None, listener_addresses: vec![] });
    assert!(TcpStream::connect(("127.0.0.1", port)).is_ok());
    let DaemonFrame::OwnerExitResult { receipt, .. } = rpc(&mut stream, &mut reader,
        ClientFrame::OwnerExit { id: 3, transaction_id: "fixture-exit".into(), binding }) else { panic!("exit"); };
    assert!(receipt.owner_released, "{receipt:?}");
    assert_eq!(receipt.daemon_status, "stopping");
    process.wait_until(Instant::now() + Duration::from_secs(8)).unwrap();
    assert!(child.wait().unwrap().success());
    assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    assert!(TcpStream::connect(("127.0.0.1", info.port)).is_err());
}

#[cfg(windows)]
#[test]
fn owner_runtime_shared_unknown_and_final_fence() {
    let server = Arc::new(DaemonServer { host: Arc::new(DaemonHost::new()),
        next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() });
    let mut bindings = Vec::new();
    for client in [1, 2] {
        let DaemonFrame::OwnerRegistered { binding, .. } = server.handle_frame(client,
            ClientFrame::RegisterOwner { id: 1, instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }) else { panic!(); };
        bindings.push(binding);
        let _ = server.handle_frame(client, ClientFrame::RoutingStart { id: 2, listen_address: None,
            preferred_port: None, last_actual_port: None, listener_addresses: vec![] });
    }
    let exit = |client, binding| server.handle_frame(client, ClientFrame::OwnerExit { id: 3, transaction_id: "exit".into(), binding });
    let DaemonFrame::OwnerExitResult { receipt, .. } = exit(1, bindings[0].clone()) else { panic!(); };
    assert_eq!(receipt.daemon_status, "retained_shared");
    assert!(server.host.routing_is_running());
    let DaemonFrame::OwnerExitResult { receipt, .. } = exit(2, bindings[1].clone()) else { panic!(); };
    assert_eq!(receipt.daemon_status, "stopping");
    assert!(!server.host.routing_is_running());
    assert!(matches!(server.handle_frame(3, ClientFrame::RegisterOwner { id: 4,
        instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }), DaemonFrame::Err { .. }));

    let unknown = DaemonServer { host: Arc::new(DaemonHost::new()), next_client_id: AtomicU64::new(1),
        token: "test".into(), version: "test".into(), info_path: PathBuf::new() };
    unknown.host.routing_start(&["127.0.0.1".into()], FALLBACK_PORT_START, None).unwrap();
    let DaemonFrame::OwnerRegistered { binding, .. } = unknown.handle_frame(1,
        ClientFrame::RegisterOwner { id: 1, instance_id: InstanceId(uuid::Uuid::new_v4().to_string()) }) else { panic!(); };
    let DaemonFrame::OwnerExitResult { receipt, .. } = unknown.handle_frame(1,
        ClientFrame::OwnerExit { id: 2, transaction_id: "unknown".into(), binding }) else { panic!(); };
    assert_eq!(receipt.daemon_status, "unsupported");
    assert!(unknown.host.routing_is_running());
    unknown.host.routing_stop().unwrap();
}

#[cfg(windows)]
#[test]
fn owner_legacy_runtime_retained_and_cache_lifecycle() {
    let server = Arc::new(DaemonServer { host: Arc::new(DaemonHost::new()),
        next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() });
    let (mut a, mut ar) = native(&server);
    let cache = uuid::Uuid::new_v4().to_string();
    let binding = crate::daemon::client_owner::establish(&supported_features(), &cache, &mut a, &mut ar).unwrap().unwrap();
    let _ = server.handle_frame(990, ClientFrame::RoutingStart { id: 2, listen_address: None,
        preferred_port: None, last_actual_port: None, listener_addresses: vec![] });
    let DaemonFrame::OwnerExitResult { receipt, .. } = rpc(&mut a, &mut ar,
        ClientFrame::OwnerExit { id: 3, transaction_id: "legacy".into(), binding: binding.clone() }) else { panic!(); };
    assert_eq!(receipt.daemon_status, "retained_shared");
    assert!(receipt.owner_released);
    assert!(server.host.routing_is_running());
    crate::daemon::client_owner::released(&cache, &binding);
    let (mut b, mut br) = native(&server);
    let fresh = crate::daemon::client_owner::establish(&supported_features(), &cache, &mut b, &mut br).unwrap().unwrap();
    assert_ne!(fresh.instance_id, binding.instance_id);
    // Old connection remains an idempotent tombstone, not a revived owner.
    let DaemonFrame::OwnerExitResult { receipt: duplicate, .. } = rpc(&mut a, &mut ar,
        ClientFrame::OwnerExit { id: 4, transaction_id: "legacy".into(), binding }) else { panic!(); };
    assert_eq!(receipt, duplicate);
    let _ = server.handle_frame(990, ClientFrame::RoutingStop { id: 5 });
}

/// Controlled in-process server: exercises real prepare/admission/owner drain without
/// discovery, user processes, or the daemon executable's process-exit loop.
#[cfg(test)]
pub(crate) fn controlled_exit_receipt(transaction: &str) -> crate::daemon::protocol::OwnerExitReceipt {
    let server = DaemonServer { host: Arc::new(DaemonHost::new()), next_client_id: AtomicU64::new(1), token: "fixture".into(), version: "fixture".into(), info_path: PathBuf::new() };
    let mut bindings = Vec::new();
    for client in [1, 2] {
        let DaemonFrame::OwnerRegistered { binding, .. } = server.handle_frame(client, ClientFrame::RegisterOwner { id: client, instance_id: crate::daemon::protocol::InstanceId(uuid::Uuid::new_v4().to_string()) }) else { panic!("register") };
        bindings.push(binding);
    }
    let binding = bindings.remove(0);
    assert!(matches!(server.handle_frame(1, ClientFrame::PrepareOwnerExit { id: 3, transaction_id: transaction.into(), binding: binding.clone() }), DaemonFrame::Ok { .. }));
    assert!(matches!(server.handle_frame(1, ClientFrame::Create { id: 4, session_id: "blocked".into(), cwd: None, env_vars: None, shell: Some("nonexistent-exit-fixture".into()), ssh_launch: None, terminal_colors: None }), DaemonFrame::Err { message, .. } if message == "owner_draining"));
    let DaemonFrame::OwnerExitResult { receipt, .. } = server.handle_frame(1, ClientFrame::OwnerExit { id: 5, transaction_id: transaction.into(), binding }) else { panic!("exit") };
    assert_eq!(receipt.daemon_status, "retained_shared");
    assert!(!server.host.ownership.lock().unwrap().draining);
    receipt
}
