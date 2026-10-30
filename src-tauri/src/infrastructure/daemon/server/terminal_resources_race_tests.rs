use super::*;

#[test]
fn terminal_resources_close_recreate_handler_race_rejects_same_owner_aba() {
    let server = DaemonServer {
        host: Arc::new(DaemonHost::new()),
        next_client_id: AtomicU64::new(1),
        token: "test".into(),
        version: "test".into(),
        info_path: PathBuf::new(),
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let _connection = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (accepted, _) = listener.accept().unwrap();
    server.host.clients.lock().unwrap().insert(
        1,
        ClientHandle {
            writer: ClientWriter::new(ClientTransport::Ndjson(Mutex::new(accepted))),
            attached: HashSet::new(),
            unacknowledged_chars: HashMap::new(),
            flow_control_paused: HashSet::new(),
            last_sent_sequence: HashMap::new(),
            last_acknowledged_sequence: HashMap::new(),
            attaching: HashMap::new(),
        },
    );
    let owner = InstanceId(uuid::Uuid::new_v4().to_string());
    assert!(matches!(
        server.handle_frame(
            1,
            ClientFrame::RegisterOwner {
                id: 1,
                instance_id: owner.clone()
            }
        ),
        DaemonFrame::OwnerRegistered { .. }
    ));
    let sid = format!("resource-race-{}", uuid::Uuid::new_v4());
    let create = || ClientFrame::Create {
        id: 2,
        session_id: sid.clone(),
        cwd: None,
        env_vars: None,
        shell: Some(if cfg!(windows) { "cmd.exe" } else { "/bin/sh" }.into()),
        ssh_launch: None,
        terminal_colors: None,
    };
    let created = server.handle_frame(1, create());
    assert!(
        matches!(created, DaemonFrame::Created { .. }),
        "{created:?}"
    );
    // RAII cleanup covers assertion failures too; only this test's unique fixture is closed.
    struct Cleanup<'a>(&'a DaemonServer, String);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            let _ = self.0.handle_frame(
                1,
                ClientFrame::Close {
                    id: 99,
                    session_id: self.1.clone(),
                },
            );
        }
    }
    let _cleanup = Cleanup(&server, sid.clone());
    let original = server.host.pty.resource_child(&sid).unwrap();
    let before = server.host.ownership.lock().unwrap().observation_revision;
    let raced = server.terminal_resources_observe(1, 3, vec![sid.clone()], || {
        // This callback is outside the admission lock and after real sampling, before
        // final authorization. Both mutations use the real registered frame handler.
        assert!(matches!(
            server.handle_frame(
                1,
                ClientFrame::Close {
                    id: 4,
                    session_id: sid.clone()
                }
            ),
            DaemonFrame::Ok { .. }
        ));
        assert!(matches!(
            server.handle_frame(1, create()),
            DaemonFrame::Created { .. }
        ));
        assert!(!server.host.pty.resource_child_current(&sid, &original));
        let state = server.host.ownership.lock().unwrap();
        assert_eq!(state.sessions.get(&sid), Some(&owner));
        assert_ne!(state.observation_revision, before);
    });
    assert!(matches!(raced, DaemonFrame::Err { message, .. } if message == resources::INVALIDATED));
    let fresh = server.handle_frame(
        1,
        ClientFrame::TerminalResources {
            id: 5,
            session_ids: vec![sid],
        },
    );
    assert!(matches!(fresh, DaemonFrame::TerminalResources { .. }));
}
