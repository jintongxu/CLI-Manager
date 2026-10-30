#[cfg(target_os = "windows")]
#[path = "job_resources.rs"]
mod job_resources;
#[cfg(target_os = "windows")]
pub(crate) struct ChildJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for ChildJob {}

#[cfg(target_os = "windows")]
unsafe impl Sync for ChildJob {}

#[cfg(target_os = "windows")]
impl ChildJob {
    // 将已启动的 Windows 子进程加入独立 Job，并启用最后一个 Job 句柄关闭时终止进程树。
    // 任一步失败都关闭已创建的句柄并返回上下文错误，子进程的失败收尾仍由调用方负责。
    pub(crate) fn assign(child: &std::process::Child, label: &str) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        // Legacy callers assign after spawn; this does NOT prove descendant ownership.
        unsafe { Self::assign_handle(child.as_raw_handle() as _, label) }
    }

    /// Assign a process whose execution is still fenced by the caller.
    /// The handle must remain valid for this call. For tree ownership the caller
    /// must not resume the primary thread until this succeeds.
    pub(crate) unsafe fn assign_handle(
        process: windows_sys::Win32::Foundation::HANDLE,
        label: &str,
    ) -> Result<Self, String> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(format!(
                    "create {label} job object failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let err = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("configure {label} job object failed: {err}"));
            }
            if AssignProcessToJobObject(job, process) == 0 {
                let err = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("assign {label} process to job failed: {err}"));
            }
            Ok(Self(job))
        }
    }

    pub(crate) fn sample_resources(
        &self,
        root: windows_sys::Win32::Foundation::HANDLE,
        pid: u32,
        id: &str,
        budget: &mut crate::daemon::terminal_resources::Budget,
    ) -> crate::daemon::terminal_resources::Row {
        job_resources::sample(self.0, root, pid, id, budget)
    }
    // Compatibility for existing callers. Exit proof must use the checked API.
    pub(crate) fn terminate(&self) {
        let _ = self.terminate_checked();
    }

    pub(crate) fn terminate_checked(&self) -> Result<(), String> {
        if unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) } == 0 {
            return Err(format!(
                "terminate owned job failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    pub(crate) fn is_empty(&self) -> Result<bool, String> {
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe {
            QueryInformationJobObject(
                self.0,
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(format!(
                "query owned job failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(info.ActiveProcesses == 0)
    }

    pub(crate) fn wait_empty(&self, deadline: std::time::Instant) -> Result<(), String> {
        loop {
            if self.is_empty()? {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err("owned_job_timeout".into());
            }
            std::thread::sleep(remaining.min(std::time::Duration::from_millis(10)));
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::time::{Duration, Instant};

    #[test]
    fn owned_process_timeout_retains_job_for_retry() {
        // Suspended fixture cannot execute user code before assignment.
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "exit 0"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_SUSPENDED)
            .spawn()
            .unwrap();
        let job = match ChildJob::assign(&child, "test suspended child") {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("{error}");
            }
        };
        assert_eq!(
            job.wait_empty(Instant::now()),
            Err("owned_job_timeout".into())
        );
        assert_eq!(job.is_empty(), Ok(false));
        job.terminate_checked().unwrap();
        job.wait_empty(Instant::now() + Duration::from_secs(5))
            .unwrap();
        // ActiveProcesses can reach zero before the root handle is signaled.
        // Both observations are required; never treat the accounting query as reap proof.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            assert!(Instant::now() < deadline, "owned root signal timeout");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(job.is_empty(), Ok(true));
    }
}

#[cfg(target_os = "windows")]
impl Drop for ChildJob {
    // 释放持有的 Job 句柄，由已设置的 KILL_ON_JOB_CLOSE 策略处理仍存活的关联进程。
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
