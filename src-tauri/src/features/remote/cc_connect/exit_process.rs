//! App-local child ownership. No PID supplied by IPC is accepted here.
use std::process::{Child, Command};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

pub(crate) fn lock_until<T>(
    lock: &Mutex<T>,
    deadline: Instant,
) -> Result<MutexGuard<'_, T>, String> {
    loop {
        match lock.try_lock() {
            Ok(value) => return Ok(value),
            Err(std::sync::TryLockError::Poisoned(_)) => return Err("helper_lock_poisoned".into()),
            Err(_) if Instant::now() >= deadline => return Err("helper_timeout".into()),
            Err(_) => std::thread::sleep(Duration::from_millis(1)),
        }
    }
}

pub(crate) struct OwnedProcess {
    pub(crate) child: Child,
    #[cfg(windows)]
    job: Option<crate::process_job::ChildJob>,
    #[cfg(unix)]
    group: i32,
    #[cfg(unix)]
    stop_requested: bool,
}
static FAILED: OnceLock<Mutex<Vec<OwnedProcess>>> = OnceLock::new();
fn failed() -> &'static Mutex<Vec<OwnedProcess>> {
    FAILED.get_or_init(Default::default)
}
impl OwnedProcess {
    pub(crate) fn spawn(command: &mut Command) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::os::windows::{io::AsRawHandle, process::CommandExt};
            use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
            #[link(name = "ntdll")]
            unsafe extern "system" {
                fn NtResumeProcess(process: windows_sys::Win32::Foundation::HANDLE) -> i32;
            }
            command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
            let child = command.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "side_question_node_required: install Node.js >=22.19.0 and make node available on the application PATH".to_string() } else { "helper_spawn_failed".into() })?;
            let mut owned = Self { child, job: None };
            let result =
                crate::process_job::ChildJob::assign(&owned.child, "app helper").and_then(|job| {
                    owned.job = Some(job);
                    if unsafe { NtResumeProcess(owned.child.as_raw_handle() as _) } < 0 {
                        Err("helper_resume_failed".into())
                    } else {
                        Ok(())
                    }
                });
            if let Err(error) = result {
                // Keep even admission failures: a suspended root still needs signal/reap proof.
                let _ = owned.request_stop();
                failed()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push(owned);
                return Err(error);
            }
            Ok(owned)
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
            let child = command.spawn().map_err(|_| "helper_spawn_failed")?;
            let group = child.id() as i32;
            Ok(Self {
                child,
                group,
                stop_requested: false,
            })
        }
    }
    pub(crate) fn request_stop(&mut self) -> Result<(), String> {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            return job.terminate_checked();
        }
        #[cfg(unix)]
        {
            // Never signal a recycled group on retry after reaping the leader.
            if self.stop_requested {
                return Ok(());
            }
            // The ordinary protocol/status path may already have reaped the root.
            // Without a live leader identity, never signal a potentially recycled PGID.
            if self
                .child
                .try_wait()
                .map_err(|_| "helper_wait_failed")?
                .is_some()
            {
                return Err("helper_group_identity_unavailable".into());
            }
            self.stop_requested = true;
            if unsafe { libc::kill(-self.group, libc::SIGKILL) } == 0 {
                return Ok(());
            }
            if std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
                return Err("helper_group_stop_failed".into());
            }
            return Ok(());
        }
        #[cfg(windows)]
        {
            if self
                .child
                .try_wait()
                .map_err(|_| "helper_wait_failed")?
                .is_none()
            {
                self.child.kill().map_err(|_| "helper_kill_failed")?;
            }
            Ok(())
        }
    }
    pub(crate) fn complete(&mut self) -> Result<bool, String> {
        #[cfg(unix)]
        if !self.stop_requested {
            return Ok(false);
        }
        if self
            .child
            .try_wait()
            .map_err(|_| "helper_wait_failed")?
            .is_none()
        {
            return Ok(false);
        }
        #[cfg(windows)]
        {
            self.job.as_ref().map_or(Ok(true), |job| job.is_empty())
        }
        #[cfg(unix)]
        {
            // A process-group alone cannot prove absence of deliberately detached descendants.
            if unsafe { libc::kill(-self.group, 0) } == 0 {
                return Ok(false);
            }
            Ok(std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH))
        }
    }
    pub(crate) fn stop_until(&mut self, deadline: Instant) -> Result<(), String> {
        self.request_stop()?;
        loop {
            if self.complete()? {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("helper_timeout".into());
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}
/// Reap retained spawn/admission failures as part of every helper exit attempt.
pub(crate) fn reap_failed(deadline: Instant) -> Result<(), String> {
    let mut slots = lock_until(failed(), deadline)?;
    while let Some(process) = slots.last_mut() {
        process.stop_until(deadline)?;
        slots.pop();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owned_fixture_stops_and_reaps_tree() {
        let mut command = Command::new("node");
        command.args(["-e", "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)"]);
        let mut process = OwnedProcess::spawn(&mut command).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert!(!process.complete().unwrap());
        process
            .stop_until(Instant::now() + Duration::from_secs(3))
            .unwrap();
        assert!(process.complete().unwrap());
    }
    #[test]
    fn lock_contention_respects_deadline() {
        let lock = Mutex::new(());
        let _held = lock.lock().unwrap();
        assert_eq!(
            lock_until(&lock, Instant::now()).unwrap_err(),
            "helper_timeout"
        );
    }
}
