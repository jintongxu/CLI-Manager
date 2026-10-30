//! Privacy-bounded read-only resource DTO and request budget.
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
pub const FEATURE: &str = "terminal_resources_v1";
pub const INVALID: &str = "terminal_resources_invalid_request";
pub const NATIVE_ONLY: &str = "terminal_resources_native_only";
pub const INVALIDATED: &str = "terminal_resources_observation_invalidated";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sampled_at: u64,
    pub daemon_epoch: String,
    pub revision: String,
    pub rows: Vec<Row>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub session_id: String,
    pub status: String,
    pub reason_codes: Vec<String>,
    pub root_pid: Option<u32>,
    pub root_created_filetime: Option<String>,
    pub coverage: String,
    pub enumerated_count: usize,
    pub observed_count: usize,
    pub working_set_sum_bytes: Option<u64>,
}
impl Row {
    pub fn unavailable(id: &str, reason: &str) -> Self {
        Self {
            session_id: id.into(),
            status: "unavailable".into(),
            reason_codes: vec![reason.into()],
            root_pid: None,
            root_created_filetime: None,
            coverage: "job_members".into(),
            enumerated_count: 0,
            observed_count: 0,
            working_set_sum_bytes: None,
        }
    }
    pub fn reason(&mut self, reason: &str) {
        if !self.reason_codes.iter().any(|r| r == reason) {
            self.reason_codes.push(reason.into());
        }
    }
}
pub fn validate(ids: Vec<String>) -> Result<Vec<String>, String> {
    if ids.len() > 64 || ids.iter().any(|s| s.is_empty() || s.len() > 256) {
        return Err(INVALID.into());
    }
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    Ok(unique)
}
pub struct Budget {
    deadline: Instant,
    observations: usize,
}
impl Budget {
    pub fn new() -> Self {
        Self {
            deadline: Instant::now() + Duration::from_millis(500),
            observations: 0,
        }
    }
    #[cfg(test)]
    pub(crate) fn for_test(duration: Duration, observations: usize) -> Self {
        Self {
            deadline: Instant::now() + duration,
            observations,
        }
    }
    pub fn expired(&self) -> bool {
        Instant::now() >= self.deadline
    }
    pub fn take(&mut self) -> bool {
        if self.expired() || self.observations >= 4096 {
            return false;
        }
        self.observations += 1;
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_resources_bounds_and_null_privacy() {
        use crate::daemon::protocol::*;
        let request = ClientFrame::TerminalResources {
            id: 1,
            session_ids: vec!["s".into()],
        };
        assert_eq!(
            decode_client_frame(&encode_frame(&request)).unwrap(),
            request
        );
        let response = DaemonFrame::TerminalResources {
            id: 1,
            snapshot: Snapshot {
                sampled_at: 0,
                daemon_epoch: "e".into(),
                revision: "1".into(),
                rows: vec![],
            },
        };
        assert_eq!(
            decode_daemon_frame(&encode_frame(&response)).unwrap(),
            response
        );
        assert!(validate(vec!["a".into(); 65]).is_err());
        assert!(validate(vec!["".into()]).is_err());
        assert!(validate(vec!["界".repeat(86)]).is_err());
        assert_eq!(
            validate(vec!["b".into(), "a".into(), "b".into()]).unwrap(),
            vec!["b", "a"]
        );
        let v = serde_json::to_value(Row::unavailable("test", "root_changed")).unwrap();
        assert!(v["workingSetSumBytes"].is_null());
        assert_eq!(v.as_object().unwrap().len(), 9);
        let mut b = Budget::new();
        b.deadline = Instant::now() + Duration::from_secs(5);
        for _ in 0..4096 {
            assert!(b.take());
        }
        assert!(!b.take());
    }
}
