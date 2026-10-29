use super::*;
use crate::daemon::terminal_resources::{self as resources, Budget, Row, Snapshot};
impl Ownership {
    fn resources_authorized(&self, client: u64, ids: &[String]) -> bool {
        !self.draining && self.connections.get(&client).is_some_and(|owner|
            !self.exits.contains_key(owner) && ids.iter().all(|id| self.sessions.get(id) == Some(owner) && !self.creating.contains(id)))
    }
}
impl DaemonServer {
    pub(super) fn terminal_resources(&self, client: u64, id: u64, ids: Vec<String>) -> DaemonFrame {
        self.terminal_resources_observe(client, id, ids, || {})
    }
    fn terminal_resources_observe(&self, client: u64, id: u64, ids: Vec<String>, sampled: impl FnOnce()) -> DaemonFrame {
        let ids = match resources::validate(ids) { Ok(ids) => ids, Err(e) => return err_frame(id, &e) };
        let (revision, epoch, captured) = {
            let state = match self.host.ownership.lock() { Ok(s) => s, Err(_) => return err_frame(id, resources::INVALIDATED) };
            if !state.resources_authorized(client, &ids) { return err_frame(id, "terminal_resources_owner_rejected"); }
            let captured = ids.iter().map(|sid| {
                let remote = self.host.get_session(sid).is_some_and(|s| {
                    let s = s.lock().unwrap();
                    matches!(s.meta.shell.as_deref(), Some("wsl" | "bash")) || s.meta.ssh_host_id.is_some() || s.meta.environment_type.as_deref().is_some_and(|v| v != "local")
                });
                (sid.clone(), remote, self.host.pty.resource_child(sid))
            }).collect::<Vec<_>>();
            (state.observation_revision, state.epoch.0.clone(), captured)
        };
        let mut budget = Budget::new();
        let mut rows = Vec::new();
        for (sid, remote, child) in captured {
            let row = if remote { Row::unavailable(&sid, "unsupported_remote") }
            else if let Some(child) = child {
                let mut row = if budget.expired() { Row::unavailable(&sid, "budget_exhausted") }
                    else if !self.host.pty.resource_child_current(&sid, &child) { Row::unavailable(&sid, "observation_invalidated") }
                    else { child.sample_resources(&sid, &mut budget) };
                if !self.host.pty.resource_child_current(&sid, &child) { row = Row::unavailable(&sid, "observation_invalidated"); }
                // Release bounded request-local ownership before final admission revalidation.
                drop(child);
                row
            } else { Row::unavailable(&sid, "not_pty") };
            rows.push(row);
        }
        sampled();
        let state = match self.host.ownership.lock() { Ok(s) => s, Err(_) => return err_frame(id, resources::INVALIDATED) };
        if state.observation_revision != revision || !state.resources_authorized(client, &ids) { return err_frame(id, resources::INVALIDATED); }
        DaemonFrame::TerminalResources { id, snapshot: Snapshot {
            sampled_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
            daemon_epoch: epoch, revision: revision.to_string(), rows,
        }}
    }
}

#[cfg(test)]
#[path = "terminal_resources_race_tests.rs"]
mod race_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_resources_owner_fences_and_revision_aba() {
        let server = DaemonServer { host: Arc::new(DaemonHost::new()), next_client_id: AtomicU64::new(1), token: "test".into(), version: "test".into(), info_path: PathBuf::new() };
        let owner = InstanceId(uuid::Uuid::new_v4().to_string());
        let DaemonFrame::OwnerRegistered { binding, .. } = server.handle_frame(1, ClientFrame::RegisterOwner { id: 1, instance_id: owner.clone() }) else { panic!() };
        server.host.ownership.lock().unwrap().sessions.insert("owned".into(), owner);
        let request = || ClientFrame::TerminalResources { id: 2, session_ids: vec!["owned".into()] };
        assert!(matches!(server.handle_frame(2, request()), DaemonFrame::Err { .. }));
        assert!(matches!(server.handle_frame(1, request()), DaemonFrame::TerminalResources { .. }));
        let raced = server.terminal_resources_observe(1, 2, vec!["owned".into()], || {
            assert!(matches!(server.prepare_owner(1, 3, "race", &binding), DaemonFrame::Ok { .. }));
            assert!(matches!(server.resume_owner(1, 4, "race", &binding), DaemonFrame::Ok { .. }));
        });
        assert!(matches!(raced, DaemonFrame::Err { message, .. } if message == resources::INVALIDATED));
        let before = server.host.ownership.lock().unwrap().observation_revision;
        assert!(matches!(server.prepare_owner(1, 3, "tx", &binding), DaemonFrame::Ok { .. }));
        assert!(matches!(server.handle_frame(1, request()), DaemonFrame::Err { .. }));
        assert!(matches!(server.resume_owner(1, 4, "tx", &binding), DaemonFrame::Ok { .. }));
        assert_ne!(before, server.host.ownership.lock().unwrap().observation_revision);
        let before = server.host.ownership.lock().unwrap().observation_revision;
        server.handle_frame(1, ClientFrame::BindOwner { id: 5, binding });
        assert_ne!(before, server.host.ownership.lock().unwrap().observation_revision);
        server.handle_frame(1, ClientFrame::Close { id: 6, session_id: "owned".into() });
        assert!(matches!(server.handle_frame(1, request()), DaemonFrame::Err { .. }));
    }
}
