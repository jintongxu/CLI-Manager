# Frontend App exit/restore integration handoff

Frontend chain implemented. Root retains all task/status ownership; #13 is NOT declared complete. Native guard activation and final cross-layer acceptance remain root/native agent work. No backend edits, commits, application launch or process kills.

## Contract and changes
- App window close, close dialog, running-task stop choice, tray-quit-requested and native app-exit-requested share the guarded exit path. Minimize/cancel do not prepare. Removed background exit action and legacy app_exit invocation; stop no longer clears session metadata.
- src/app/exitTransaction.ts executes native prepare -> pause/drain automatic persistence -> await save -> cleanup(metadataSaved:true) -> status polling -> ready/canExit/metadataSaved validation -> app_exit_commit. Receipt matches actual native camelCase schema, including instanceId/generation/workerRunning. Stale receipts cannot commit. Duplicate in-flight calls do not launch another transaction. Cleanup retry retains the native transaction ID and saved snapshot. Metadata-save failure aborts before cleanup. Resume failure keeps transaction and persistence fence; retained timeout worker is never duplicated.
- src/app/useAppExit.ts composes terminal capture, explicit durable session/layout/workspan/currentWork save and close backup. No effect cleanup calls exit; unmount/Fast Refresh has no exit authority.
- AppExitOverlay plus exitMessages provide bilingual visible progress, resource-specific labels/errors, retry/resume. Errors retain visible application. Resource operation failures include native diagnostic codes.
- sessionPersistenceBarrier serializes automatic sessionStore writes, drains prior writes, suppresses close/process-exited overwrites during cleanup. Explicit saveRestorableExitSnapshot bypasses only that fence and awaits Store.save after all fields. Snapshot capture coalesces concurrent force calls, waits existing capture, propagates forced serialization failures instead of silently authorizing cleanup.
- ownedDaemonSessions queries actual PtyHostSocket.sessionScopes; only owned sessions reconnect. Unknown/foreign/legacy never automatically attach; cold reconstruction remains unchanged, including native CLI resume IDs. Startup restore rejection/disabled cleanup now stops only verified owned sessions, not global closeAll.
- Existing settings policy compatibility signatures/unions remain untouched because owned by policy agent. App has no background branch or callback. Existing dirty appearance/sidebar/project-selection files untouched.

## Verification actually run
- `node --test src/app/exitTransaction.test.mjs scripts/historyResumeCommand.test.mjs scripts/terminalRestorableExit.test.mjs scripts/exitPolicyPreferences.test.mjs scripts/terminalSnapshotCapture.test.mjs scripts/terminalRemountSnapshot.test.mjs`: PASS 61/61, output/app-exit-tests.txt.
- After native event listener wiring: `node --test src/app/exitTransaction.test.mjs`: PASS 9/9, output/app-exit-final-tests.txt.
- `npx tsc --noEmit`: PASS, including final listener wiring.
- `npm run check:architecture -- --strict`: PASS 1456 source files, zero violations (before final small event listener change).
- Scoped `git diff --check`: PASS after final wiring.
- Tests execute actual App guard callback, transaction callbacks with mocked native commands, actual sessionStore with storage seam, owned-session filtering. Cover awaited save ordering, duplicate requests, metadata failure/abort, close failure, same-ID retry, stale receipts, retained-worker resume rejection, restore data not wiped, cold native CLI reconstruction and snapshot regressions. Not full mounted React/native E2E.
- First expanded snapshot suite exposed timing/coalescing regression; production snapshot queue corrected (no fixture repairs); all 61 then passed.

## Pending integration/manual acceptance
Root/native agent must verify admission fences during saving across direct WebSocket and IPC creation before guard activation. Native prepare/resume is actively being integrated; older handoff unsupported notes are not treated as permanent. Resume may legitimately reject partial cleanup and UI retains transaction/error. Verify native no-daemon and shared-owner cases, external OS/tray event delivery, real Windows tree shutdown proof, disk-save failure, timeout/retry and restart restore. Manually switch English/Chinese and inspect UI/resource messages, minimize/cancel and Fast Refresh. None performed due no-app-launch boundary. Root owns TEMP changelog/feature-list updates and statuses.

## Discovery and source compatibility
Root cause: previous App mixed background continuation with exit and allowed asynchronous metadata writes/clears around process stop; ordering now sits in App transaction with durable persistence barrier and native authority. Touchpoints checked: App callbacks/events, sessionStore, snapshot capture, restore/attach actions, daemon scope transport, native coordinator receipts. Settings normalization/theme/sidebar/hook process implementations are separate owners, not modified. Scenarios include restore on/off, idle/running, minimize/ask/stop, window/tray/native, duplicate/retry/old receipt, split/workspan/currentWork, local/WSL/SSH cold reconstruction; native resource ownership delegated to backend.

Branch wt/task-1027-2130-3c711d70c03c has no upstream. Knowledge search completed with reference-only hits; coding specs loaded. GitNexus impact attempted, `.gitnexus/run.cjs` missing; frontend architecture contract + bounded caller/source inspection used fallback, graph risk unresolved. Report schema files `.pi/agents/general-executor-report.schema.json` and `flow/agents/general-executor-report.schema.json` unavailable; inline schema used.
