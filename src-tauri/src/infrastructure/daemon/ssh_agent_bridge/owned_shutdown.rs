use super::*;

pub(super) fn spawn(command: &mut std::process::Command, control: &BridgeControl) -> Result<Child, String> {
    #[cfg(windows)] {
        use std::os::windows::{process::CommandExt, io::AsRawHandle};
        use windows_sys::Win32::System::Threading::{CREATE_SUSPENDED, CREATE_NO_WINDOW};
        #[link(name = "ntdll")]
        unsafe extern "system" { fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32; }
        command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
        let child = command.spawn().map_err(|_| "ssh_agent_bridge_spawn_failed")?;
        let job = match crate::process_job::ChildJob::assign(&child, "ssh bridge") {
            Ok(job) => job,
            Err(error) => { control.retain_failed_child(child); return Err(error); }
        };
        let mut slot = match control.job.lock() {
            Ok(slot) => slot,
            Err(_) => { control.retain_failed_child(child); return Err("ssh_job_state_failed".into()); }
        };
        *slot = Some(job);
        if unsafe { NtResumeProcess(child.as_raw_handle() as _) } < 0 {
            slot.as_ref().unwrap().terminate(); drop(slot); control.retain_failed_child(child);
            return Err("ssh_resume_failed".into());
        }
        Ok(child)
    }
    #[cfg(not(windows))] { let _ = control; command.spawn().map_err(|_| "ssh_agent_bridge_spawn_failed".into()) }
}
impl SshAgentBridgeManager {
    /// Release only registered references. Retain worker handles through timeout/retry.
    pub(crate) fn release_owned_until(&self, sessions: &[String], consumers: &[(String, String)], deadline: Instant) -> Result<(), String> {
        let controls = {
            let mut bridges = self.bridges.try_lock().map_err(|_| "ssh_state_unavailable")?;
            for entry in bridges.values_mut() {
                entry.sessions.retain(|s| !sessions.contains(s));
                for (host, consumer) in consumers {
                    if entry.plan.host_id == *host {
                        entry.consumers.remove(consumer);
                        if let Some(suffix) = consumer.strip_prefix("history:") {
                            entry.consumers.remove(&format!("files:{suffix}"));
                            entry.consumers.remove(&format!("git:{suffix}"));
                        }
                    }
                }
            }
            bridges.values().filter(|e| e.sessions.is_empty() && e.consumers.is_empty())
                .map(|e| Arc::clone(&e.control)).collect::<Vec<_>>()
        };
        for (_, consumer) in consumers { self.release_resume_claims("", consumer); }
        for control in &controls {
            control.stop.store(true, Ordering::Release);
            #[cfg(windows)] {
                let job = control.job.try_lock().map_err(|_| "ssh_job_state_failed")?;
                if let Some(job) = job.as_ref() { job.terminate_checked()?; }
            }
            #[cfg(not(windows))] { return Err("ssh_tree_proof_unsupported".into()); }
        }
        let mut workers = self.workers.try_lock().map_err(|_| "ssh_workers_unavailable")?;
        loop {
            if workers.iter().all(|(c, w)| !c.stop.load(Ordering::Acquire) || w.is_finished()) { break; }
            if Instant::now() >= deadline { return Err("ssh_worker_timeout".into()); }
            thread::sleep(Duration::from_millis(10));
        }
        for (control, _) in workers.iter().filter(|(c, _)| c.stop.load(Ordering::Acquire)) {
            control.cleanup_until(deadline)?;
            #[cfg(windows)] if let Some(job) = control.job.try_lock().map_err(|_| "ssh_job_state_failed")?.as_ref() { job.wait_empty(deadline)?; }
            if control.child.try_lock().map_err(|_| "ssh_child_state_failed")?.is_some() { return Err("ssh_root_unreaped".into()); }
        }
        let mut index = 0;
        while index < workers.len() {
            if workers[index].0.stop.load(Ordering::Acquire) {
                if workers.remove(index).1.join().is_err() { self.worker_failed.store(true, Ordering::Release); }
            } else { index += 1; }
        }
        if self.worker_failed.load(Ordering::Acquire) { return Err("ssh_worker_panicked".into()); }
        self.bridges.try_lock().map_err(|_| "ssh_state_unavailable")?.retain(|_, e| !e.control.stop.load(Ordering::Acquire));
        Ok(())
    }
    pub(crate) fn has_references(&self) -> bool {
        self.bridges.lock().map(|b| !b.is_empty()).unwrap_or(true)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn owner_active_ssh_job_release() {
        let control = Arc::new(BridgeControl::new());
        let mut command = std::process::Command::new("cmd.exe");
        command.args(["/D", "/C", "for /L %i in (1,1,2147483647) do @rem wait"]);
        let child = spawn(&mut command, &control).unwrap();
        *control.child.lock().unwrap() = Some(child);
        let manager = SshAgentBridgeManager::default();
        let worker_control = control.clone();
        let worker = thread::spawn(move || {
            while !worker_control.stop.load(Ordering::Acquire) { thread::sleep(Duration::from_millis(5)); }
            worker_control.terminate_current_child();
        });
        manager.workers.lock().unwrap().push((control.clone(), worker));
        // An already retired worker remains registered until strict release joins it.
        control.stop.store(true, Ordering::Release);
        manager.release_owned_until(&[], &[], Instant::now() + Duration::from_secs(3)).unwrap();
        assert!(manager.workers.lock().unwrap().is_empty());
        assert!(control.child.lock().unwrap().is_none());
        assert!(control.job.lock().unwrap().as_ref().unwrap().is_empty().unwrap());
    }
}

#[cfg(test)]
mod deadline_tests {
    use super::*;
    #[test]
    fn ssh_failed_reader_retained_through_timeout_retry() {
        let control = BridgeControl::new();
        let (send, recv) = mpsc::channel();
        control.readers.lock().unwrap().push(thread::spawn(move || { recv.recv().unwrap(); }));
        assert_eq!(control.cleanup_until(Instant::now()).unwrap_err(), "ssh_reader_timeout");
        assert_eq!(control.readers.lock().unwrap().len(), 1);
        send.send(()).unwrap();
        control.cleanup_until(Instant::now() + Duration::from_secs(2)).unwrap();
        assert!(control.readers.lock().unwrap().is_empty());
    }
    #[test]
    fn ssh_reader_panic_is_not_success_on_retry() {
        let control = BridgeControl::new();
        control.readers.lock().unwrap().push(thread::spawn(|| panic!("test-owned failure")));
        assert_eq!(control.cleanup_until(Instant::now() + Duration::from_secs(2)).unwrap_err(), "ssh_reader_panicked");
        assert_eq!(control.cleanup_until(Instant::now()).unwrap_err(), "ssh_reader_panicked");
    }
}

#[cfg(all(test, windows))]
mod retained_worker_tests {
    use super::*;
    #[test]
    fn ssh_stopped_worker_timeout_retry_keeps_registry() {
        let manager = SshAgentBridgeManager::default();
        let control = Arc::new(BridgeControl::new());
        control.stop.store(true, Ordering::Release);
        let (send, recv) = mpsc::channel();
        manager.workers.lock().unwrap().push((control, thread::spawn(move || { recv.recv().unwrap(); })));
        assert_eq!(manager.release_owned_until(&[], &[], Instant::now()).unwrap_err(), "ssh_worker_timeout");
        assert_eq!(manager.workers.lock().unwrap().len(), 1);
        send.send(()).unwrap();
        manager.release_owned_until(&[], &[], Instant::now() + Duration::from_secs(2)).unwrap();
        assert!(manager.workers.lock().unwrap().is_empty());
    }
    #[test]
    fn ssh_legacy_failure_retains_and_reaps_test_owned_child() {
        let control = BridgeControl::new();
        let mut command = std::process::Command::new("cmd.exe");
        command.args(["/D", "/C", "for /L %i in (1,1,2147483647) do @rem wait"]);
        let child = spawn(&mut command, &control).unwrap();
        control.retain_failed_child(child);
        control.cleanup_until(Instant::now() + Duration::from_secs(2)).unwrap();
        assert!(control.child.lock().unwrap().is_none());
        assert!(control.job.lock().unwrap().as_ref().unwrap().is_empty().unwrap());
    }
}
