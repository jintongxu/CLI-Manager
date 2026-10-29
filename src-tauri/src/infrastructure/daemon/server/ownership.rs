//! Capability-based session ownership. No PID/death inference and no OwnerExit claim.
use super::*;
use crate::daemon::protocol::{DaemonEpoch, InstanceId, OwnerBinding, OwnerToken, SessionScope};

pub(super) struct Ownership {
    epoch: DaemonEpoch,
    pub(super) draining: bool,
    routing: HashSet<InstanceId>,
    legacy_routing: bool,
    legacy_runtime_inflight: usize,
    ssh: HashMap<InstanceId, HashSet<(String, String)>>,
    legacy_ssh: HashSet<(String, String)>,
    owners: HashMap<InstanceId, OwnerToken>,
    connections: HashMap<u64, InstanceId>,
    sessions: HashMap<String, InstanceId>,
    retired: HashSet<String>,
    generation: u64,
    observation_revision: u64,
    exits: HashMap<InstanceId, ExitState>,
    inflight: HashMap<InstanceId, usize>,
    creating: std::collections::HashSet<String>,
}
struct ExitState {
    transaction: String,
    running: bool,
    cleanup_started: bool,
    stopped: HashMap<String, String>,
    released: bool,
}
impl Default for Ownership {
    fn default() -> Self {
        Self { observation_revision: 0, retired: Default::default(), generation: 0, legacy_runtime_inflight: 0, draining: false, routing: Default::default(), legacy_routing: false, ssh: Default::default(), legacy_ssh: Default::default(), epoch: DaemonEpoch(uuid::Uuid::new_v4().to_string()), owners: HashMap::new(),
            connections: HashMap::new(), sessions: HashMap::new(), exits: HashMap::new(), inflight: HashMap::new(), creating: Default::default() }
    }
}
impl Ownership {
    pub(super) fn has_registered_owners(&self) -> bool { self.owners.keys().any(|o| !self.exits.get(o).is_some_and(|e| e.released)) }
    pub(super) fn permits(&self, client: u64, session: &str) -> bool {
        match self.sessions.get(session) {
            Some(owner) => self.connections.get(&client) == Some(owner) && !self.exits.contains_key(owner),
            None => self.connections.get(&client).is_none(),
        }
    }
    fn scope(&self, client: u64, session: &str) -> SessionScope {
        match self.sessions.get(session) {
            None => SessionScope::Legacy,
            Some(owner) if self.connections.get(&client) == Some(owner) => SessionScope::Owned,
            Some(_) => SessionScope::Foreign,
        }
    }
}
impl DaemonServer {
    // One admission lock covers reserve, spawn and mutation. PTY event callbacks never acquire it.
    // OwnerExit must later share this fence rather than infer completion from a missing socket.
    pub(super) fn handle_frame(&self, client: u64, frame: ClientFrame) -> DaemonFrame {
        if let ClientFrame::TerminalResources { id, session_ids } = frame {
            return self.terminal_resources(client, id, session_ids);
        }
        if let ClientFrame::PrepareOwnerExit { id, transaction_id, binding } = &frame {
            return self.prepare_owner(client, *id, transaction_id, binding);
        }
        if let ClientFrame::ResumeOwnerExit { id, transaction_id, binding } = &frame {
            return self.resume_owner(client, *id, transaction_id, binding);
        }
        if let ClientFrame::OwnerExit { id, transaction_id, binding } = &frame {
            return self.exit_owner(client, *id, transaction_id, binding);
        }
        let mut state = match self.host.ownership.lock() {
            Ok(state) => state,
            Err(_) => return err_frame(0, "owner_state_unavailable"),
        };
        if state.draining {
            return err_frame(0, "daemon_draining");
        }
        if matches!(frame, ClientFrame::RoutingStart { .. } | ClientFrame::RoutingReload { .. }
            | ClientFrame::RoutingStop { .. } | ClientFrame::RoutingResetCircuit { .. }
            | ClientFrame::SshAgentRequest { .. } | ClientFrame::SshAgentRelease { .. }) {
            return self.runtime_frame(client, frame, state);
        }
        if matches!(&frame, ClientFrame::RegisterOwner { .. } | ClientFrame::BindOwner { .. } | ClientFrame::Create { .. } | ClientFrame::Close { .. } | ClientFrame::CloseAll { .. } | ClientFrame::Reconcile { .. }) {
            state.observation_revision = state.observation_revision.wrapping_add(1);
        }
        match &frame {
            ClientFrame::RegisterOwner { id, instance_id } => {
                if uuid::Uuid::parse_str(&instance_id.0).is_err() {
                    return err_frame(*id, "invalid_instance_id");
                }
                if state.exits.contains_key(instance_id) || state.connections.contains_key(&client) || state.owners.contains_key(instance_id) {
                    return err_frame(*id, "owner_already_registered_use_bind");
                }
                let token = OwnerToken(uuid::Uuid::new_v4().to_string());
                state.owners.insert(instance_id.clone(), token.clone());
                state.connections.insert(client, instance_id.clone());
                return DaemonFrame::OwnerRegistered { id: *id, binding: OwnerBinding {
                    instance_id: instance_id.clone(), owner_token: token, daemon_epoch: state.epoch.clone(),
                }};
            }
            ClientFrame::BindOwner { id, binding } => {
                if binding.daemon_epoch != state.epoch {
                    return err_frame(*id, "owner_epoch_mismatch");
                }
                if state.owners.get(&binding.instance_id) != Some(&binding.owner_token) {
                    return err_frame(*id, "owner_binding_rejected");
                }
                if state.connections.get(&client).is_some_and(|owner| owner != &binding.instance_id) {
                    return err_frame(*id, "owner_connection_already_bound");
                }
                state.connections.insert(client, binding.instance_id.clone());
                return DaemonFrame::Ok { id: *id };
            }
            ClientFrame::SessionScopes { id } => {
                let sessions = match self.host.sessions.lock() {
                    Ok(sessions) => sessions,
                    Err(_) => return err_frame(*id, "session_state_unavailable"),
                };
                return DaemonFrame::SessionScopes { id: *id, scopes: sessions.keys()
                    .map(|session| (session.clone(), state.scope(client, session))).collect() };
            }
            ClientFrame::Create { id, session_id, cwd, .. } => {
                let _admission = match super::super::worktree_admission::enter(cwd.as_deref()) {
                    Ok(reservation) => reservation,
                    Err(message) => return err_frame(*id, &message),
                };
                let owner = state.connections.get(&client).cloned();
                if owner.as_ref().is_some_and(|o| state.exits.contains_key(o)) {
                    return err_frame(*id, "owner_draining");
                }
                if state.creating.contains(session_id) || state.sessions.contains_key(session_id) || self.host.get_session(session_id).is_some() {
                    return err_frame(*id, "session already exists");
                }
                if let Some(owner) = state.connections.get(&client).cloned() {
                    state.sessions.insert(session_id.clone(), owner);
                }
                state.creating.insert(session_id.clone());
                if let Some(owner) = &owner { *state.inflight.entry(owner.clone()).or_default() += 1; }
                let session_id = session_id.clone();
                // Ownership reservation and inflight count are published before spawn.
                drop(state);
                let reply = self.handle_frame_inner(client, frame);
                let mut state = self.host.ownership.lock().unwrap();
                state.creating.remove(&session_id);
                if let Some(owner) = &owner { *state.inflight.get_mut(owner).unwrap() -= 1; }
                if matches!(reply, DaemonFrame::Err { .. }) {
                    state.sessions.remove(&session_id);
                }
                return reply;
            }
            ClientFrame::Write { id, session_id, .. }
            | ClientFrame::Resize { id, session_id, .. }
            | ClientFrame::SetTerminalColors { id, session_id, .. }
            | ClientFrame::Close { id, session_id } => {
                if state.creating.contains(session_id) { return err_frame(*id, "session_creation_in_progress"); }
                if state.sessions.get(session_id).is_some_and(|o| state.exits.contains_key(o)) {
                    return err_frame(*id, "owner_draining");
                }
                if !state.permits(client, session_id) {
                    return err_frame(*id, "session_owner_mismatch");
                }
            }
            ClientFrame::CloseAll { id } => {
                if !state.creating.is_empty() { return err_frame(*id, "session_creation_in_progress"); }
                if state.connections.get(&client).is_some_and(|o| state.exits.contains_key(o)) {
                    return err_frame(*id, "owner_draining");
                }
                let ids = match self.host.sessions.lock() {
                    Ok(sessions) => sessions.keys().filter(|s| state.permits(client, s)).cloned().collect::<Vec<_>>(),
                    Err(_) => return err_frame(*id, "session_state_unavailable"),
                };
                for session_id in ids {
                    let reply = self.handle_frame_inner(client, ClientFrame::Close { id: *id, session_id: session_id.clone() });
                    if matches!(reply, DaemonFrame::Err { .. }) { return reply; }
                    state.sessions.remove(&session_id);
                }
                return DaemonFrame::Ok { id: *id };
            }
            ClientFrame::Shutdown { id } => {
                if !state.creating.is_empty() || state.connections.get(&client).is_some_and(|o| state.exits.contains_key(o)) {
                    return err_frame(*id, "owner_draining");
                }
                // Registered disconnected owners still count: death has not been OS-verified.
                let own = state.connections.get(&client);
                if state.owners.keys().any(|owner| Some(owner) != own) {
                    return DaemonFrame::Ok { id: *id };
                }
                if self.host.alive_session_count() == 0 && !self.host.routing_is_running() {
                    state.draining = true;
                }
            }
            _ => {}
        }
        // Read-only traffic and unrelated SSH/routing work must not hold the PTY admission fence.
        if !matches!(frame, ClientFrame::Write { .. } | ClientFrame::Resize { .. }
            | ClientFrame::SetTerminalColors { .. } | ClientFrame::Close { .. } | ClientFrame::Shutdown { .. }) {
            drop(state);
            return self.handle_frame_inner(client, frame);
        }
        let closing = match &frame { ClientFrame::Close { session_id, .. } => Some(session_id.clone()), _ => None };
        let reply = self.handle_frame_inner(client, frame);
        if matches!(reply, DaemonFrame::Ok { .. }) {
            if let Some(session) = closing { state.sessions.remove(&session); }
        }
        reply
    }
}

#[path = "owner_exit.rs"]
mod owner_exit;

#[path = "runtime_ownership.rs"]
mod runtime_ownership;

#[path = "terminal_resources.rs"]
mod terminal_resources;
