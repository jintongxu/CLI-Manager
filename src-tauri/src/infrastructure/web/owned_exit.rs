//! Web control ownership survives short-lived sockets; a disconnected owner remains registered.
use super::*;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerBinding {
    instance_id: String,
    token: String,
    epoch: String,
}
#[derive(Serialize, Deserialize)]
struct Registration {
    binding: OwnerBinding,
    pid: u32,
    start: u64,
}
#[derive(Default)]
pub(super) struct Owners {
    entries: HashMap<String, String>,
    runtime: HashSet<String>,
    identities: HashMap<String, process_identity::VerifiedProcess>,
    draining: bool,
    released: HashSet<String>,
    prepared: HashMap<String, String>,
    retired: HashSet<String>,
    generation: u64,
    cleanup: HashSet<String>,
    running: HashSet<String>,
}
impl Owners {
    fn bind(&self, b: &OwnerBinding, epoch: &str) -> Result<(), String> {
        if self.draining || b.epoch != epoch || self.entries.get(&b.instance_id) != Some(&b.token) {
            return Err("web_owner_rejected".into());
        }
        Ok(())
    }
}
impl DaemonState {
    pub(super) fn owned_request(
        &self,
        request: Request,
        bound: &mut Option<OwnerBinding>,
    ) -> Result<Option<Value>, String> {
        let mut owners = self.owners.try_lock().map_err(|_| "web_owner_busy")?;
        match request {
            Request::RegisterOwner {
                instance_id,
                pid,
                start,
            } => {
                if owners.draining {
                    return Err("web_daemon_draining".into());
                }
                if instance_id.is_empty()
                    || instance_id.len() > 128
                    || owners.entries.contains_key(&instance_id)
                {
                    return Err("web_owner_registration_rejected".into());
                }
                let identity = process_identity::VerifiedProcess::open(pid, start)?;
                owners.identities.insert(instance_id.clone(), identity);
                let binding = OwnerBinding {
                    instance_id,
                    token: Uuid::new_v4().to_string(),
                    epoch: self.epoch.clone(),
                };
                owners
                    .entries
                    .insert(binding.instance_id.clone(), binding.token.clone());
                *bound = Some(binding.clone());
                Ok(Some(
                    serde_json::to_value(Registration {
                        binding,
                        pid: std::process::id(),
                        start: process_identity::current_start_time().unwrap_or(0),
                    })
                    .unwrap(),
                ))
            }
            Request::BindOwner { binding } => {
                owners.bind(&binding, &self.epoch)?;
                *bound = Some(binding);
                Ok(None)
            }
            Request::PrepareOwnerExit {
                binding,
                transaction,
            } => {
                owners.bind(&binding, &self.epoch)?;
                if transaction.is_empty()
                    || transaction.len() > 128
                    || owners.retired.contains(&transaction)
                {
                    return Err("web_transaction_invalid".into());
                }
                if owners
                    .prepared
                    .get(&binding.instance_id)
                    .is_some_and(|t| t != &transaction)
                {
                    return Err("web_transaction_conflict".into());
                }
                owners.prepared.insert(binding.instance_id, transaction);
                Ok(None)
            }
            Request::ResumeOwnerExit {
                binding,
                transaction,
            } => {
                owners.bind(&binding, &self.epoch)?;
                if owners.running.contains(&binding.instance_id)
                    || owners.cleanup.contains(&binding.instance_id)
                {
                    return Err("web_resume_unsettled".into());
                }
                if owners.retired.contains(&transaction) {
                    return Ok(None);
                }
                if owners
                    .prepared
                    .get(&binding.instance_id)
                    .is_some_and(|t| t != &transaction)
                {
                    return Err("web_transaction_conflict".into());
                }
                owners.prepared.remove(&binding.instance_id);
                owners.retired.insert(transaction);
                owners.generation += 1;
                Ok(None)
            }
            request @ (Request::OwnerExitTransaction { .. } | Request::OwnerExit { .. }) => {
                let binding = match request {
                    Request::OwnerExitTransaction {
                        binding,
                        transaction,
                    } => {
                        if owners.retired.contains(&transaction)
                            || owners.prepared.get(&binding.instance_id) != Some(&transaction)
                        {
                            return Err("web_transaction_conflict".into());
                        }
                        binding
                    }
                    Request::OwnerExit { binding } => {
                        if owners.prepared.contains_key(&binding.instance_id) {
                            return Err("web_transaction_required".into());
                        }
                        binding
                    }
                    _ => unreachable!(),
                };
                if binding.epoch != self.epoch {
                    return Err("web_owner_epoch_mismatch".into());
                }
                // Retry the draining owner's request after a bounded worker timeout.
                if !owners.released.contains(&binding.token) {
                    owners.bind(&binding, &self.epoch)?;
                }
                if !owners.running.insert(binding.instance_id.clone()) {
                    return Err("web_exit_inflight".into());
                }
                owners.cleanup.insert(binding.instance_id.clone());
                owners.entries.remove(&binding.instance_id);
                owners.identities.remove(&binding.instance_id);
                owners.runtime.remove(&binding.instance_id);
                owners.released.insert(binding.token);
                if !owners.entries.is_empty() {
                    owners.running.remove(&binding.instance_id);
                    return Ok(Some(Value::String("retained_shared".into())));
                }
                owners.draining = true;
                drop(owners);
                self.stop();
                let deadline = Instant::now() + Duration::from_secs(6);
                let result = self
                    .workers
                    .wait_until(deadline)
                    .and_then(|_| self.connection.wait_until(deadline));
                self.owners
                    .lock()
                    .map_err(|_| "web_owner_lock")?
                    .running
                    .remove(&binding.instance_id);
                result?;
                self.stopping.store(true, Ordering::SeqCst);
                Ok(Some(Value::String("stopping".into())))
            }
            Request::Shutdown => Err("web_daemon_ownership_required".into()),
            request => {
                let binding = bound.as_ref().ok_or("web_daemon_ownership_required")?;
                owners.bind(binding, &self.epoch)?;
                if owners.prepared.contains_key(&binding.instance_id)
                    && !matches!(request, Request::GetStatus)
                {
                    return Err("web_owner_prepared".into());
                }
                if matches!(request, Request::Start | Request::Restart) {
                    owners.runtime.insert(binding.instance_id.clone());
                }
                if matches!(request, Request::Stop) {
                    owners.runtime.remove(&binding.instance_id);
                    if !owners.runtime.is_empty() {
                        return Ok(Some(serde_json::to_value(self.status()?).unwrap()));
                    }
                }
                if matches!(
                    request,
                    Request::Restart | Request::ClearPairing | Request::SaveProfile { .. }
                ) && owners.entries.len() > 1
                {
                    return Err("web_runtime_shared".into());
                }
                // Admission and synchronous spawn registration share this lock with final drain.
                self.handle_request(request)
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct Workers(Mutex<Vec<thread::JoinHandle<()>>>);
impl Workers {
    pub(crate) fn spawn(&self, f: impl FnOnce() + Send + 'static) -> Result<(), String> {
        let mut workers = self.0.lock().map_err(|_| "web_worker_lock")?;
        workers.push(
            thread::Builder::new()
                .name("web-owned-worker".into())
                .spawn(f)
                .map_err(|_| "web_worker_spawn")?,
        );
        Ok(())
    }
    pub(crate) fn wait_until(&self, deadline: Instant) -> Result<(), String> {
        loop {
            {
                let mut workers = self.0.try_lock().map_err(|_| "web_worker_busy")?;
                let mut i = 0;
                while i < workers.len() {
                    if workers[i].is_finished() {
                        workers
                            .swap_remove(i)
                            .join()
                            .map_err(|_| "web_worker_panicked")?;
                    } else {
                        i += 1;
                    }
                }
                if workers.is_empty() {
                    return Ok(());
                }
            }
            if Instant::now() >= deadline {
                return Err("web_worker_timeout".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}
struct NativeOwner {
    info: DaemonInfo,
    binding: OwnerBinding,
    process: process_identity::VerifiedProcess,
}
static OWNER: OnceLock<Mutex<Option<NativeOwner>>> = OnceLock::new();
static LAST_RESULT: Mutex<Option<String>> = Mutex::new(None);
static RELEASED: AtomicBool = AtomicBool::new(false);

pub(super) fn bind_native(
    reader: &mut BufReader<TcpStream>,
    info: &DaemonInfo,
) -> Result<(), String> {
    let lifecycle = LIFECYCLE.try_lock().map_err(|_| "web_exit_inflight")?;
    if lifecycle.transaction.is_some() {
        return Err("web_owner_prepared".into());
    }
    if RELEASED.load(Ordering::SeqCst) {
        return Err("web_owner_released".into());
    }
    let mut owner = OWNER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "web_owner_lock")?;
    if let Some(current) = owner.as_ref() {
        if current.info != *info {
            return Err("web_daemon_identity_changed".into());
        }
        exchange::<()>(
            reader,
            &Request::BindOwner {
                binding: current.binding.clone(),
            },
        )?;
    } else {
        let registration: Registration = exchange(
            reader,
            &Request::RegisterOwner {
                instance_id: Uuid::new_v4().to_string(),
                pid: std::process::id(),
                start: process_identity::current_start_time().unwrap_or(0),
            },
        )?;
        if registration.pid != info.pid {
            return Err("web_daemon_identity_mismatch".into());
        }
        if let Some(child) = SPAWNED
            .lock()
            .map_err(|_| "web_spawn_registry_lock")?
            .as_ref()
        {
            if child.id() != registration.pid {
                return Err("web_spawn_identity_mismatch".into());
            }
        }
        let process =
            process_identity::VerifiedProcess::open(registration.pid, registration.start)?;
        *owner = Some(NativeOwner {
            info: info.clone(),
            binding: registration.binding,
            process,
        });
    }
    Ok(())
}
fn exchange<T: for<'de> Deserialize<'de>>(
    reader: &mut BufReader<TcpStream>,
    request: &Request,
) -> Result<T, String> {
    writeln!(
        reader.get_mut(),
        "{}",
        serde_json::to_string(request).map_err(|_| "web_encode")?
    )
    .map_err(|_| "web_write")?;
    let response: Response =
        serde_json::from_str(&read_line(reader).ok_or("web_response_missing")?)
            .map_err(|_| "web_decode")?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "web_request_failed".into()));
    }
    serde_json::from_value(response.payload.unwrap_or(Value::Null))
        .map_err(|_| "web_payload".into())
}

#[derive(Default)]
struct Lifecycle {
    transaction: Option<String>,
    retired: HashSet<String>,
    generation: u64,
    uncertain: bool,
    prepare_pending: bool,
}
static LIFECYCLE: std::sync::LazyLock<Mutex<Lifecycle>> =
    std::sync::LazyLock::new(|| Mutex::new(Lifecycle::default()));

// Every read and write consumes the SAME monotonic budget, including trickled NDJSON.
fn exchange_until<T: for<'de> Deserialize<'de>>(
    stream: &mut TcpStream,
    request: &Request,
    deadline: Instant,
) -> Result<T, String> {
    use std::io::Read;
    let bytes = format!(
        "{}\n",
        serde_json::to_string(request).map_err(|_| "web_encode")?
    )
    .into_bytes();
    let mut offset = 0;
    while offset < bytes.len() {
        let left = deadline
            .checked_duration_since(Instant::now())
            .ok_or("web_exit_timeout")?;
        stream
            .set_write_timeout(Some(left))
            .map_err(|_| "web_timeout_config")?;
        let n = stream
            .write(&bytes[offset..])
            .map_err(|_| "web_write_uncertain")?;
        if n == 0 {
            return Err("web_write_uncertain".into());
        }
        offset += n;
    }
    let mut bytes = Vec::new();
    loop {
        let left = deadline
            .checked_duration_since(Instant::now())
            .ok_or("web_exit_timeout_uncertain")?;
        stream
            .set_read_timeout(Some(left))
            .map_err(|_| "web_timeout_config")?;
        let mut byte = [0];
        if stream.read(&mut byte).map_err(|_| "web_read_uncertain")? == 0 {
            return Err("web_response_missing_uncertain".into());
        }
        if byte[0] == b'\n' {
            break;
        }
        bytes.push(byte[0]);
        if bytes.len() > 1024 * 1024 {
            return Err("web_response_oversized".into());
        }
    }
    let response: Response = serde_json::from_slice(&bytes).map_err(|_| "web_decode")?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "web_request_failed".into()));
    }
    serde_json::from_value(response.payload.unwrap_or(Value::Null))
        .map_err(|_| "web_payload".into())
}
fn owner_rpc<T: for<'de> Deserialize<'de>>(
    current: &NativeOwner,
    request: Request,
    deadline: Instant,
) -> Result<T, String> {
    let left = deadline
        .checked_duration_since(Instant::now())
        .ok_or("web_exit_timeout")?;
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], current.info.port)),
        left.min(Duration::from_millis(200)),
    )
    .map_err(|_| "web_exit_connect")?;
    stream
        .set_write_timeout(Some(left))
        .map_err(|_| "web_timeout_config")?;
    writeln!(
        stream,
        "{}",
        serde_json::to_string(&Request::Auth {
            token: current.info.token.clone(),
            client_version: env!("CARGO_PKG_VERSION").into(),
            protocol_version: PROTOCOL_VERSION
        })
        .unwrap()
    )
    .map_err(|_| "web_exit_auth")?;
    exchange_until(&mut stream, &request, deadline)
}
pub fn prepare_owner_exit(transaction: &str, deadline: Instant) -> Result<(), String> {
    let mut lifecycle = LIFECYCLE.try_lock().map_err(|_| "web_exit_inflight")?;
    if transaction.is_empty()
        || lifecycle.retired.contains(transaction)
        || lifecycle
            .transaction
            .as_deref()
            .is_some_and(|t| t != transaction)
    {
        return Err("web_transaction_conflict".into());
    }
    lifecycle.transaction = Some(transaction.into());
    let owner = OWNER
        .get_or_init(|| Mutex::new(None))
        .try_lock()
        .map_err(|_| "web_owner_busy")?;
    if let Some(current) = owner.as_ref() {
        lifecycle.prepare_pending = true;
        owner_rpc::<()>(
            current,
            Request::PrepareOwnerExit {
                binding: current.binding.clone(),
                transaction: transaction.into(),
            },
            deadline,
        )?;
    } else if read_discovery()?.is_some() {
        return Err("web_daemon_ownership_unavailable".into());
    }
    Ok(())
}
pub fn resume_owner_exit(transaction: &str, deadline: Instant) -> Result<(), String> {
    let mut lifecycle = LIFECYCLE.try_lock().map_err(|_| "web_exit_inflight")?;
    if lifecycle.retired.contains(transaction)
        || (lifecycle.transaction.is_none() && !lifecycle.uncertain)
    {
        return Ok(());
    }
    if lifecycle.transaction.as_deref() != Some(transaction) || lifecycle.uncertain {
        return Err("web_resume_unsettled".into());
    }
    let owner = OWNER
        .get_or_init(|| Mutex::new(None))
        .try_lock()
        .map_err(|_| "web_owner_busy")?;
    if lifecycle.prepare_pending {
        if let Some(current) = owner.as_ref() {
            owner_rpc::<()>(
                current,
                Request::ResumeOwnerExit {
                    binding: current.binding.clone(),
                    transaction: transaction.into(),
                },
                deadline,
            )?;
        }
    }
    lifecycle.prepare_pending = false;
    lifecycle.transaction = None;
    lifecycle.retired.insert(transaction.into());
    lifecycle.generation += 1;
    RELEASED.store(false, Ordering::SeqCst);
    *LAST_RESULT.lock().map_err(|_| "web_owner_lock")? = None;
    Ok(())
}
pub fn release_owner_transaction_until(
    transaction: &str,
    deadline: Instant,
) -> Result<String, String> {
    let mut lifecycle = LIFECYCLE.try_lock().map_err(|_| "web_exit_inflight")?;
    if lifecycle.transaction.as_deref() != Some(transaction)
        || lifecycle.retired.contains(transaction)
    {
        return Err("web_transaction_conflict".into());
    }
    // A lost response cannot authorize resume while the remote worker may still run.
    lifecycle.uncertain = true;
    let result = release_native_until(Some(transaction), deadline);
    if result.is_ok() {
        lifecycle.uncertain = false;
    }
    result
}

/// Blocking, deadline-bounded API. Never spawns, upgrades, or kills a discovered process.
/// Values: absent (never registered/no discovery), retained_shared, stopped (handle signaled).
pub fn release_owner_until(deadline: Instant) -> Result<String, String> {
    release_native_until(None, deadline)
}
fn release_native_until(transaction: Option<&str>, deadline: Instant) -> Result<String, String> {
    let mut owner = OWNER
        .get_or_init(|| Mutex::new(None))
        .try_lock()
        .map_err(|_| "web_owner_busy")?;
    let Some(current) = owner.as_ref() else {
        if let Some(result) = LAST_RESULT.lock().map_err(|_| "web_owner_lock")?.clone() {
            return Ok(result);
        }
        return if read_discovery()?.is_none() {
            Ok("absent".into())
        } else {
            Err("web_daemon_ownership_unavailable".into())
        };
    };
    RELEASED.store(true, Ordering::SeqCst);
    if current.process.wait_until(Instant::now()).is_ok() {
        *LAST_RESULT.lock().map_err(|_| "web_owner_lock")? = Some("stopped".into());
        *owner = None;
        return Ok("stopped".into());
    }
    let request = match transaction {
        Some(transaction) => Request::OwnerExitTransaction {
            binding: current.binding.clone(),
            transaction: transaction.into(),
        },
        None => Request::OwnerExit {
            binding: current.binding.clone(),
        },
    };
    let result: String = owner_rpc(current, request, deadline)?;
    if result == "stopping" {
        current.process.wait_until(deadline)?;
    } else if result != "retained_shared" {
        return Err("web_exit_invalid_receipt".into());
    }
    let result = if result == "stopping" {
        "stopped".into()
    } else {
        result
    };
    *LAST_RESULT.lock().map_err(|_| "web_owner_lock")? = Some(result.clone());
    *owner = None;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn web_owner_shared_release_and_final_drain_fences_registration() {
        let state = DaemonState::new(PathBuf::new(), super::super::tests::control_info(0));
        let mut first = None;
        let mut second = None;
        state
            .owned_request(
                Request::RegisterOwner {
                    instance_id: "first".into(),
                    pid: std::process::id(),
                    start: process_identity::current_start_time().unwrap_or(0),
                },
                &mut first,
            )
            .unwrap();
        state
            .owned_request(
                Request::RegisterOwner {
                    instance_id: "second".into(),
                    pid: std::process::id(),
                    start: process_identity::current_start_time().unwrap_or(0),
                },
                &mut second,
            )
            .unwrap();
        assert_eq!(
            state
                .owned_request(
                    Request::OwnerExit {
                        binding: first.unwrap()
                    },
                    &mut None
                )
                .unwrap(),
            Some(Value::String("retained_shared".into()))
        );
        assert!(!state.stopping.load(Ordering::SeqCst));
        assert_eq!(
            state
                .owned_request(
                    Request::OwnerExit {
                        binding: second.unwrap()
                    },
                    &mut None
                )
                .unwrap(),
            Some(Value::String("stopping".into()))
        );
        assert!(state
            .owned_request(
                Request::RegisterOwner {
                    instance_id: "third".into(),
                    pid: std::process::id(),
                    start: process_identity::current_start_time().unwrap_or(0)
                },
                &mut None
            )
            .is_err());
    }
    #[test]
    fn web_owner_forged_token_and_legacy_shutdown_are_rejected() {
        let state = DaemonState::new(PathBuf::new(), super::super::tests::control_info(0));
        let mut bound = None;
        state
            .owned_request(
                Request::RegisterOwner {
                    instance_id: "owner".into(),
                    pid: std::process::id(),
                    start: process_identity::current_start_time().unwrap_or(0),
                },
                &mut bound,
            )
            .unwrap();
        let mut forged = bound.unwrap();
        forged.token = "wrong".into();
        assert!(state
            .owned_request(Request::OwnerExit { binding: forged }, &mut None)
            .is_err());
        assert!(state.owned_request(Request::Shutdown, &mut None).is_err());
        assert!(!state.stopping.load(Ordering::SeqCst));
    }
    #[test]
    fn web_workers_timeout_retains_handle_then_joins() {
        let workers = Workers::default();
        workers
            .spawn(|| thread::sleep(Duration::from_millis(50)))
            .unwrap();
        assert!(workers.wait_until(Instant::now()).is_err());
        assert_eq!(workers.0.lock().unwrap().len(), 1);
        workers
            .wait_until(Instant::now() + Duration::from_secs(1))
            .unwrap();
    }
}

#[cfg(test)]
pub(super) static TEST_NATIVE_LOCK: Mutex<()> = Mutex::new(());
#[cfg(test)]
pub(super) fn reset_test_owner() {
    *OWNER.get_or_init(|| Mutex::new(None)).lock().unwrap() = None;
}
#[cfg(test)]
pub(super) fn mock_registration(reader: &mut BufReader<TcpStream>, stream: &mut TcpStream) {
    let Request::RegisterOwner { instance_id, .. } =
        serde_json::from_str(&read_line(reader).unwrap()).unwrap()
    else {
        panic!("registration required")
    };
    write_response(
        stream,
        Some(
            serde_json::to_value(Registration {
                binding: OwnerBinding {
                    instance_id,
                    token: "test-owner".into(),
                    epoch: "test-epoch".into(),
                },
                pid: std::process::id(),
                start: process_identity::current_start_time().unwrap_or(0),
            })
            .unwrap(),
        ),
        None,
    )
    .unwrap();
}

// Retain only the child actually spawned by this GUI; never treat this as kill authority.
static SPAWNED: Mutex<Option<std::process::Child>> = Mutex::new(None);
pub(crate) fn retain_spawned(child: std::process::Child) -> Result<(), String> {
    *SPAWNED.lock().map_err(|_| "web_spawn_registry_lock")? = Some(child);
    Ok(())
}

#[cfg(test)]
mod preparation_tests {
    use super::*;
    #[test]
    fn web_prepare_resume_fences_mutation_without_stopping_runtime() {
        let state = DaemonState::new(PathBuf::new(), super::super::tests::control_info(0));
        let binding = OwnerBinding {
            instance_id: "fixture".into(),
            token: "token".into(),
            epoch: state.epoch.clone(),
        };
        state
            .owners
            .lock()
            .unwrap()
            .entries
            .insert(binding.instance_id.clone(), binding.token.clone());
        state
            .owners
            .lock()
            .unwrap()
            .runtime
            .insert(binding.instance_id.clone());
        let mut bound = Some(binding.clone());
        state
            .owned_request(
                Request::PrepareOwnerExit {
                    binding: binding.clone(),
                    transaction: "old".into(),
                },
                &mut bound,
            )
            .unwrap();
        assert_eq!(
            state.owned_request(Request::Start, &mut bound).unwrap_err(),
            "web_owner_prepared"
        );
        assert!(state
            .owners
            .lock()
            .unwrap()
            .runtime
            .contains(&binding.instance_id));
        assert!(!state.stopping.load(Ordering::SeqCst));
        state
            .owners
            .lock()
            .unwrap()
            .running
            .insert(binding.instance_id.clone());
        assert!(state
            .owned_request(
                Request::ResumeOwnerExit {
                    binding: binding.clone(),
                    transaction: "old".into()
                },
                &mut bound
            )
            .is_err());
        state.owners.lock().unwrap().running.clear();
        state
            .owned_request(
                Request::ResumeOwnerExit {
                    binding: binding.clone(),
                    transaction: "old".into(),
                },
                &mut bound,
            )
            .unwrap();
        assert!(!state
            .owners
            .lock()
            .unwrap()
            .prepared
            .contains_key(&binding.instance_id));
        assert_eq!(state.owners.lock().unwrap().generation, 1);
        assert!(state
            .owned_request(
                Request::OwnerExitTransaction {
                    binding,
                    transaction: "old".into()
                },
                &mut bound
            )
            .is_err());
    }
    #[test]
    fn web_absolute_deadline_rejects_trickled_response() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            for _ in 0..20 {
                if stream.write_all(b" ").is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        let mut stream = TcpStream::connect(addr).unwrap();
        let start = Instant::now();
        assert!(exchange_until::<()>(
            &mut stream,
            &Request::GetStatus,
            start + Duration::from_millis(40)
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_millis(200));
        drop(stream);
        worker.join().unwrap();
    }
}

#[cfg(test)]
pub(crate) fn controlled_exit_result(transaction: &str) -> Result<String, String> {
    let state = DaemonState::new(PathBuf::new(), super::tests::control_info(0));
    let mut owner = None;
    for instance in ["fixture-owner", "fixture-other"] {
        let mut binding = None;
        state.owned_request(
            Request::RegisterOwner {
                instance_id: instance.into(),
                pid: std::process::id(),
                start: process_identity::current_start_time().unwrap_or(0),
            },
            &mut binding,
        )?;
        if instance == "fixture-owner" {
            owner = binding;
        }
    }
    let binding = owner.unwrap();
    state.owned_request(
        Request::PrepareOwnerExit {
            binding: binding.clone(),
            transaction: transaction.into(),
        },
        &mut None,
    )?;
    assert_eq!(
        state
            .owned_request(Request::Start, &mut Some(binding.clone()))
            .unwrap_err(),
        "web_owner_prepared"
    );
    let result = state.owned_request(
        Request::OwnerExitTransaction {
            binding,
            transaction: transaction.into(),
        },
        &mut None,
    )?;
    assert!(!state.stopping.load(Ordering::SeqCst));
    serde_json::from_value(result.unwrap()).map_err(|e| e.to_string())
}
