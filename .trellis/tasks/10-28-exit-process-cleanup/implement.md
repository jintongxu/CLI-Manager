# Implementation handoff (Todo12–14; no source changes in Todo11)

## Verified source map / impact fallback
Numbers are discovery anchors, use symbols after edits. GitNexus unavailable; cross-language impact remains manual/high-risk lifecycle work.

| Layer | Exact existing seam / findings | Action |
|---|---|---|
| Native | `src-tauri/src/lib.rs:188 app_exit` calls `app.exit(0)` directly; `:1085 RunEvent` permanently shuts side-question even on ExitRequested | thin commands + coordinator state, native permit guard; no blocking callback |
| Frontend | `src/app/App.tsx:1394 exitApp`, `:1451 runExitCleanup`, `:1586` policy, `:1694` tray, `:1709 onCloseRequested` | single transaction; remove background and clear branch; use receipt |
| Policy | `src/features/terminal/api/terminalExitCleanup.ts`, both existing `.test.mjs` | retire closePty/background/boolean proof; failure cannot permit exit |
| Transport | `api/TerminalProcessManager.ts::closeAll` -> `transport/PtyHostSocket.ts:370 closeAll` -> server frame `CloseAll` | new owner bind and dedicated exit IPC; don't tombstone before success |
| Daemon wire | `src-tauri/src/infrastructure/daemon/protocol.rs::ClientFrame/DaemonFrame/supported_features`, `client.rs::DaemonClient::connect`, `connect_or_spawn/spawn_and_connect/spawn_daemon_process` | additive feature + Register/Bind/OwnerExit, identities, retained Child; remove unsafe legacy upgrade shutdown |
| Daemon server | `server.rs::ClientHandle/handle_frame/handle_create`; Close/CloseAll around 1540; Shutdown 1793; `DaemonHost::routing_start/routing_stop`; `release_ssh_agent_bridge` | owner registry/admission, no global close, closing state and receipt; split new logic into cohesive modules (server already near limit) |
| PTY | `src-tauri/src/infrastructure/pty/manager.rs::close_session_arc/close/close_all/create_with_launch` | managed process identity/tree + closing retention, bounded reap and reader completion |
| Shared process | `src-tauri/src/infrastructure/process/process_job.rs::ChildJob::assign/terminate` | currently post-spawn assign, terminate ignores errors; add controlled spawn/job proof and bounded wait, no image-name kill |
| Bridge | `daemon/ssh_agent_bridge.rs::BridgeControl::stop/terminate_current_child`, `run_bridge_once_inner`, `SshAgentBridgeManager::ensure/release/Drop`; `infrastructure/ssh/proxy.rs::build_proxy_command/run_helper_and_exit/bridge_stdio` | release consumer refs, explicit drain and tree stop, bounded readers; no remote kill |
| Side question | `features/terminal/side_question_process.rs::Registration/OwnedChild/shutdown` | transaction fence, cancellation, bounded tree receipt |
| cc-connect | `features/remote/cc_connect/mod.rs::stop_inner/shutdown`, spawn at 589 (authorization) and 1237 (service) | both children included; retain on timeout rather than take+Ok |
| Servers | `features/files/live_server/mod.rs::RunningLiveServer/Drop/shutdown` (JoinHandle retained until Drop); `commands/web_server.rs::stop_runtime/shutdown` | collect actual completion; preserve existing timeout retry behavior |
| Web-device | `commands/web_device.rs::ensure_web_daemon/shutdown`, `src-tauri/src/web_daemon.rs::Request/DaemonInfo/run/stop/handle_request` | shared owner protocol, explicit stop, process wait; old unsupported; short connections not owners |
| Metadata | `api/sessionStore.ts::saveSessions/saveSplits/saveActiveSessionId/saveWorkspans/saveCurrentWork`; `api/sessionSnapshotPersistence.ts::flushTerminalSnapshotsNow`; `store/terminalRuntime.ts` auto writes | save metadata before stop, serialize/pause exit-time persistence; no clear |
| Restore | `store/terminalStore.ts:1464 restoreSessions`, daemon attach section ~1495, `buildCliResumeStartupCommand` ~1627 | metadata recreate by default, no foreign owner adoption; anonymous filtered via isPersistableSession |
| Preferences | `shared/preferences/settingsStore.ts::ExitWithRunningTasksBehavior/load/update`; `features/sync/api/syncStore.ts:364 applyPreferences` loops update then load | shared pure normalize; preserve unrelated dirty appearance transaction |
| UI/i18n | `features/settings/components/pages/ThemeSettingsPage.tsx`, `features/terminal/api/RunningTasksExitDialog.tsx`, `shared/i18n/messages/{settings,terminal}.{zh-CN,en-US}.ts` (locate exact exit keys) | remove background and update stop/restore/error messages both locales |

Unrelated confirmed exclusions: sidebar/theme/project-selection behavior, remote independent process management, parent dev watcher, credential contents, historical session deletion. No modifications to them for this task. Backup/sync only touches preference normalization and exit ordering, not appearance logic.

## Backend tests (Todo12)
Add fixture-injected interfaces for `Clock/deadline`, `ProcessIdentity/ProcessWait`, `ResourceStop`, `OwnerRegistry` and transaction coordinator; use existing daemon server tests factory to avoid real daemon/process exit. Test names/filters below are proposed stable prefixes to implement.
- `owned_exit`: two owners, same owner TCP+WS, disconnect/rebind, attach != ownership, unknown legacy, routing shared refs, final owner draining rejects register/create, stale epoch/token/PID start-time mismatch, dead/unknown owner, in-flight spawn fence and idempotent retry.
- `exit_coordinator`: metadata missing blocks, forged/missing txn app_exit blocks, native ExitRequested prevented, prepared abort reopens, cleanup failure retains gate, resume invalidates ready, repeated requests coalesce, process ACK but still alive != success, shared daemon retained != failure.
- `owned_process`: spawned test parent/child/grandchild stop and unrelated fixture survives; job assignment failure fails admission; exact-PID reused identity rejected; timeout retains handles; reader completion timeout bounded. Never target a process outside fixture-owned handles.
- Existing `side_question_process` shutdown tests: bounded cancel/reap and no registration after fence.
- Existing `stop_timeout_retains_worker_until_a_successful_retry` (web_server) retains behavior.
- `web_daemon` ownership equivalent: legacy unsupported, service sharing, cancel connection worker and wait; no global shutdown on short connection close.
- Existing `server/tests.rs` routing-retains-daemon test ~461 is old ACK semantics: retain legacy compatibility error test and add explicit owned shared receipt test.

Commands after implementing these filters:
```
cargo test --manifest-path src-tauri/Cargo.toml --lib owned_exit
cargo test --manifest-path src-tauri/Cargo.toml --lib exit_coordinator
cargo test --manifest-path src-tauri/Cargo.toml --lib owned_process
cargo test --manifest-path src-tauri/Cargo.toml --lib side_question_process
cargo test --manifest-path src-tauri/Cargo.toml --lib stop_timeout_retains_worker_until_a_successful_retry
cargo test --manifest-path src-tauri/Cargo.toml --lib web_daemon
cargo check --manifest-path src-tauri/Cargo.toml
```
Verify each new filter actually runs tests (zero matches is not acceptance). No live CLI app kill tests.

## Frontend tests (Todo13)
Extend actual-function mocks, not source-string-only assertions:
- `scripts/terminalExitCleanup.test.mjs` + `src/features/terminal/api/terminalExitCleanup.test.mjs`: restore on/off equal cleanup; no background; per-resource failures/timeouts block; retained_shared permits only after release; duplicate transaction and retry.
- New `scripts/exitOwnershipContract.test.mjs`: ordered prepare -> flush/save/layout -> cleanup -> app_exit; metadata failure aborts before stopping; cleanup failure never invokes app_exit; native event routes same confirmation; minimize/cancel no cleanup; paused persistence prevents close overwrite.
- New `scripts/exitPreferenceCompatibility.test.mjs`: background -> ask via load/update/import; ask/minimize/discard retained; no implicit destructive default.
- Extend `src/features/terminal/api/sessionStore.naming.test.mjs` for metadata persistence, anonymous exclusion and failure; focused restore test ensures native CLI session ID used for rebuild and no foreign live attach.
```
node --test scripts/terminalExitCleanup.test.mjs src/features/terminal/api/terminalExitCleanup.test.mjs src/features/terminal/api/sessionStore.naming.test.mjs
node --test scripts/exitOwnershipContract.test.mjs scripts/exitPreferenceCompatibility.test.mjs
npx tsc --noEmit
```

## Integration (Todo14)
- Independent `npm run check:architecture` and `npm run check:architecture -- --strict`; no exemptions, no >2000-line additions. Extract responsibility modules instead of extending near-limit App/server/store monoliths.
- Read cross-layer wire/serde and native guards; run focused tests and affected compile once final. Update TEMP CHANGELOG and docs/功能清单 without overwriting pre-existing entries.
- User-assisted desktop matrix: test instances only, dual-instance sharing, tray/explicit exit, running tasks, legacy unsupported, bilingual errors, process/memory after exit. Record unrun rather than invent evidence.
- Mandatory acceptance includes live owned fixture tree reaping; mocked receipt tests alone cannot prove OS cleanup. Failure to obtain robust ownership means blocked/unsupported, not blanket force.

## Todo11 verification
Protocol/task-only phase: full approved plan and previous discovery read, bounded source followups completed. New documents reviewed for required semantics and exact API seams. No application tests/build needed to prove unimplemented behavior; implementation commands above are NOT reported as passed. No source edited and no process was started/killed for verification.
