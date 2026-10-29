# Bounded PTY owner-exit slice

## Usable API (not app exit)

Native Rust: `DaemonClient::owner_exit(&self, transaction_id: &str) -> Result<OwnerExitReceipt, String>`.
Requires handshake feature **`pty_owner_exit_v1`**, in addition to unchanged **`session_owner_v1`**. `owned_exit_v1` is NOT advertised. Missing feature/binding returns `daemon_ownership_unsupported` without CloseAll/Shutdown fallback. Native RPC waits at most 10 seconds; daemon cleanup attempt budget is 7 seconds. Timeout is an unknown outcome: repeat the SAME transaction ID. No app_exit gate, coordinator or new Tauri command has been added. Legacy WebView relay rejects OwnerExit; direct authenticated owner-bound NDJSON/WS can use the frame.

Wire uses existing snake_case protocol (NOT the future application receipt camelCase schema):

```json
{"type":"owner_exit","id":3,"transaction_id":"native-generated-transaction","binding":{"instance_id":"UUID","owner_token":"memory-only-token","daemon_epoch":"UUID"}}
```

```json
{"type":"owner_exit_result","id":3,"receipt":{"transaction_id":"native-generated-transaction","sessions":{"session-id":"stopped"},"owner_released":true,"daemon_status":"retained_shared","limitation":"shared_runtime_ownership_untracked_no_daemon_stop"}}
```

`receipt.sessions` values are `stopped` or error codes including `pty_tree_timeout`, `pty_release_timeout`, `pty_tree_proof_unsupported`, lock-busy and OS operation errors. Inflight admission timeout appears as `admission: owner_creation_timeout`. Failed entries remain registered; `owner_released` stays false while sessions/inflight creations remain. `stopped` on Windows means retained root handle signaled AND Job ActiveProcesses zero, plus reader/watcher/controller-release worker joined. It never means application ready or daemon stopped.

Authentication failures return ordinary `err` (`owner_binding_rejected`). Empty/oversized transaction returns `invalid_transaction_id`; a different transaction after the fence returns `owner_exit_transaction_conflict`; concurrent duplicate returns `owner_exit_in_progress_retry`, without launching another cleanup worker. Admission mutex busy returns `owner_state_busy_retry`. Serial duplicates retain stopped-session receipt data; retry only visits still-owned slots. A completed owner becomes a non-admitting capability tombstone to support reconnect/idempotence, not an active registration for idle-owner counting. No resume/new lifecycle for that owner is provided in this slice.

## Implemented

- Owner fence and session reservation/inflight accounting share the ownership mutex; spawn occurs outside that mutex. Exit waits for registered inflight creation. Concurrent same-ID creates cannot steal reservation, including legacy creates. Ordinary mutation/CloseAll cannot bypass an owner drain; in-progress create cannot be ordinarily closed.
- Only owner sessions are stopped. Failed/timeout PTYs retain closing handles, one controller-release worker and reader/watcher handles across retries. No unconditional join occurs in this strict path. Existing ordinary close behavior, including Unix, is preserved.
- Inspected archived diffs and selectively reused Windows suspended ConPTY Job admission, checked Job querying/termination and tree tests, plus the bounded PTY close method in a separate module. No old coordinator/protocol/ownership implementation restored wholesale.
- Shared routing/SSH are never stopped by OwnerExit. Receipt conservatively always reports retained_shared, including when apparently last owner; unknown shared runtime is not exclusive shutdown authority.

## Remaining gaps / limitations (important)

1. **Daemon native process identity/retained OS handle and OS-signaled daemon wait are NOT implemented.** This slice grants no exclusive drain permit and never initiates daemon stop, so it does not fake this proof. Next prerequisite is explicit SSH/routing/legacy resource accounting plus final admission/listener drain; only then add handshake identity verification and a retained native daemon handle with bounded OS wait. Existing general Shutdown compatibility is not a new owner-exit proof.
2. Unix strict whole-tree proof remains `pty_tree_proof_unsupported`: sessions stay active/registered and receipt blocked rather than claiming a process group proves all escaped descendants gone. Ordinary Unix close is unchanged, not redirected to unsupported. Unix compilation/runtime was not exercised on this Windows host.
3. This is native library + daemon API, not a frontend action. Full owner release here means **PTY domain only**; helpers/web-device/shared consumer release and metadata commit are still missing. Do not use `owner_released` to call app_exit. No user process enumeration/kills or credentials were used.
4. Locks used to commit short ownership/session updates still use existing blocking mutexes; PTY wait loops use deadline and try_lock, but the entire request is not a formally bounded operation under poisoned/stalled unrelated host mutexes. OS spawn itself is not cancellable; admission timeout leaves its owner fenced for retry.
5. Existing normal-close/taskkill and reconcile paths are not converted into the new strict proof API. This is not full process cleanup. Root owns Todo12; no Todo changes or commit.

## Verification

- Branch `wt/task-1027-2130-3c711d70c03c` has no upstream; no synchronization attempted.
- Knowledge search found instance-specific cleanup guidance; coding spec loaded. Maestro graph uninitialized; `.gitnexus/run.cjs` absent. Bounded source/caller fallback used; no graph init or agents.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib owned_process -- --test-threads=1`: 4 pass, including suspended Job timeout/retry and real test-owned descendant tree with unrelated live control.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib owner_ -- --test-threads=1`: 3 pass. Two registered owners/real PTYs, zero-budget closing-slot retention/retry, duplicate receipt, fenced late create, create/exit race, unknown protocol, and native+WS owner isolation/reconnect with native NDJSON OwnerExit roundtrip.
- `cargo check --manifest-path src-tauri/Cargo.toml`: pass (14 existing warnings).
- `npm run check:architecture`: pass, zero >2000-line files and zero new violations.
- Scoped `git diff --check`: pass.
- Logs: `output/owner-exit-{process-tests,final-tests,check,architecture}.txt`.
- Preserved dirty frontend theme/project-selection and previous owner foundation. TEMP changelog/feature-list additions only.

Report schema files `.pi/agents/general-executor-report.schema.json` and `flow/agents/general-executor-report.schema.json` were unavailable; inline schema used for final report.
