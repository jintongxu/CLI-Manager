//! A wait-only handle: never grants termination authority based on discovery/PID.
use std::time::Instant;

#[cfg(windows)]
pub(super) struct VerifiedProcess(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for VerifiedProcess {}
#[cfg(windows)]
unsafe impl Sync for VerifiedProcess {}
#[cfg(windows)]
impl VerifiedProcess {
    pub(super) fn open(pid: u32, expected_start: u64) -> Result<Self, String> {
        use windows_sys::Win32::System::Threading::*;
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | 0x0010_0000, 0, pid) };
        if handle.is_null() { return Err("daemon_identity_open_failed".into()); }
        let process = Self(handle);
        if expected_start == 0 || process.start_time()? != expected_start {
            return Err("daemon_identity_mismatch".into());
        }
        Ok(process)
    }
    fn start_time(&self) -> Result<u64, String> {
        use windows_sys::Win32::{Foundation::FILETIME, System::Threading::GetProcessTimes};
        let mut times: [FILETIME; 4] = unsafe { std::mem::zeroed() };
        let ok = unsafe { GetProcessTimes(self.0, &mut times[0], &mut times[1], &mut times[2], &mut times[3]) };
        if ok == 0 { return Err("daemon_identity_query_failed".into()); }
        Ok((u64::from(times[0].dwHighDateTime) << 32) | u64::from(times[0].dwLowDateTime))
    }
    pub(super) fn wait_until(&self, deadline: Instant) -> Result<(), String> {
        use windows_sys::Win32::{Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT}, System::Threading::WaitForSingleObject};
        let millis = deadline.saturating_duration_since(Instant::now()).as_millis().min(u32::MAX as u128 - 1) as u32;
        match unsafe { WaitForSingleObject(self.0, millis) } {
            WAIT_OBJECT_0 => Ok(()), WAIT_TIMEOUT => Err("daemon_exit_timeout".into()),
            _ => Err("daemon_exit_wait_failed".into()),
        }
    }
}
#[cfg(windows)]
impl Drop for VerifiedProcess {
    fn drop(&mut self) { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0); } }
}
#[cfg(windows)]
pub(super) fn current_start_time() -> Option<u64> {
    // Borrowed pseudo handle must not be closed.
    let process = std::mem::ManuallyDrop::new(VerifiedProcess(unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() }));
    process.start_time().ok()
}
#[cfg(not(windows))]
pub(super) struct VerifiedProcess;
#[cfg(not(windows))]
impl VerifiedProcess {
    pub(super) fn open(_: u32, _: u64) -> Result<Self, String> { Err("daemon_identity_unsupported".into()) }
    pub(super) fn wait_until(&self, _: Instant) -> Result<(), String> { Err("daemon_identity_unsupported".into()) }
}
#[cfg(not(windows))]
pub(super) fn current_start_time() -> Option<u64> { None }

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn owner_process_identity_mismatch_and_signaled_proof() {
        let start = current_start_time().unwrap();
        assert!(VerifiedProcess::open(std::process::id(), start + 1).is_err());
        let current = VerifiedProcess::open(std::process::id(), start).unwrap();
        assert_eq!(current.wait_until(Instant::now()).unwrap_err(), "daemon_exit_timeout");
        let mut child = std::process::Command::new("cmd.exe").args(["/C", "for /L %i in (1,1,2147483647) do @rem wait"]).spawn().unwrap();
        use windows_sys::Win32::System::Threading::*;
        let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | 0x0010_0000, 0, child.id()) };
        assert!(!raw.is_null());
        let process = VerifiedProcess(raw);
        let verified = VerifiedProcess::open(child.id(), process.start_time().unwrap()).unwrap();
        assert!(verified.wait_until(Instant::now()).is_err());
        child.kill().unwrap(); child.wait().unwrap();
        verified.wait_until(Instant::now() + std::time::Duration::from_secs(2)).unwrap();
    }
}
