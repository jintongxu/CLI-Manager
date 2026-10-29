# Bounded safe rollback — Todo12 remains incomplete

## Decision and root cause
Partial backend ownership enforcement replaced existing operational interfaces before an owner-aware client, supported Unix close, or a successful native cleanup receipt existed. This made app_exit always denied, legacy CloseAll/Shutdown rejected, and Unix close unsupported. Correct at the introducing backend boundary by restoring the complete baseline, not by adding another fallback. No exit-feature implementation is retained, including suspended Windows Job changes: their spawn-failure retention and integration proof were incomplete, so partial retention was not the safer bounded correction.

Knowledge gate: Maestro search returned the instance-specific process-cleanup rule (no image-name kill); coding specs loaded. GitNexus runner absent and code index uninitialized; used backend-handoff, PTY daemon and architecture contracts, and exact Git diff. Branch wt/task-1027-2130-3c711d70c03c has no upstream; no synchronization performed.

## Exact discovery / rollback manifest
Machine-readable rollback-manifest.json identifies baseline commit, every restored/deleted path, and pre-rollback SHA256s of 121 protected files. output/exit-rollback-before.patch preserves tracked implementation diff. rollback-evidence/ preserves the exact pre-rollback content of all 16 backend files (historical source only, not compiled).

Restored 13 tracked files to HEAD:
- src-tauri/src/lib.rs: original app_exit signature/registration and ExitRequested side-question cleanup; remove native coordinator gate.
- src-tauri/src/features/terminal/commands.rs: remove owner frame relay additions.
- src-tauri/src/infrastructure/daemon/protocol.rs: remove unconsumed owner wire variants.
- src-tauri/src/infrastructure/daemon/server.rs: restore legacy CloseAll, Shutdown, close/session behavior; remove ownership admission and mutation fences.
- src-tauri/src/infrastructure/daemon/server/tests.rs: restore routing-active shutdown baseline regression.
- src-tauri/src/infrastructure/daemon/client.rs: restore discovery/upgrade behavior and original response variants.
- src-tauri/src/commands/web_device.rs: restore upgrade/shutdown baseline behavior.
- src-tauri/src/infrastructure/pty/manager.rs: restore original Windows/Unix close and close_all (including baseline limitations).
- src-tauri/src/infrastructure/pty/platform/mod.rs: remove unsupported tree proof interface.
- src-tauri/src/infrastructure/pty/platform/windows.rs: restore existing ConPTY adapter.
- src-tauri/src/infrastructure/process/process_job.rs: restore existing Job interface.
- src-tauri/src/features/remote/cc_connect/mod.rs: restore helper stop paths.
- src-tauri/src/features/files/live_server/mod.rs: remove unused deadline method.

Archived then removed three untracked implementation files:
- src-tauri/src/features/terminal/exit_coordinator.rs
- src-tauri/src/infrastructure/daemon/server/owned_exit.rs
- src-tauri/src/infrastructure/daemon/server/ownership.rs

Daemon host is in server.rs; no separate host file changed. web_server.rs and all other backend files were already baseline and remain untouched. Frontend theme/sidebar/project-selection and all unrelated docs/scripts were untouched. PRD/design/implement retained; backend-handoff given an explicit historical/superseded banner. No global reset/clean, commit, app launch, or user-process termination.

## Verification
- git diff --exit-code -- src-tauri: PASS; git status --short -- src-tauri: empty.
- cargo check --manifest-path src-tauri/Cargo.toml: PASS, 14 existing warnings.
- cargo test --manifest-path src-tauri/Cargo.toml --lib pty::: PASS, 55 tests, including fixture-owned ConPTY spawn/write/read and oneshot exit.
- cargo test --manifest-path src-tauri/Cargo.toml --lib shutdown_retains_daemon_while_routing_runtime_is_active: PASS, 1 test.
- node --test scripts/terminalExitCleanup.test.mjs scripts/terminalExitTask.test.mjs scripts/terminalRestorableExit.test.mjs src/features/terminal/api/terminalExitCleanup.test.mjs: PASS, 26 tests.
- npm run check:architecture: PASS, 1432 sources, zero violations.
- npm run check:architecture -- --strict: PASS, zero violations.
- git diff --check: PASS (line-ending warnings only).
- Protected-file hash comparison before updating task handoff: PASS, 121 unchanged. Handoff is the sole deliberate update among those files.

Logs: output/exit-rollback-{check,pty-tests,shutdown-tests,frontend-tests,architecture,architecture-strict,diff-check}.txt.
Windows test environment only; Unix path restored exactly but not runtime-tested. No GUI exit or live-user-process test performed. Baseline behavior restored, NOT proof of complete process reclamation or elimination of leaks.

## Remaining implementation gap / blocked dependency
Todo12 must be implemented end-to-end before Todo13 can proceed: OS-verified owner identity and native/WS registration; PTY and web-daemon owner protocol; routing/SSH/shared resource accounting and last-owner drain/OS exit wait; complete native creation/inflight admission; bounded helper/tree stop and reader/watcher joins including Unix; retained retryable failures; coordinator metadata ordering and a real ready receipt/commit; shared-daemon, foreign-owner and concurrent-create regression acceptance. These are missing implementation, not an environmental or permission blocker. Start from baseline plus approved contract; do not restore the archived half-protocol or wire a guard before a working completion path exists.

## Todo mutation permission limitation
Attempt to set Todo12 blocked/context/handoff was rejected: `@exit-restore-operability cannot update task #12` (assigned to exit-backend-complete). Parent/root must apply the status/context update; Todo12 currently remains pending, not completed. Todo13 was already blocked and remains unchanged. The requested blocked context is fully recorded above.
