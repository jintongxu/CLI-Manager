# Completed bounded session-owner slice (not full Todo12)

## Current implementation
- `session_owner_v1` is advertised; **NOT** `owned_exit_v1`. Capability promises authenticated owner registration/binding and session isolation only. No process-identity/death verification is claimed.
- `protocol.rs`: distinct InstanceId/OwnerToken/DaemonEpoch types; redacted token Debug; RegisterOwner / BindOwner / SessionScopes frames and decoding allowlists.
- `client_owner.rs`: native production handshake after Auth, before connection publication. Random process-local GUI instance ID, memory-only bindings cached by daemon authentication token; native reconnect binds original capability rather than registering again. Old daemon capability absence returns None and retains existing legacy operation.
- `commands.rs`: main-window-only endpoint exposes same capability for WS, plus precise `session_owner_bound` / `daemon_ownership_unsupported` status. Legacy relay is also main-window-only and cannot register/rebind the native connection.
- `PtyHostSocket.ts`: Auth -> BindOwner -> ready/heartbeat/create; bind rejection rejects connection. Reconnect repeats binding. `sessionScopes()` and native `DaemonClient::session_scopes()` provide owned/foreign/legacy queries (unsupported explicitly errors).
- `server/ownership.rs`: one PTY admission/mutation mutex; after worktree admission, records owner before reserve/spawn, holds fence through spawn, removes ownership on failure. Duplicate session IDs cannot overwrite ownership. Close/write/resize/colors and binary input/checkpoint enforce ownership. Attach remains observation, not transfer. Read-only and unrelated routing/SSH operations release this mutex.
- CloseAll closes only caller's scope; legacy closes only legacy sessions. Shutdown retains daemon for other registered owners, alive sessions, or active routing. Eligible idle shutdown sets draining while holding the same fence. Registered disconnected owners are not inferred dead; idle watchdog retains them. Registration on WS is rejected; bind requires authenticated connection, matching token and epoch.
- No app_exit change, coordinator, helper/routing teardown, web-device protocol change, or Todo mutation. No commit. Unrelated frontend/theme/sidebar/project-selection files left untouched.

## Verification
- Maestro knowledge search found instance-specific cleanup rule; coding specs loaded. `maestro kg callers handle_create`: graph uninitialized; bounded source read fallback. No graph initialization or subagents.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib daemon::`: 146 PASS.
- Final focused `cargo test --manifest-path src-tauri/Cargo.toml --lib owner_native_ws_execution_isolation_and_reconnect`: PASS after final lock-scope edit.
- `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (14 existing warnings).
- `npx tsc --noEmit`: PASS.
- `node --test scripts/ptyHostSocket.test.mjs`: 17 PASS. Harness fixed two stale missing local-module imports and protocol-version fixture; tests execute actual TS transport with fake WS/native IPC.
- Combined existing exit suites + socket suite: 43 PASS (`terminalExitCleanup`, `terminalExitTask`, `terminalRestorableExit`, terminal API cleanup).
- `git diff --check` scoped files: PASS. Modified Rust modules remain below 2000 lines (server.rs 1980).
- Native/WS loopback integration exercises production native handshake, two owners, epoch/token rejection, real test-owned shell create/write/resize, foreign native write/resize/close rejection, scoped CloseAll, legacy rejection, shared Shutdown retention, failed spawn rollback, native reconnect and scope queries. Only a newly spawned test shell is closed; no user processes touched. Windows execution only; Unix runtime untested.
- Output logs available in this session's tool results (temporary pi-bash-bg-Uuds5u directory). Combined exit command had a trailing log-summary `rg` unavailable in that shell; its preceding tests all passed, and standalone diff check passed.

## Exact next seams / deliberate limitations
1. Add OS-verified GUI/daemon process identities and retained handles before dead-owner reclamation or any exclusive daemon-stop proof. This slice deliberately never expires disconnected registrations; a daemon may be retained indefinitely after previous owners leave. Epoch is a capability fence, NOT process-death evidence. No owner token is persisted or logged.
2. Implement OwnerExit on the same ownership admission fence with per-owner inflight/closing state, bounded stop/reap evidence and idempotent receipts. Current PTY admission serializes creates/mutations globally; future per-owner admission can improve concurrency without weakening the fence. Existing PTY close semantics are unchanged, not tree-stop proof.
3. Restore policy must consume session scope queries rather than attach arbitrary listed sessions; current cross-owner attach remains observation and mutation rejects. No automatic adoption/claim. Register/bind is operational, but metadata restore policy is not this slice.
4. Add web-device equivalent ownership, routing/SSH consumer references, bounded helper/tree cleanup, native coordinator/metadata transaction/exit-ready commit and frontend progress/retry/resume. No app_exit gate until that full replacement works. Legacy daemon status remains unsupported for future OwnerExit while old startup/exit behavior is preserved now.
5. Further hardening tests should include concurrent spawn/OwnerExit, binary foreign input/checkpoint fixtures, OS-death validation and real GUI lifecycle once those seams exist. Do not interpret the passing session-isolation test as a complete cleanup acceptance or zero-leak guarantee.

Todo12 remains incomplete; root owns status. Old backend-handoff and rollback archives are not current implementation.
