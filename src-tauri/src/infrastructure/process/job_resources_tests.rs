use super::*;
use std::{cell::Cell, collections::VecDeque};

struct Enumeration {
    ids: Vec<u32>,
    assigned: u32,
    error: Option<u32>,
}
impl Enumeration {
    fn ids(ids: &[u32]) -> Self {
        Self {
            ids: ids.to_vec(),
            assigned: ids.len() as u32,
            error: None,
        }
    }
    fn retry() -> Self {
        Self {
            ids: vec![1],
            assigned: 2,
            error: Some(ERROR_MORE_DATA),
        }
    }
}
struct Candidate {
    pid: u32,
    before: Option<u64>,
    after: Option<u64>,
    bytes: Option<u64>,
    stage: Cell<u8>,
}
impl Candidate {
    fn valid(pid: u32) -> Self {
        Self {
            pid,
            before: Some(100 + pid as u64),
            after: Some(100 + pid as u64),
            bytes: Some(pid as u64 * 10),
            stage: Cell::new(0),
        }
    }
}
struct Fake {
    roots: VecDeque<Option<u64>>,
    enumerations: VecDeque<Enumeration>,
    candidates: VecDeque<Option<Candidate>>,
    opens: Vec<u32>,
    queries: usize,
}
impl Fake {
    fn stable(ids: &[u32]) -> Self {
        Self {
            roots: [Some(101), Some(101)].into(),
            enumerations: [Enumeration::ids(ids), Enumeration::ids(ids)].into(),
            candidates: ids.iter().map(|pid| Some(Candidate::valid(*pid))).collect(),
            opens: vec![],
            queries: 0,
        }
    }
    fn run(&mut self) -> Row {
        sample_with(
            self,
            1,
            "fixture",
            &mut Budget::for_test(std::time::Duration::from_secs(60), 0),
        )
    }
}
impl Sampling for Fake {
    type Process = Candidate;
    fn root_identity(&mut self) -> Option<u64> {
        self.roots.pop_front().expect("unexpected root lookup")
    }
    fn query_members(&mut self, buffer: &mut [usize]) -> Result<(), u32> {
        self.queries += 1;
        let item = self
            .enumerations
            .pop_front()
            .expect("unbounded enumeration retry");
        assert!(item.ids.len() <= 1024);
        // Populate the actual aligned native buffer, not a parallel enumeration algorithm.
        unsafe {
            let header = buffer.as_mut_ptr().cast::<u32>();
            *header = item.assigned;
            *header.add(1) = item.ids.len() as u32;
            let ids = buffer.as_mut_ptr().cast::<u8>().add(8).cast::<usize>();
            for (i, pid) in item.ids.iter().enumerate() {
                *ids.add(i) = *pid as usize;
            }
        }
        item.error.map_or(Ok(()), Err)
    }
    fn open(&mut self, pid: u32) -> Option<Candidate> {
        self.opens.push(pid);
        let candidate = self
            .candidates
            .pop_front()
            .expect("unexpected reopen by PID");
        if let Some(c) = &candidate {
            assert_eq!(c.pid, pid);
        }
        candidate
    }
    fn identity(&mut self, process: &Candidate) -> Option<u64> {
        match process.stage.replace(process.stage.get() + 1) {
            0 => process.before,
            2 => process.after,
            stage => panic!("identity not on the same pre/read/post handle: {stage}"),
        }
    }
    fn working_set(&mut self, process: &Candidate) -> Option<u64> {
        assert_eq!(
            process.stage.replace(2),
            1,
            "memory must follow identity on this handle"
        );
        process.bytes
    }
}
fn reason(row: &Row, expected: &str) {
    assert!(row.reason_codes.iter().any(|r| r == expected), "{row:?}");
}
fn private_null(row: &Row) {
    let value = serde_json::to_value(row).unwrap();
    let mut keys = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "coverage",
            "enumeratedCount",
            "observedCount",
            "reasonCodes",
            "rootCreatedFiletime",
            "rootPid",
            "sessionId",
            "status",
            "workingSetSumBytes"
        ]
    );
    assert!(value["workingSetSumBytes"].is_null());
}
#[test]
fn terminal_resources_denied_member_never_complete_root_only() {
    let mut fake = Fake::stable(&[1, 2]);
    fake.candidates[1] = None;
    let row = fake.run();
    assert_eq!(
        (
            row.status.as_str(),
            row.enumerated_count,
            row.observed_count,
            row.working_set_sum_bytes
        ),
        ("partial", 2, 1, Some(10))
    );
    reason(&row, "member_unavailable");
    fake = Fake::stable(&[1, 2]);
    fake.candidates = [None, None].into();
    let row = fake.run();
    assert_eq!(row.status, "unavailable");
    private_null(&row);
}
#[test]
fn terminal_resources_same_handle_pid_reuse_and_membership_loss() {
    for after in [Some(999), None] {
        let mut fake = Fake::stable(&[1, 2]);
        fake.candidates[1].as_mut().unwrap().after = after;
        let row = fake.run();
        assert_eq!(fake.opens, [1, 2]); // Never reopens a validated PID to read memory.
        assert_eq!(row.status, "partial");
        assert_eq!(row.working_set_sum_bytes, Some(10));
        assert_eq!(row.observed_count, 1);
        reason(&row, "identity_changed");
    }
    let mut fake = Fake::stable(&[2]);
    fake.candidates[0].as_mut().unwrap().after = Some(999);
    let row = fake.run();
    private_null(&row);
    assert_eq!(row.status, "unavailable");
}
#[test]
fn terminal_resources_failed_identity_and_memory_are_unknown() {
    for before in [None, Some(102)] {
        let mut fake = Fake::stable(&[2]);
        let candidate = fake.candidates[0].as_mut().unwrap();
        candidate.before = before;
        candidate.bytes = None;
        let row = fake.run();
        private_null(&row);
        assert_eq!(row.observed_count, 0);
        reason(&row, "member_unavailable");
    }
}
#[test]
fn terminal_resources_root_exit_or_reuse_discards_subtotal_and_identity() {
    for root in [None, Some(999)] {
        let mut fake = Fake::stable(&[1, 2]);
        fake.roots[1] = root;
        let row = fake.run();
        assert_eq!(row.status, "unavailable");
        assert_eq!(
            (row.root_pid, row.root_created_filetime.as_deref()),
            (None, None)
        );
        assert_eq!(row.observed_count, 0);
        reason(&row, "root_changed");
        private_null(&row);
    }
}
#[test]
fn terminal_resources_membership_churn_and_retry_bounds() {
    let mut fake = Fake::stable(&[1, 2]);
    fake.enumerations[1] = Enumeration::ids(&[1, 3]);
    let row = fake.run();
    assert_eq!(row.status, "partial");
    assert_eq!(row.working_set_sum_bytes, Some(30));
    reason(&row, "membership_changed");
    let mut fake = Fake::stable(&[1, 2]);
    fake.enumerations.push_front(Enumeration::retry());
    fake.enumerations.push_front(Enumeration::retry());
    let row = fake.run();
    assert_eq!(row.status, "partial");
    assert_eq!(row.working_set_sum_bytes, Some(30));
    reason(&row, "membership_changed");
    assert_eq!(fake.queries, 3); // Third initial attempt leaves no final-check permit.
    let mut fake = Fake::stable(&[1, 2]);
    fake.enumerations.insert(1, Enumeration::retry());
    assert_eq!(fake.run().status, "complete");
    assert_eq!(fake.queries, 3); // One initial query, final retry then success.
    let mut fake = Fake::stable(&[1, 2]);
    fake.enumerations.insert(1, Enumeration::retry());
    fake.enumerations.insert(1, Enumeration::retry());
    let row = fake.run();
    assert_eq!(row.status, "partial");
    reason(&row, "membership_changed");
    assert_eq!(fake.queries, 3); // Final retries cannot exceed the shared session cap.
    let mut fake = Fake::stable(&[1]);
    fake.enumerations = (0..3).map(|_| Enumeration::retry()).collect();
    let row = fake.run();
    assert_eq!(fake.queries, 3);
    assert!(fake.opens.is_empty());
    private_null(&row);
    reason(&row, "membership_changed");
}
#[test]
fn terminal_resources_member_cap_and_enumeration_failure() {
    for (assigned, error, expected) in [
        (1025, Some(ERROR_MORE_DATA), "member_limit"),
        (1, Some(ERROR_ACCESS_DENIED), "enumeration_failed"),
    ] {
        let mut fake = Fake::stable(&[1]);
        fake.enumerations[0] = Enumeration {
            ids: vec![1],
            assigned,
            error,
        };
        let row = fake.run();
        assert_eq!(fake.queries, 1);
        assert!(fake.opens.is_empty());
        reason(&row, expected);
        private_null(&row);
    }
    let ids = (1..=1024).collect::<Vec<_>>();
    let row = Fake::stable(&ids).run();
    assert_eq!(
        (row.status.as_str(), row.observed_count),
        ("complete", 1024)
    );
}
#[test]
fn terminal_resources_request_candidate_budget_is_shared_and_bounded() {
    let mut budget = Budget::for_test(std::time::Duration::from_secs(60), 4095);
    let first = sample_with(&mut Fake::stable(&[1, 2]), 1, "fixture", &mut budget);
    assert_eq!(
        (
            first.status.as_str(),
            first.observed_count,
            first.working_set_sum_bytes
        ),
        ("partial", 1, Some(10))
    );
    reason(&first, "budget_exhausted");
    let mut fake = Fake::stable(&[1]);
    let row = sample_with(&mut fake, 1, "fixture", &mut budget);
    assert!(fake.opens.is_empty());
    assert_eq!(row.status, "unavailable");
    reason(&row, "budget_exhausted");
    private_null(&row);
}
#[test]
fn terminal_resources_expired_deadline_never_enumerates() {
    let mut fake = Fake::stable(&[1]);
    let row = sample_with(
        &mut fake,
        1,
        "fixture",
        &mut Budget::for_test(std::time::Duration::ZERO, 0),
    );
    assert_eq!(fake.queries, 0);
    assert!(fake.opens.is_empty());
    reason(&row, "budget_exhausted");
    private_null(&row);
}
#[test]
fn terminal_resources_duplicate_pid_identity_is_not_double_counted() {
    let row = Fake::stable(&[1, 1, 2]).run();
    assert_eq!(row.observed_count, 2);
    assert_eq!(row.working_set_sum_bytes, Some(30));
    assert_ne!(row.status, "complete");
    let row = Fake::stable(&[]).run();
    assert_eq!(row.status, "unavailable");
    private_null(&row);
}
