# Backend validation completion — Todo 19

Read the exact approved Plan `20261029T042736404Z-r0006-b3fdf97f-h44975195edc0453a89d2bbbc8a70e90b3e02b61b4ed2650a49333361fd058b72.md`, current PRD, backend-handoff, actual job_resources/server handler and existing tests. This closes the deterministic acceptance-test gaps listed in backend-handoff.md; that earlier document describes the previous checkpoint.

## Minimal backend changes

- `src-tauri/src/infrastructure/process/job_resources.rs`: private narrow `Sampling` seam around native root identity, Job buffer query, process open, same-handle identity and memory calls. Native `sample` still executes the very same bounded `members` and `sample_with` aggregation used by tests. No copied test aggregator, global process walk, process lifecycle changes, handle duplication/cache, or fallback sampler.
- `job_resources_tests.rs`: deterministic OS observations populate the actual aligned native membership buffer. Fake process objects enforce pre-identity → memory → post-identity ordering on the same opened object and reject unexpected PID reopen. Tests call production aggregation.
- `daemon/terminal_resources.rs`: cfg(test)-only Budget factory for expired deadlines and near-cap candidate count; production limits/deadline unchanged.
- `server/terminal_resources.rs`: test module registration only.
- `server/terminal_resources_race_tests.rs`: actual server frame Create → sample → Close/Create same session/same owner → final revalidation. Production PTY pointer check rejects the captured old child, owner returns to the same value, revision changes, stale snapshot fails, fresh handler request succeeds. RAII cleanup targets only a UUID-named shell created by this test. No user/app process operations.

## Verification executed

Final command (exit 0):
```
cargo test --manifest-path src-tauri/Cargo.toml --lib terminal_resources
```
Full output: `output/terminal-resources-fault-tests.txt`. **15 passed, 0 failed, 0 ignored**, 1658 filtered; includes all five previous terminal_resources tests and ten new tests:

1. `terminal_resources_denied_member_never_complete_root_only`: denied descendant yields partial root subtotal, never complete; all denied yields unavailable/null.
2. `terminal_resources_same_handle_pid_reuse_and_membership_loss`: changed creation identity or lost membership discards affected sample; one open per candidate; no contaminated subtotal.
3. `terminal_resources_failed_identity_and_memory_are_unknown`: failed identity/read yields unknown null, sanitized fixed reason.
4. `terminal_resources_root_exit_or_reuse_discards_subtotal_and_identity`: exit/reuse discards memory, count and root identity.
5. `terminal_resources_membership_churn_and_retry_bounds`: changed final membership partial; retry recovery; three ERROR_MORE_DATA retries stop without process opens.
6. `terminal_resources_member_cap_and_enumeration_failure`: >1024 assigned members rejects before open; enumeration access denial uses fixed reason; exactly 1024 members succeeds.
7. `terminal_resources_request_candidate_budget_is_shared_and_bounded`: remaining request observation consumed once; partial first row, exhausted next row null/no open. Existing DTO/budget test still verifies all 4096 permits and refusal of the 4097th.
8. `terminal_resources_expired_deadline_never_enumerates`: deterministic expired deadline makes zero enumeration/open calls, unknown null.
9. `terminal_resources_duplicate_pid_identity_is_not_double_counted`: PID/FILETIME dedup subtotal; duplicate enumeration cannot falsely complete; empty Job null.
10. `terminal_resources_close_recreate_handler_race_rejects_same_owner_aba`: real handler fixture described above.

Exact serialized row-key allowlist is asserted on fault/unknown results: coverage, enumeratedCount, observedCount, reasonCodes, rootCreatedFiletime, rootPid, sessionId, status, workingSetSumBytes. No command line/environment/executable/token/raw error fields. Native adapter continues PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_SYNCHRONIZE, and validates alive/Job/FILETIME against the same HANDLE used by GetProcessMemoryInfo.

A preliminary focused run failed because the new server fixture omitted the client transport registration (`client unavailable`), not because of a sampler/handler bug. Added only a loopback test-client fixture; final complete focused run passes. Existing compile warnings remain unrelated. Focused cargo test compiles affected lib; no redundant broad owner or cargo-check rerun, as requested. Previous checkpoint already recorded 18 owner tests/check/architecture passing. `git diff --check` on touched daemon files passed (files are pre-existing untracked work, so this alone is not a full whitespace audit).

No frontend, owner implementation or lifecycle code modified; Todo20 remains root's. Existing dirty source retained. No commit, graph runner/fallback execution, real app launch, manual Pi/UI comparison, or claim of hard syscall deadline. Missing `.pi/agents/general-executor-report.schema.json` and `flow/agents/general-executor-report.schema.json`: inline executor report schema used.
