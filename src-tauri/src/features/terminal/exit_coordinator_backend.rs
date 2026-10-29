use super::{Backend, DaemonReceipt, Resource};
use crate::{commands, daemon::client::{DaemonBridge, DaemonClient}, live_server};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Manager};

pub(super) struct Native { app: AppHandle, daemon: std::sync::Mutex<Option<Arc<DaemonClient>>>, absent: std::sync::atomic::AtomicBool }
impl Native {
    pub fn new(app: AppHandle) -> Self {
        Self { app, daemon: std::sync::Mutex::new(None), absent: std::sync::atomic::AtomicBool::new(false) }
    }
}
impl Backend for Native {
    fn prepare(&self, transaction: &str, deadline: Instant) -> Result<(), String> {
        let owner = self.app.state::<DaemonBridge>().prepare_exit(transaction).and_then(|client| {
            self.absent.store(client.is_none(), std::sync::atomic::Ordering::SeqCst);
            *self.daemon.lock().map_err(|_| "daemon_adapter_lock")? = client.clone();
            client.map_or(Ok(()), |c| c.prepare_owner_exit(transaction, deadline))
        });
        // Run every fence even if one drain fails. Abort can reopen non-destructively.
        let results = [
            owner,
            commands::web_device::prepare_exit(&self.app, transaction, deadline),
            commands::side_question::process::prepare_exit(deadline),
            self.app.state::<commands::cc_connect::CcConnectManager>().prepare_exit(deadline),
            self.app.state::<live_server::LiveServerManager>().prepare_exit(deadline),
            commands::web_server::prepare_exit(self.app.state::<commands::web_server::WebServerManager>().inner(), deadline),
        ];
        results.into_iter().collect::<Result<Vec<_>, _>>().map(|_| ())
    }
    fn stop(&self, transaction: &str, deadline: Instant) -> (Vec<Resource>, DaemonReceipt) {
        // Independent domains run concurrently under the same attempt deadline.
        stop_domains(
            || self.stop_daemon(transaction, deadline),
            [
                Box::new(|| Resource::result("side_question", commands::side_question::process::stop_for_exit(deadline))),
                Box::new(|| Resource::result("cc_connect", self.app.state::<commands::cc_connect::CcConnectManager>().stop_for_exit(deadline))),
                Box::new(|| Resource::result("live_server", self.app.state::<live_server::LiveServerManager>().stop_for_exit(deadline))),
                Box::new(|| Resource::result("web_server", commands::web_server::stop_for_exit(self.app.state::<commands::web_server::WebServerManager>().inner(), deadline))),
                Box::new(|| {
                    let result = commands::web_device::shutdown_transaction_until(&self.app, transaction, deadline);
                    Resource::result("web_device", result.as_deref().map_err(Clone::clone))
                }),
            ],
        )
    }

    fn resume(&self, transaction: &str, abort: bool, deadline: Instant) -> Result<(), String> {
        // Coordinator rejects partial post-stop drains. Keep authority until both remote fences reopen.
        let owner = match &*self.daemon.lock().map_err(|_| "daemon_adapter_lock")? {
            Some(client) if abort => client.abort_owner_exit(transaction, deadline),
            Some(client) => client.resume_owner_exit(transaction, deadline),
            None => Ok(()), // No owner fence was acquired by this adapter.
        };
        let web = commands::web_device::resume_after_exit(&self.app, transaction, deadline);
        owner?;
        web?;
        self.app.state::<DaemonBridge>().resume_exit(transaction)?;
        commands::side_question::process::resume_after_exit();
        self.app.state::<commands::cc_connect::CcConnectManager>().resume_after_exit();
        self.app.state::<live_server::LiveServerManager>().resume_after_exit();
        commands::web_server::resume_after_exit(self.app.state::<commands::web_server::WebServerManager>().inner());
        Ok(())
    }
}

impl Native {
    fn stop_daemon(&self, transaction: &str, deadline: Instant) -> (Vec<Resource>, DaemonReceipt) {
        if self.absent.load(std::sync::atomic::Ordering::SeqCst) {
            let mut resource = Resource::result("pty_owner", Ok("absent"));
            resource.evidence = Some("lifecycle_no_owned_runtime".into());
            return (vec![resource], DaemonReceipt { epoch: None, status: "absent".into() });
        }
        let client = self.daemon.lock().unwrap().clone();
        let mut resources = Vec::new();
        let mut daemon = DaemonReceipt { epoch: client.as_ref().and_then(|d| d.owner_binding().map(|b| b.daemon_epoch.0.clone())), status: "pending".into() };
        match &client {
            Some(client) => match client.owner_exit_until(transaction, deadline) {
                Ok(receipt) => return map_owner_receipt(transaction, receipt, daemon.epoch),
                Err(error) => { resources.push(Resource::result("pty_owner", Err(error))); daemon.status = "failed".into(); }
            },
            // A disconnected bridge is not proof of absence. Discovery is diagnostic only.
            None => { resources.push(Resource::result("pty_owner", Err("daemon_owner_connection_unavailable".into()))); daemon.status = "failed".into(); }
        }
        (resources, daemon)
    }
}

fn map_owner_receipt(transaction: &str, receipt: crate::daemon::protocol::OwnerExitReceipt, epoch: Option<String>) -> (Vec<Resource>, DaemonReceipt) {
    if receipt.transaction_id != transaction {
        return (vec![Resource::result("pty_owner", Err("owner_exit_transaction_mismatch".into()))], DaemonReceipt { epoch, status: "failed".into() });
    }
    let mut resources = Vec::new();
    for (id, status) in receipt.sessions {
        let mut resource = Resource::result("pty_session", if status == "stopped" { Ok("job_empty") } else { Err(status) });
        resource.resource_id = id; resources.push(resource);
    }
    resources.push(Resource::result("pty_owner", if receipt.owner_released { Ok("owner_released") } else { Err("owner_release_incomplete".into()) }));
    (resources, DaemonReceipt { epoch, status: receipt.daemon_status })
}

// Shared production adapter orchestration; fixture uses real idle local managers,
// with only remote process endpoints substituted (never exits the test process).
fn stop_domains<'a>(owner: impl FnOnce() -> (Vec<Resource>, DaemonReceipt) + Send + 'a,
    helpers: [Box<dyn FnOnce() -> Resource + Send + 'a>; 5]) -> (Vec<Resource>, DaemonReceipt) {
    std::thread::scope(|scope| {
        let owner = scope.spawn(owner);
        let workers = helpers.into_iter().map(|f| scope.spawn(f)).collect::<Vec<_>>();
        let mut resources = workers.into_iter().map(|h| h.join().unwrap_or_else(|_| Resource::result("helper", Err("exit_helper_panicked".into())))).collect::<Vec<_>>();
        let (pty, daemon) = owner.join().unwrap_or_else(|_| (vec![Resource::result("pty_owner", Err("exit_owner_panicked".into()))], DaemonReceipt { epoch: None, status: "failed".into() }));
        resources.extend(pty);
        (resources, daemon)
    })
}
#[cfg(test)]
mod adapter_tests {
    use super::*;
    struct ReadyAdapter;
    impl Backend for ReadyAdapter {
        fn prepare(&self, _: &str, _: Instant) -> Result<(), String> { Ok(()) }
        fn resume(&self, _: &str, _: bool, _: Instant) -> Result<(), String> { Ok(()) }
        fn stop(&self, transaction: &str, deadline: Instant) -> (Vec<Resource>, DaemonReceipt) {
            let cc = commands::cc_connect::CcConnectManager::new();
            let live = live_server::LiveServerManager::new();
            let web = commands::web_server::WebServerManager::default();
            cc.prepare_exit(deadline).unwrap(); live.prepare_exit(deadline).unwrap();
            commands::web_server::prepare_exit(&web, deadline).unwrap();
            commands::side_question::process::prepare_exit(deadline).unwrap();
            stop_domains(|| map_owner_receipt(transaction, crate::daemon::server::controlled_exit_receipt(transaction), Some("fixture".into())), [
                Box::new(|| Resource::result("cc_connect", cc.stop_for_exit(deadline))),
                Box::new(|| Resource::result("live_server", live.stop_for_exit(deadline))),
                Box::new(|| Resource::result("web_server", commands::web_server::stop_for_exit(&web, deadline))),
                Box::new(|| { let result = commands::side_question::process::stop_for_exit(deadline); commands::side_question::process::resume_after_exit(); Resource::result("side_question", result) }),
                Box::new(|| { let result = crate::web_daemon::controlled_exit_result(transaction); Resource::result("web_device", result.as_deref().map_err(Clone::clone)) }),
            ])
        }
    }
    struct IdleAdapter { bridge: DaemonBridge }
    impl Backend for IdleAdapter {
        fn prepare(&self, transaction: &str, _: Instant) -> Result<(), String> {
            assert!(self.bridge.prepare_exit(transaction)?.is_none()); Ok(())
        }
        fn resume(&self, transaction: &str, _: bool, _: Instant) -> Result<(), String> { self.bridge.resume_exit(transaction) }
        fn stop(&self, transaction: &str, deadline: Instant) -> (Vec<Resource>, DaemonReceipt) {
            let (mut resources, _) = ReadyAdapter.stop(transaction, deadline);
            resources.retain(|r| r.kind != "pty_owner");
            resources.push(Resource::result("pty_owner", Ok("absent")));
            (resources, DaemonReceipt { epoch: None, status: "absent".into() })
        }
    }
    #[test]
    fn never_created_adapter_ready_commit_without_gui_exit() {
        let coordinator = Arc::new(super::super::Coordinator::default());
        let receipt = coordinator.prepare(Arc::new(IdleAdapter { bridge: DaemonBridge::new() })).unwrap();
        coordinator.cleanup(&receipt.transaction_id, true).unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let status = coordinator.status(&receipt.transaction_id).unwrap();
            if !status.worker_running {
                assert!(status.can_exit, "{status:?}");
                assert_eq!(status.daemon.status, "absent");
                coordinator.commit(&receipt.transaction_id).unwrap(); break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }
    #[test]
    fn production_adapter_orchestration_reaches_ready_without_app_exit() {
        let coordinator = Arc::new(super::super::Coordinator::default());
        let prepared = coordinator.prepare(Arc::new(ReadyAdapter)).unwrap();
        coordinator.cleanup(&prepared.transaction_id, true).unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let receipt = coordinator.status(&prepared.transaction_id).unwrap();
            if !receipt.worker_running {
                assert!(receipt.can_exit, "{:?}", receipt);
                assert_eq!(receipt.resources.len(), 6);
                coordinator.commit(&prepared.transaction_id).unwrap();
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }
}
