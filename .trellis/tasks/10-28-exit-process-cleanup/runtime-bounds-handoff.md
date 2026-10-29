# Bounded runtime continuation

Todo12 remains active; no Todo status changes, commit, frontend/native coordinator, identity-path changes, or user-process/credential operations.

## Exact incremental changes

- `server/runtime_ownership.rs` + `server/ownership.rs`: SSH request/release publishes owner inflight RAII permit and consumer reference before releasing ownership mutex. Remote execution occurs without that mutex. Permit is returned after result (also on unwind). Legacy inflight operations explicitly block final drain. Consumer removal is after successful result; concurrent operations conservatively retain references rather than erase a possibly reacquired reference. Routing logic is unchanged.
- `server/owner_exit.rs`: outstanding owner operations return pending admission/runtime timeout without releasing their SSH references. SSH strict cleanup executes outside ownership mutex. Owner fence remains closed for retry. Existing final-owner identity and process-wait proof paths untouched.
- `features/hooks/claude.rs`: `HookListenerTask::join_until` bounds caller waiting and retains listener handle (which owns connection-worker handles) after timeout. Panic is sticky, not success on second call. Normal completed-worker reaping and shutdown joins preserve panic evidence.
- `server.rs`: hook drain retries bounded two-second joins with the same retained task; daemon stays alive on timeout/panic, so native OS wait cannot falsely report stopped. Does not spawn replacement workers or abandon outstanding handles.
- `ssh_agent_bridge.rs` + `ssh_agent_bridge/owned_shutdown.rs`: root remains in slot until checked kill/try_wait reap; Windows Job termination and empty proof precede cleanup completion. Reader/stderr handles live in control across deadline failure. Reconnect must successfully clean previous attempt before replacing slots. Missing pipe, admission/resume failure and cancellation paths retain child rather than discard it. Strict cleanup uses nonblocking lock acquisition, retains worker handles on timeout, retries retained readers/root, and makes reader/worker panic sticky. No unconditional Child::wait remains in these bridge paths.
- `ssh_agent_bridge/tests.rs`: existing manager fixtures initialize new sticky worker-failure state.

## Verification (Windows)

- `cargo test --manifest-path src-tauri/Cargo.toml --lib daemon:: -- --test-threads=1`: **163 passed**, output/runtime-bounds-daemon-tests.txt. Includes existing final-owner subprocess/OS wait tests, active test-owned SSH Job test, new inflight permit lock/cancellation test, reader timeout/retry and sticky panic tests, stopped-worker timeout/retained-registry retry, legacy failure cleanup of a local test-owned cmd child.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib listener_deadline_tests -- --test-threads=1`: **2 passed**, output/runtime-bounds-hooks-tests.txt (timeout retains handle then retry joins; panic stays failed).
- `cargo check --manifest-path src-tauri/Cargo.toml`: **passed**, existing warnings, output/runtime-bounds-check.txt.
- `npm run check:architecture`: **passed**, output/runtime-bounds-architecture.txt.
- `npm run check:architecture -- --strict`: **passed**, 1444 files, zero new violations, output/runtime-bounds-architecture-strict.txt.
- Scoped `git diff --check`: **passed**, output/runtime-bounds-diff.txt.

Initial compilation was blocked by concurrently edited cc_connect/side_question/web code. Owning work resolved those errors; this agent did not modify those files. Final commands above ran after resolution.

## Boundaries / limitations

- Unix strict SSH tree proof remains explicitly unsupported; Unix not built/tested. No new Unix support claimed.
- Hook callback cannot be forcibly cancelled safely. Deadline expiration retains its task and keeps daemon alive; bounded native wait remains timeout until callback finishes. A panic is sticky failure, not retry-to-success. Approval/notification background lifecycle was not redesigned.
- Remote request itself retains existing protocol timeout (including long history requests); OwnerExit can now acquire admission state and return bounded pending rather than wait on remote work under its mutex. No remote fixture/secrets used; new cancellation/timeout fixtures are local channels and owned child processes.
- Concurrent release/acquire conservatively retains consumer bookkeeping. A later explicit release or owner exit clears it; this chooses retention over unsafe final-owner stop.
- Existing broader SSH identity replacement policy and ordinary routing synchronization were not rewritten.
- Existing dirty work was expected continuation baseline and preserved. No registry/protocol/process identity compatibility paths were removed.

Knowledge gate: `maestro search "instance process cleanup kill" --wiki-only --no-emb --limit 3` found instance-specific no-image-kill guidance; coding spec loaded. Impact query `maestro kg impact runtime_frame` reported graph uninitialized. Bounded source/caller fallback traced runtime_frame/OwnerExit, bridge spawn/cleanup, hook listener's only managed caller. Report schema files `.pi/agents/general-executor-report.schema.json` and `flow/agents/general-executor-report.schema.json` absent; inline report contract used.
