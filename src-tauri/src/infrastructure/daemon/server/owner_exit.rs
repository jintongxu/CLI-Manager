use super::*;
use crate::daemon::protocol::OwnerExitReceipt;

impl DaemonServer {
    pub(super) fn exit_owner(&self, client: u64, id: u64, transaction: &str, binding: &OwnerBinding) -> DaemonFrame {
        if transaction.is_empty() || transaction.len() > 128 { return err_frame(id, "invalid_transaction_id"); }
        let owner = binding.instance_id.clone();
        {
            let mut state = match self.host.ownership.try_lock() {
                Ok(s) => s, Err(_) => return err_frame(id, "owner_state_busy_retry"),
            };
            state.observation_revision = state.observation_revision.wrapping_add(1);
            if binding.daemon_epoch != state.epoch || state.owners.get(&owner) != Some(&binding.owner_token)
                || state.connections.get(&client) != Some(&owner) {
                return err_frame(id, "owner_binding_rejected");
            }
            if state.retired.contains(transaction) { return err_frame(id, "owner_transaction_retired"); }
            let exit = state.exits.entry(owner.clone()).or_insert_with(|| ExitState {
                transaction: transaction.into(), running: false, cleanup_started: false, stopped: HashMap::new(), released: false,
            });
            if exit.transaction != transaction { return err_frame(id, "owner_exit_transaction_conflict"); }
            if exit.running { return err_frame(id, "owner_exit_in_progress_retry"); }
            exit.running = true;
            exit.cleanup_started = true;
        }
        // The owner fence stays closed after failure. Retry reuses retained PTY slots.
        let deadline = Instant::now() + Duration::from_secs(7);
        let sessions = loop {
            let state = self.host.ownership.lock().unwrap();
            if state.inflight.get(&owner).copied().unwrap_or(0) == 0 {
                break Some(state.sessions.iter().filter(|(_, o)| **o == owner).map(|(s, _)| s.clone()).collect::<Vec<_>>());
            }
            drop(state);
            if Instant::now() >= deadline { break None; }
            std::thread::sleep(Duration::from_millis(10));
        };
        let mut results = HashMap::new();
        if let Some(sessions) = sessions {
            for session in sessions {
                match self.host.pty.close_until(&session, deadline) {
                    Ok(()) => {
                        // Bridge references are released below, before dropping session metadata.
                        self.host.sessions.lock().unwrap().remove(&session);
                        self.host.detach_session_from_clients(&session);
                        self.host.ownership.lock().unwrap().sessions.remove(&session);
                        results.insert(session, "stopped".to_string());
                    }
                    Err(error) => { results.insert(session, error); }
                }
            }
        } else { results.insert("admission".into(), "owner_creation_timeout".into()); }
        let mut state = self.host.ownership.lock().unwrap();
        let consumers = state.ssh.get(&owner).map(|s| s.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
        let closed = results.iter().chain(state.exits.get(&owner).unwrap().stopped.iter()).filter(|(_, v)| v.as_str() == "stopped").map(|(s, _)| s.clone()).collect::<Vec<_>>();
        let inflight = state.inflight.get(&owner).copied().unwrap_or(0);
        drop(state);
        let bridge_result = if inflight != 0 {
            Err("owner_runtime_inflight_timeout".into())
        } else {
            self.host.ssh_agent_bridges.release_owned_until(&closed, &consumers, deadline)
        };
        let mut state = self.host.ownership.lock().unwrap();
        if let Err(error) = &bridge_result { results.insert("ssh".into(), error.clone()); }
        if bridge_result.is_ok() { state.ssh.remove(&owner); }
        let owned_routing = state.routing.remove(&owner);
        let mut runtime_ok = true;
        if owned_routing && state.routing.is_empty() && !state.legacy_routing {
            if let Err(error) = self.host.routing.lock().unwrap().stop_until(deadline) {
                results.insert("routing".into(), error); runtime_ok = false; state.routing.insert(owner.clone());
            }
        }
        let released = !state.sessions.values().any(|o| *o == owner)
            && state.inflight.get(&owner).copied().unwrap_or(0) == 0 && bridge_result.is_ok() && runtime_ok;
        let exit = state.exits.get_mut(&owner).unwrap();
        for (session, status) in &results {
            if status == "stopped" { exit.stopped.insert(session.clone(), status.clone()); }
        }
        results.extend(exit.stopped.clone());
        exit.running = false;
        exit.released = released;
        let other = state.has_registered_owners();
        let legacy = state.legacy_runtime_inflight != 0 || state.legacy_routing || !state.legacy_ssh.is_empty() || self.host.sessions.lock().unwrap().keys().any(|s| !state.sessions.contains_key(s))
            || self.host.clients.lock().unwrap().keys().any(|c| !state.connections.contains_key(c));
        let unknown = !other && !legacy && (self.host.routing_is_running() || self.host.ssh_agent_bridges.has_references());
        let status = if !released { "pending" } else if other || legacy { "retained_shared" }
            else if unknown { "unsupported" } else { state.draining = true; "stopping" };
        DaemonFrame::OwnerExitResult { id, receipt: OwnerExitReceipt {
            transaction_id: transaction.into(), sessions: results, owner_released: released && !unknown,
            daemon_status: status.into(),
            limitation: if unknown { "runtime_ownership_unknown" } else { "" }.into(),
        }}
    }
}

impl DaemonServer {
    pub(super) fn prepare_owner(&self, client: u64, id: u64, transaction: &str, binding: &OwnerBinding) -> DaemonFrame {
        if transaction.is_empty() || transaction.len() > 128 { return err_frame(id, "invalid_transaction_id"); }
        let mut state = match self.host.ownership.try_lock() { Ok(s) => s, Err(_) => return err_frame(id, "owner_state_busy_retry") };
        state.observation_revision = state.observation_revision.wrapping_add(1);
        if binding.daemon_epoch != state.epoch || state.owners.get(&binding.instance_id) != Some(&binding.owner_token)
            || state.connections.get(&client) != Some(&binding.instance_id) { return err_frame(id, "owner_binding_rejected"); }
        if state.draining || state.retired.contains(transaction) { return err_frame(id, "owner_transaction_retired"); }
        let exit = state.exits.entry(binding.instance_id.clone()).or_insert_with(|| ExitState {
            transaction: transaction.into(), running: false, cleanup_started: false, stopped: HashMap::new(), released: false,
        });
        if exit.transaction != transaction || exit.running || exit.released { return err_frame(id, "owner_exit_transaction_conflict"); }
        if state.inflight.get(&binding.instance_id).copied().unwrap_or(0) != 0 { return err_frame(id, "owner_prepare_inflight"); }
        DaemonFrame::Ok { id }
    }
    pub(super) fn resume_owner(&self, client: u64, id: u64, transaction: &str, binding: &OwnerBinding) -> DaemonFrame {
        let mut state = match self.host.ownership.try_lock() { Ok(s) => s, Err(_) => return err_frame(id, "owner_state_busy_retry") };
        state.observation_revision = state.observation_revision.wrapping_add(1);
        if binding.daemon_epoch != state.epoch || state.owners.get(&binding.instance_id) != Some(&binding.owner_token)
            || state.connections.get(&client) != Some(&binding.instance_id) { return err_frame(id, "owner_binding_rejected"); }
        if state.inflight.get(&binding.instance_id).copied().unwrap_or(0) != 0 { return err_frame(id, "owner_resume_inflight"); }
        let Some(exit) = state.exits.get(&binding.instance_id) else {
            // Authenticated owner has no fence: lost prepare never acquired one.
            state.retired.insert(transaction.into());
            return DaemonFrame::Ok { id };
        };
        if exit.transaction != transaction || exit.running || state.draining { return err_frame(id, "owner_resume_unsettled"); }
        if exit.cleanup_started && !exit.released { return err_frame(id, "owner_resume_cleanup_unsettled"); }
        state.exits.remove(&binding.instance_id);
        state.retired.insert(transaction.into());
        state.generation += 1;
        DaemonFrame::Ok { id }
    }
}

#[cfg(test)]
mod preparation_tests {
use super::*;

#[test]
fn owner_prepare_abort_preserves_sessions_and_retires_transaction() {
    let server = DaemonServer { host: Arc::new(DaemonHost::new()), next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() };
    let owner = InstanceId(uuid::Uuid::new_v4().to_string());
    let DaemonFrame::OwnerRegistered { binding, .. } = server.handle_frame(1, ClientFrame::RegisterOwner { id: 1, instance_id: owner.clone() }) else { panic!() };
    server.host.ownership.lock().unwrap().sessions.insert("existing".into(), owner.clone());
    assert!(matches!(server.prepare_owner(1, 2, "transaction", &binding), DaemonFrame::Ok { .. }));
    let create = || ClientFrame::Create { id: 3, session_id: "late".into(), cwd: None, env_vars: None, shell: Some("nonexistent-prepare-test-shell".into()), ssh_launch: None, terminal_colors: None };
    assert!(matches!(server.handle_frame(1, create()), DaemonFrame::Err { message, .. } if message == "owner_draining"));
    assert_eq!(server.host.ownership.lock().unwrap().sessions.get("existing"), Some(&owner));
    server.host.ownership.lock().unwrap().inflight.insert(owner.clone(), 1);
    assert!(matches!(server.resume_owner(1, 4, "transaction", &binding), DaemonFrame::Err { message, .. } if message == "owner_resume_inflight"));
    server.host.ownership.lock().unwrap().inflight.insert(owner.clone(), 0);
    assert!(matches!(server.resume_owner(1, 4, "transaction", &binding), DaemonFrame::Ok { .. }));
    assert_eq!(server.host.ownership.lock().unwrap().generation, 1);
    // Admission reopened; invalid executable reaches the spawn path, without launching a process.
    assert!(matches!(server.handle_frame(1, create()), DaemonFrame::Err { message, .. } if message != "owner_draining"));
    assert!(matches!(server.exit_owner(1, 5, "transaction", &binding), DaemonFrame::Err { message, .. } if message == "owner_transaction_retired"));
}

}
