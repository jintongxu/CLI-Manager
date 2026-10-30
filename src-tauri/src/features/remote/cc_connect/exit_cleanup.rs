use super::exit_process::lock_until;
use super::*;
use std::sync::atomic::Ordering;
use std::time::Instant;

impl CcConnectManager {
    pub(super) fn check_exit_fence(&self) -> Result<(), String> {
        if self.exit_fenced.load(Ordering::SeqCst) {
            Err("helper_exit_fenced".into())
        } else {
            Ok(())
        }
    }
    /// Fence first, then wait for previously admitted operations. No process is stopped.
    pub(crate) fn prepare_exit(&self, deadline: Instant) -> Result<(), String> {
        self.exit_fenced.store(true, Ordering::SeqCst);
        drop(lock_until(&self.operation, deadline)?);
        Ok(())
    }
    /// Coordinator must serialize resume with cleanup; retained slots prevent replacement.
    pub(crate) fn resume_after_exit(&self) {
        self.exit_fenced.store(false, Ordering::SeqCst);
    }
    pub(super) fn stop_service_until(&self, deadline: Instant) -> Result<(), String> {
        let mut state = lock_until(&self.process, deadline)?;
        if state.starting {
            return Err("helper_starting".into());
        }
        if let Some(process) = state.process.as_mut() {
            process.owned.stop_until(deadline)?;
            while process.readers.iter().any(|r| !r.is_finished()) {
                if Instant::now() >= deadline {
                    return Err("helper_timeout".into());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            // Finished joins cannot block. Panic still proves worker termination.
            for reader in process.readers.drain(..) {
                let _ = reader.join();
            }
        }
        state.process = None;
        Ok(())
    }
    /// Ok means root signaled + job empty + both pipe readers joined (and auth root/job).
    /// Err retains all unfinished ownership for retry. Does not inspect/write credentials.
    pub(crate) fn stop_for_exit(&self, deadline: Instant) -> Result<&'static str, String> {
        self.exit_fenced.store(true, Ordering::SeqCst);
        let _operation = lock_until(&self.operation, deadline)?;
        self.stop_service_until(deadline)?;
        let mut authorization = lock_until(&self.weixin_authorization, deadline)?;
        if let Some(WeixinAuthorizationState::Running(process)) = authorization.as_mut() {
            process.owned.stop_until(deadline)?;
        }
        *authorization = None;
        exit_process::reap_failed(deadline)?;
        Ok(if cfg!(windows) {
            "job_empty"
        } else {
            "process_signaled"
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reader_timeout_retains_service_slot_and_retry_joins() {
        let manager = CcConnectManager::default();
        let mut command = Command::new("node");
        command.args(["-e", "setInterval(()=>{},1000)"]);
        let owned = exit_process::OwnedProcess::spawn(&mut command).unwrap();
        let (send, recv) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            let _ = recv.recv();
        });
        manager.process.lock().unwrap().process = Some(ManagedProcess {
            owned,
            readers: vec![reader],
            started_at_ms: 0,
        });
        let result = manager.stop_for_exit(Instant::now() + Duration::from_millis(50));
        send.send(()).unwrap();
        assert_eq!(result.unwrap_err(), "helper_timeout");
        assert!(manager.process.lock().unwrap().process.is_some());
        assert!(manager.check_exit_fence().is_err());
        manager
            .stop_for_exit(Instant::now() + Duration::from_secs(3))
            .unwrap();
        assert!(manager.process.lock().unwrap().process.is_none());
    }
}
