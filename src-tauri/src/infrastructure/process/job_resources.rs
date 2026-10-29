//! Borrowed Job sampling. No Job duplication, global process walk, or owning cache.
use crate::daemon::terminal_resources::{Budget, Row};
use windows_sys::Win32::{Foundation::*, System::{JobObjects::*, Threading::*, ProcessStatus::*}};
use std::{collections::HashSet, mem::{size_of, zeroed}};
struct Process(HANDLE);
impl Drop for Process { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }
unsafe fn identity(process: HANDLE, job: HANDLE) -> Option<u64> {
    let mut member = 0;
    let mut created: FILETIME = zeroed();
    let mut exit = zeroed(); let mut kernel = zeroed(); let mut user = zeroed();
    if WaitForSingleObject(process, 0) != WAIT_TIMEOUT
        || IsProcessInJob(process, job, &mut member) == 0 || member == 0
        || GetProcessTimes(process, &mut created, &mut exit, &mut kernel, &mut user) == 0 { return None; }
    Some(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
}
// This seam substitutes only OS observations; tests run the production enumerator and
// aggregator below, including same-open-handle pre/read/post identity validation.
trait Sampling {
    type Process;
    fn root_identity(&mut self) -> Option<u64>;
    fn query_members(&mut self, buffer: &mut [usize]) -> Result<(), u32>;
    fn open(&mut self, pid: u32) -> Option<Self::Process>;
    fn identity(&mut self, process: &Self::Process) -> Option<u64>;
    fn working_set(&mut self, process: &Self::Process) -> Option<u64>;
}
struct Native { job: HANDLE, root: HANDLE }
impl Sampling for Native {
    type Process = Process;
    fn root_identity(&mut self) -> Option<u64> { unsafe { identity(self.root, self.job) } }
    fn query_members(&mut self, buffer: &mut [usize]) -> Result<(), u32> {
        let ok = unsafe { QueryInformationJobObject(self.job, JobObjectBasicProcessIdList, buffer.as_mut_ptr().cast(), std::mem::size_of_val(buffer) as u32, std::ptr::null_mut()) };
        if ok != 0 { Ok(()) } else { Err(unsafe { GetLastError() }) }
    }
    fn open(&mut self, pid: u32) -> Option<Process> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() { None } else { Some(Process(handle)) }
    }
    fn identity(&mut self, process: &Process) -> Option<u64> { unsafe { identity(process.0, self.job) } }
    fn working_set(&mut self, process: &Process) -> Option<u64> {
        let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { zeroed() };
        let ok = unsafe { GetProcessMemoryInfo(process.0, &mut counters, size_of::<PROCESS_MEMORY_COUNTERS>() as u32) };
        (ok != 0).then_some(counters.WorkingSetSize as u64)
    }
}
fn members(source: &mut impl Sampling, budget: &Budget, attempts: &mut usize) -> Result<Vec<u32>, &'static str> {
    // usize allocation guarantees native alignment; fixed bounded capacity includes header.
    let mut buffer = vec![0usize; 1026];
    while *attempts < 3 {
        if budget.expired() { return Err("budget_exhausted"); }
        *attempts += 1;
        let result = source.query_members(&mut buffer);
        let header = buffer.as_ptr().cast::<u32>();
        let assigned = unsafe { *header } as usize;
        let count = unsafe { *header.add(1) } as usize;
        if assigned > 1024 || count > 1024 { return Err("member_limit"); }
        if result.is_ok() && assigned == count {
            let ids = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>().add(8).cast::<usize>(), count) };
            return Ok(ids.iter().map(|p| *p as u32).collect());
        }
        if result != Err(ERROR_MORE_DATA) { return Err("enumeration_failed"); }
    }
    Err("membership_changed")
}
/// Caller holds a request-local child Arc through this call. Explicit terminate does not
/// acquire any sampler lock. Deadline is cooperative, not a cap on a Windows syscall.
pub(super) fn sample(job: HANDLE, root: HANDLE, pid: u32, id: &str, budget: &mut Budget) -> Row {
    sample_with(&mut Native { job, root }, pid, id, budget)
}
fn sample_with(source: &mut impl Sampling, pid: u32, id: &str, budget: &mut Budget) -> Row {
    let mut row = Row::unavailable(id, "root_changed");
    let Some(root_identity) = source.root_identity() else { return row; };
    row.root_pid = Some(pid); row.root_created_filetime = Some(root_identity.to_string());
    row.reason_codes.clear();
    // Initial and final membership checks share the per-session enumeration cap.
    let mut attempts = 0;
    let first = match members(source, budget, &mut attempts) { Ok(m) => m, Err(e) => { row.reason(e); return row; } };
    row.enumerated_count = first.len();
    let mut seen = HashSet::new();
    let mut sum = 0u64;
    for pid in &first {
        if !budget.take() { row.reason("budget_exhausted"); break; }
        let Some(process) = source.open(*pid) else { row.reason("member_unavailable"); continue; };
        let Some(before) = source.identity(&process) else { row.reason("member_unavailable"); continue; };
        let bytes = source.working_set(&process);
        if source.identity(&process) != Some(before) { row.reason("identity_changed"); continue; }
        let Some(bytes) = bytes else { row.reason("member_unavailable"); continue; };
        if seen.insert((*pid, before)) { sum = sum.saturating_add(bytes); row.observed_count += 1; }
    }
    match members(source, budget, &mut attempts) {
        Ok(last) if last.iter().copied().collect::<HashSet<_>>() == first.iter().copied().collect() => {},
        Ok(_) => row.reason("membership_changed"), Err(e) => row.reason(e),
    }
    if source.root_identity() != Some(root_identity) { return Row::unavailable(id, "root_changed"); }
    if row.observed_count != 0 { row.working_set_sum_bytes = Some(sum); }
    row.status = if row.observed_count == 0 { "unavailable" } else if row.reason_codes.is_empty() && row.observed_count == row.enumerated_count { "complete" } else { "partial" }.into();
    row
}

#[cfg(test)]
#[path = "job_resources_tests.rs"]
mod tests;
