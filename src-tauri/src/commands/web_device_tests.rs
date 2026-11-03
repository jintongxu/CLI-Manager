use super::*;

#[test]
fn web_device_blocking_work_runs_off_the_calling_thread() {
    let caller = std::thread::current().id();
    let worker = tauri::async_runtime::block_on(run_web_device_blocking(|| {
        Ok(std::thread::current().id())
    }))
    .unwrap();
    assert_ne!(caller, worker);
}

#[test]
fn web_device_blocking_work_preserves_errors() {
    let result = tauri::async_runtime::block_on(run_web_device_blocking(|| {
        Err::<(), _>("transport unavailable".to_string())
    }));
    assert_eq!(result.unwrap_err(), "transport unavailable");
}

#[test]
fn normalizes_and_secures_server_urls() {
    assert_eq!(
        normalize_server_url("http://localhost:8787/old").unwrap(),
        "ws://localhost:8787/ws/device"
    );
    assert_eq!(
        normalize_server_url("https://example.com/api").unwrap(),
        "wss://example.com/ws/device"
    );
    assert_eq!(
        normalize_server_url("ws://127.0.0.1:8787").unwrap(),
        "ws://127.0.0.1:8787/ws/device"
    );
    assert!(normalize_server_url("ws://example.com").is_err());
    assert!(normalize_server_url("ftp://localhost").is_err());
}

#[test]
fn pairing_codes_are_bounded_ascii() {
    let code = pairing_code();
    assert_eq!(code.len(), 8);
    assert!(code
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() && !ch.is_ascii_lowercase()));
}

#[test]
fn profile_validation_rejects_invalid_bounds() {
    let valid = WebDeviceProfile {
        trusted_network: false,
        public_access_url: String::new(),
        server_url: "https://example.com".to_string(),
        client_id: "client-1".to_string(),
        machine_id: "machine-1".to_string(),
        client_kind: "development".to_string(),
        name: "Desktop".to_string(),
        auto_start: false,
        upload_wallpaper: true,
        capabilities: default_capabilities(),
    };
    assert!(validate_profile(&valid).is_ok());
    let mut invalid = valid.clone();
    invalid.client_id.clear();
    assert!(validate_profile(&invalid).is_err());
    invalid = valid;
    invalid.capabilities = vec!["x".repeat(65)];
    assert!(validate_profile(&invalid).is_err());
}

#[test]
fn save_request_preserves_device_id_and_resets_capabilities() {
    let existing = WebDeviceProfile {
        trusted_network: false,
        public_access_url: String::new(),
        server_url: "wss://old.example/ws/device".to_string(),
        client_id: "stable-client".to_string(),
        machine_id: "stable-machine".to_string(),
        client_kind: "development".to_string(),
        name: "Old".to_string(),
        auto_start: false,
        upload_wallpaper: false,
        capabilities: vec!["untrusted".to_string()],
    };
    let profile = new_profile(
        SaveProfileRequest {
            trusted_network: false,
            public_access_url: String::new(),
            server_url: "https://example.com".to_string(),
            name: "Desktop".to_string(),
            auto_start: true,
            upload_wallpaper: true,
        },
        Some(existing),
    )
    .unwrap();
    assert_eq!(profile.client_id, "stable-client");
    assert_eq!(profile.machine_id, "stable-machine");
    assert_eq!(profile.capabilities, default_capabilities());
    assert!(profile.upload_wallpaper);
}

#[test]
fn operation_queue_deduplicates_and_is_bounded() {
    let operation = |id: String| OperationView {
        id,
        device_id: "device-1".to_string(),
        kind: "conversation.start".to_string(),
        status: OperationStatus::Submitted,
        idempotency_key: "key".to_string(),
        payload: serde_json::json!({"prompt":"hello"}),
        result: None,
        error: None,
        created_at: 1,
        updated_at: 1,
    };
    let mut queue = OperationQueue::default();
    assert_eq!(
        queue.push(operation("same".to_string())),
        OperationPushResult::Inserted
    );
    assert_eq!(
        queue.push(operation("same".to_string())),
        OperationPushResult::Duplicate
    );
    for index in 1..MAX_OPERATIONS {
        assert_eq!(
            queue.push(operation(format!("operation-{index}"))),
            OperationPushResult::Inserted
        );
    }
    assert_eq!(
        queue.push(operation("overflow".to_string())),
        OperationPushResult::Full
    );
    assert_eq!(queue.snapshot().len(), MAX_OPERATIONS);
    assert_eq!(queue.snapshot().len(), MAX_OPERATIONS);
    assert!(queue.acknowledge("same"));
    assert_eq!(queue.snapshot().len(), MAX_OPERATIONS - 1);
}

#[test]
fn profile_json_is_camel_case_and_contains_no_token() {
    let profile = WebDeviceProfile {
        trusted_network: false,
        public_access_url: String::new(),
        server_url: "wss://example.com/ws/device".to_string(),
        client_id: "client-1".to_string(),
        machine_id: "machine-1".to_string(),
        client_kind: "development".to_string(),
        name: "Desktop".to_string(),
        auto_start: true,
        upload_wallpaper: true,
        capabilities: default_capabilities(),
    };
    let value = serde_json::to_value(profile).unwrap();
    assert_eq!(value["serverUrl"], "wss://example.com/ws/device");
    assert_eq!(value["clientId"], "client-1");
    assert_eq!(value["machineId"], "machine-1");
    assert_eq!(value["uploadWallpaper"], true);
    assert!(value.get("deviceToken").is_none());
    assert!(value.get("token").is_none());
}

#[test]
fn legacy_profile_device_id_migrates_to_client_id() {
    let profile: WebDeviceProfile = serde_json::from_value(serde_json::json!({
        "serverUrl": "https://example.com",
        "deviceId": "legacy-device",
        "name": "Desktop",
        "autoStart": true,
        "uploadWallpaper": true,
        "capabilities": []
    }))
    .unwrap();
    assert_eq!(profile.client_id, "legacy-device");
    assert!(profile.machine_id.is_empty());
}

#[test]
fn development_profile_is_isolated_from_installed_profile() {
    assert_eq!(profile_file_name(), DEV_PROFILE_FILE_NAME);
    assert_ne!(profile_file_name(), PROFILE_FILE_NAME);
}

#[test]
fn replaces_existing_profile_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PROFILE_FILE_NAME);
    replace_file(&path, b"first").unwrap();
    replace_file(&path, b"second").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"second");
}

#[test]
fn validates_native_context_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    let nested = root.join("nested");
    let outside = dir.path().join("outside");
    fs::create_dir_all(&nested).unwrap();
    fs::create_dir_all(&outside).unwrap();
    assert!(
        validate_operation_context(&root.to_string_lossy(), &nested.to_string_lossy()).is_ok()
    );
    assert!(
        validate_operation_context(&root.to_string_lossy(), &outside.to_string_lossy())
            .is_err()
    );
}
