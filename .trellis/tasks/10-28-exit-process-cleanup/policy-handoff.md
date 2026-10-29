# Todo13 bounded frontend policy handoff

Policy-only implementation; NOT full exit cleanup completion. Root retains all status ownership. Todo13 remains blocked until backend/coordinator integration is complete. No App.tsx, native backend, transport, or session persistence edits were made by this task. No app launch or commit.

## Gate and scope evidence
- Knowledge gate: `maestro search "exit running tasks settings preferences"` completed with coding-convention/reference hits, no relevant exit implementation knowledge; `maestro load --type spec --category coding` completed.
- GitNexus impact attempted before edits: `node .gitnexus/run.cjs impact normalizeExitWithRunningTasksBehavior --direction upstream --repo .` failed because `.gitnexus/run.cjs` is absent. Used approved design, fix-triage guide, frontend architecture contract and bounded symbol/caller searches as the requested fallback. Graph risk remains unresolved, not a low-risk graph result.
- Branch `wt/task-1027-2130-3c711d70c03c` has no upstream; no synchronization actions taken.
- Root cause: the preference boundary accepted legacy background behavior and the action resolver conflated restoring metadata with keeping live processes; normalization belongs at load/update/import and true-exit policy must ignore restore.
- Scenario coverage: restore on/off; zero/one/multiple running tasks; ask/minimize/discard; legacy background and malformed values; stored load, direct update and sync preference import; active appearance preview during unrelated preference update. Window focus, splits, hooks, shell/WSL, worktrees and multiple owners do not change this pure policy; actual lifecycle coverage remains integration work.

## Exact changes
- Added `src/shared/preferences/exitPolicy.ts`: pure `normalizeExitWithRunningTasksBehavior(unknown)` returns ask/minimize/discard, with background/invalid -> ask.
- `src/shared/preferences/settingsStore.ts`: import/re-export normalizer; load normalizes and queues persistence of migrated non-undefined values; update normalizes before disk/state writes. Existing appearance transactions and appearance-key write routing preserved. Legacy `ExitWithRunningTasksBehavior` union still includes background solely to compile unchanged App callbacks; runtime writes cannot preserve it.
- `src/features/sync/api/syncStore.ts`: actual private `applyPreferences` explicitly applies the same normalizer before settings update. Existing backup snapshot change preserved; no import pipeline refactor.
- `src/features/settings/components/pages/ThemeSettingsPage.tsx`: removed only the background exit choice.
- `src/features/terminal/api/RunningTasksExitDialog.tsx`: removed background radio/callback invocation; default/reset choice minimize; retained optional deprecated unused `onBackground` prop for App compatibility. Added explanatory translated text to minimize if tasks should continue.
- `src/features/terminal/api/terminalExitCleanup.ts`: resolver ignores restore and returns cleanup for idle, otherwise normalized task choice. Kept three-argument signature and legacy return union solely for unchanged App compilation. Cleanup implementation itself is untouched and is NOT the approved receipt coordinator.
- `src/shared/i18n/messages/{settings,common}.{zh-CN,en-US}.ts`: removed obsolete background exit option keys, removed background promise from exit/finished-task settings descriptions, clarified tray alternative in dialog description. Stop-task labels remain stop-task labels. No UI promise of metadata preservation was added while App still clears it.
- `scripts/terminalRestorableExit.test.mjs`: replaced obsolete background/keep-idle-alive expectations with actual resolver/normalizer matrix. Removed tests coupled to extracted legacy App implementation; coordinator integration must provide new real entry coverage.
- Added `scripts/exitPolicyPreferences.test.mjs`: executes complete transpiled production settings module with native storage seam, actual private sync applyPreferences entry exposed only in test compilation, normalization/preview persistence checks and bounded UI/i18n source assertions.
- `src/features/terminal/api/terminalExitCleanup.test.mjs`: loader supports the new pure helper dependency; legacy cleanup tests otherwise unchanged.

## Verification
- `node --test scripts/exitPolicyPreferences.test.mjs scripts/terminalRestorableExit.test.mjs scripts/terminalExitCleanup.test.mjs src/features/terminal/api/terminalExitCleanup.test.mjs scripts/appearanceTransaction.test.mjs scripts/appearancePreviewUi.test.mjs`: PASS, 35 tests.
- `npx tsc --noEmit`: PASS.
- `npm run check:architecture -- --strict`: PASS, 1446 source files, zero above 2000 lines, zero violations.
- `git diff --check`: PASS (existing CRLF conversion warnings only).
- Manual UI language-switch/native lifecycle verification not run: explicit no-app-launch boundary.
- Report schema files `.pi/agents/general-executor-report.schema.json` and `flow/agents/general-executor-report.schema.json` absent; final report follows supplied inline schema.

## Subsequent App/coordinator obligations — REQUIRED before completion
1. Replace all three true-exit entry flows with confirm -> native prepare -> flushed and awaited metadata saves -> cleanup -> ready receipt -> guarded app_exit. Minimize/cancel must return before prepare. Resolver changes alone are not lifecycle correctness.
2. Remove `discardSessions: true` semantics and any exit `sessionStore.clear`/destructive close-all metadata behavior. Discard means stop running tasks, NOT erase history/recovery metadata. App STILL HAS its old discard behavior in this handoff; never describe it as fixed.
3. Implement snapshot save barrier and prevent close/exited autosaves overwriting saved metadata. Restore via metadata/new owned PTY, not adoption of arbitrary daemon sessions.
4. Remove enterBackgroundTaskMode exit routes, old onBackground handler/prop, background type/return compatibility unions and unused restore resolver parameter after wiring. Existing native cleanup helper still permits old global/legacy semantics and must be replaced, not trusted as receipt proof.
5. Add actual close/dialog/tray entry tests, failure/timeout/unsupported receipts, retry/resume UI and bilingual messages, save-failure abort and lifecycle race coverage after backend availability. UI disablement is not native admission fencing.
6. Root owns CHANGELOG.md/docs/功能清单.md integration record updates (outside this bounded file scope), status transitions and full exit acceptance. No full-exit claim until those gates pass.
