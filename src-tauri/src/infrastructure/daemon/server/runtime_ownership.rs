use super::*;

impl DaemonServer {
    pub(super) fn runtime_frame(
        &self,
        client: u64,
        mut frame: ClientFrame,
        mut state: std::sync::MutexGuard<'_, Ownership>,
    ) -> DaemonFrame {
        let owner = state.connections.get(&client).cloned();
        let id = match &frame {
            ClientFrame::RoutingStart { id, .. }
            | ClientFrame::RoutingReload { id, .. }
            | ClientFrame::RoutingStop { id }
            | ClientFrame::RoutingResetCircuit { id, .. }
            | ClientFrame::SshAgentRequest { id, .. }
            | ClientFrame::SshAgentRelease { id, .. } => *id,
            _ => unreachable!(),
        };
        if owner.as_ref().is_some_and(|o| state.exits.contains_key(o)) {
            return err_frame(id, "owner_draining");
        }
        match &mut frame {
            ClientFrame::RoutingStart { .. } | ClientFrame::RoutingReload { .. } => {
                // Acquiring an already running runtime is an explicit shared reference.
                if let Some(owner) = owner {
                    state.routing.insert(owner);
                } else {
                    state.legacy_routing = true;
                }
            }
            ClientFrame::RoutingStop { .. } => {
                if let Some(owner) = owner {
                    state.routing.remove(&owner);
                } else {
                    state.legacy_routing = false;
                }
                if !state.routing.is_empty() || state.legacy_routing {
                    return DaemonFrame::RoutingEvent {
                        event: RoutingEvent::status(id, self.host.routing_status()),
                    };
                }
            }
            ClientFrame::SshAgentRequest {
                consumer_id,
                ssh_launch,
                ..
            } => {
                if let Some(owner) = owner {
                    // Keep the history/files/git prefix semantics, namespace the suffix.
                    *consumer_id = scoped_consumer(&owner, consumer_id);
                    state
                        .ssh
                        .entry(owner)
                        .or_default()
                        .insert((ssh_launch.host_id.clone(), consumer_id.clone()));
                } else {
                    state
                        .legacy_ssh
                        .insert((ssh_launch.host_id.clone(), consumer_id.clone()));
                }
            }
            ClientFrame::SshAgentRelease {
                host_id,
                consumer_id,
                ..
            } => {
                if let Some(owner) = owner {
                    *consumer_id = scoped_consumer(&owner, consumer_id);
                }
                let _ = host_id; // Reference is released only after the operation completes.
            }
            _ => {}
        }
        if matches!(
            frame,
            ClientFrame::SshAgentRequest { .. } | ClientFrame::SshAgentRelease { .. }
        ) {
            let owner = state.connections.get(&client).cloned();
            if let Some(owner) = &owner {
                *state.inflight.entry(owner.clone()).or_default() += 1;
            } else {
                state.legacy_runtime_inflight += 1;
            }
            let release = match &frame {
                ClientFrame::SshAgentRelease {
                    host_id,
                    consumer_id,
                    ..
                } => Some((host_id.clone(), consumer_id.clone())),
                _ => None,
            };
            // Reservation is visible before any remote wait. Drop returns the permit even on unwind.
            let permit = SshPermit {
                state: &self.host.ownership,
                owner,
            };
            drop(state);
            let reply = self.handle_frame_inner(client, frame);
            if !matches!(reply, DaemonFrame::Err { .. }) {
                if let Some(reference) = release {
                    let mut state = self.host.ownership.lock().unwrap();
                    if let Some(owner) = &permit.owner {
                        if state.inflight.get(owner).copied().unwrap_or(0) == 1 {
                            if let Some(refs) = state.ssh.get_mut(owner) {
                                refs.remove(&reference);
                            }
                        }
                    } else if state.legacy_runtime_inflight == 1 {
                        state.legacy_ssh.remove(&reference);
                    }
                }
            }
            drop(permit);
            return reply;
        }
        self.handle_frame_inner(client, frame)
    }
}
fn scoped_consumer(owner: &InstanceId, consumer: &str) -> String {
    let (prefix, suffix) = consumer.split_once(':').unwrap_or(("consumer", consumer));
    format!("{prefix}:{}:{suffix}", owner.0)
}

struct SshPermit<'a> {
    state: &'a Mutex<Ownership>,
    owner: Option<InstanceId>,
}
impl Drop for SshPermit<'_> {
    fn drop(&mut self) {
        if let Some(owner) = &self.owner {
            if let Ok(mut state) = self.state.lock() {
                if let Some(count) = state.inflight.get_mut(owner) {
                    *count -= 1;
                }
            }
        } else if let Ok(mut state) = self.state.lock() {
            state.legacy_runtime_inflight -= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ssh_inflight_permit_does_not_hold_owner_lock_and_releases_on_cancel() {
        let owner = InstanceId(uuid::Uuid::new_v4().to_string());
        let state = Mutex::new(Ownership::default());
        state.lock().unwrap().inflight.insert(owner.clone(), 1);
        let permit = SshPermit {
            state: &state,
            owner: Some(owner.clone()),
        };
        assert_eq!(state.try_lock().unwrap().inflight[&owner], 1);
        drop(permit);
        assert_eq!(state.lock().unwrap().inflight[&owner], 0);
    }
}
