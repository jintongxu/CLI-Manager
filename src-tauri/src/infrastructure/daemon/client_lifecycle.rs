//! Admission and durable ownership evidence share the connection/publication lock.
use super::*;
#[derive(Default)]
struct State {
    client: Option<Arc<DaemonClient>>,
    attempted: bool,
    observation_revision: u64,
    transaction: Option<String>,
}
pub struct DaemonBridge { inner: Mutex<State> }
impl DaemonBridge {
    pub fn new() -> Self { Self { inner: Mutex::new(State::default()) } }
    pub(super) fn connect(&self, connect: impl FnOnce() -> Result<Arc<DaemonClient>, String>) -> Result<Arc<DaemonClient>, String> {
        let mut state = self.inner.lock().map_err(|_| "daemon_lifecycle_poisoned")?;
        if state.transaction.is_some() { return Err("daemon_exit_prepared".into()); }
        if let Some(client) = state.client.as_ref().filter(|c| c.is_connected() && !c.owner_released.load(Ordering::Acquire)) { return Ok(client.clone()); }
        // A failed handshake/spawn may have registered ownership. Never downgrade to absent.
        state.observation_revision = state.observation_revision.wrapping_add(1);
        state.attempted = true;
        let client = connect()?;
        state.client = Some(client.clone());
        Ok(client)
    }
    pub fn resource_client(&self) -> Option<(Arc<DaemonClient>, u64)> {
        let state = self.inner.lock().ok()?;
        if state.transaction.is_some() { return None; }
        Some((state.client.as_ref().filter(|c| c.is_connected() && !c.owner_released.load(Ordering::Acquire))?.clone(), state.observation_revision))
    }
    pub fn resource_current(&self, client: &Arc<DaemonClient>, revision: u64) -> bool {
        self.resource_client().is_some_and(|(current, r)| r == revision && Arc::ptr_eq(&current, client))
    }
    pub fn get(&self) -> Option<Arc<DaemonClient>> {
        let state = self.inner.lock().ok()?;
        if state.transaction.is_some() { return None; }
        state.client.as_ref().filter(|c| c.is_connected() && !c.owner_released.load(Ordering::Acquire)).cloned()
    }
    pub fn prepare_exit(&self, transaction: &str) -> Result<Option<Arc<DaemonClient>>, String> {
        let mut state = self.inner.try_lock().map_err(|_| "daemon_connection_inflight")?;
        if state.transaction.as_deref().is_some_and(|t| t != transaction) { return Err("daemon_transaction_conflict".into()); }
        state.observation_revision = state.observation_revision.wrapping_add(1);
        state.transaction = Some(transaction.into());
        match &state.client {
            Some(client) => Ok(Some(client.clone())), // disconnected is retained, never absence
            None if !state.attempted => Ok(None),
            None => Err("daemon_ownership_uncertain".into()),
        }
    }
    pub fn resume_exit(&self, transaction: &str) -> Result<(), String> {
        let mut state = self.inner.try_lock().map_err(|_| "daemon_connection_inflight")?;
        if state.transaction.as_deref().is_some_and(|t| t != transaction) { return Err("daemon_transaction_conflict".into()); }
        if let Some(client) = &state.client {
            let receipt = client.exit_receipt.try_lock().map_err(|_| "owner_exit_in_progress")?;
            let stopped = receipt.as_ref().is_some_and(|r| r.transaction_id == transaction && r.owner_released && r.daemon_status == "stopped");
            drop(receipt);
            if stopped { state.client = None; state.attempted = false; }
        }
        state.observation_revision = state.observation_revision.wrapping_add(1);
        state.transaction = None;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn never_created_fences_connect_but_failed_connect_is_not_absent() {
        let bridge = DaemonBridge::new();
        assert!(bridge.prepare_exit("idle").unwrap().is_none());
        assert!(bridge.connect(|| panic!("must not connect while fenced")).is_err());
        bridge.resume_exit("idle").unwrap();
        assert!(bridge.connect(|| Err("uncertain handshake".into())).is_err());
        assert!(bridge.prepare_exit("failed").is_err());
        bridge.resume_exit("failed").unwrap();
        assert!(bridge.prepare_exit("still-uncertain").is_err());
    }
    #[test]
    fn startup_publication_and_exit_are_serialized() {
        let bridge = DaemonBridge::new();
        let _connecting = bridge.inner.lock().unwrap();
        assert!(matches!(bridge.prepare_exit("racing"), Err(e) if e == "daemon_connection_inflight"));
    }
}

#[cfg(test)]
#[test]
fn terminal_resources_bridge_revision_detects_prepare_resume_aba() {
    let bridge = DaemonBridge::new();
    let before = bridge.inner.lock().unwrap().observation_revision;
    bridge.prepare_exit("resource-race").unwrap();
    bridge.resume_exit("resource-race").unwrap();
    assert_ne!(before, bridge.inner.lock().unwrap().observation_revision);
    assert!(bridge.resource_client().is_none());
}
