# Todo13 implementation evidence

## Root cause and production change
FinishState → frontend lifecycle mapping incorrectly treated historical ancestry + operation blocker as completion progress. Removed only `state.blocker && state.merged` from finishStatus. Backend production, receipts, IPC, labels/active-only runtime gates, and existing dirty tabbar files untouched. No user repository/database mutation, commit or sync.

## RED before production edit
Command: `node --test scripts/worktreeFinishRecovery.test.mjs` (output: red-tests.log).
Old expression was still in production when run: 24 tests, 22 pass, 2 fail. `lifecycle matrix keeps historical dirty and prepared checkouts active, true recovery pending` and `actual startup repairs stale SQL pending in both stores/tree and repeated reload is idempotent` both fail with actual pending / expected active. Error-preservation test passed. This is direct production mapping plus actual WorktreeStore/ProjectStore/tree proof, not a handwritten replica.

## GREEN
- `node --test scripts/worktreeFinishRecovery.test.mjs scripts/worktreeStatus.test.mjs scripts/terminalProjectTabsModel.test.mjs scripts/terminalProjectTabsInteraction.test.mjs src/features/terminal/tests/terminalTabLifecycle.test.mjs`: 116 pass. Combined final run including `scripts/worktreeStartupTerminalModel.test.mjs`: 118 pass, 0 fail, recorded in green-tests.log.
- `node --test scripts/worktreeStartupTerminalModel.test.mjs`: 2 pass. Actual pure active/pending label/group models, hidden mixed layout ID/cwd stability; actual TerminalStore daemon/snapshot restore for main/Worktree and visible/hidden (8 combinations). Existing dirty lifecycle test fixture read/reused but file not edited.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run check:architecture -- --strict`: exit 0; 1257 source files, 0 above 2000 lines, 0 new violations.
- `git diff --check`: pass (existing CRLF conversion warnings only).

## Rust filtered temporary repositories
- `cargo test --manifest-path src-tauri/Cargo.toml --lib startup_status_ -- --nocapture`: attempted twice, build script failed copying currently locked bundled OpenConsole.exe (os error 32); no test executed on those attempts. Did not stop user processes or remove resources.
- `TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml --lib startup_status_ -- --nocapture`: PASS 3 newly added tests, 1534 filtered out. Per-command packaging resource override only, no config file edit; library authority compiled unchanged. Existing unrelated ssh_agent_bridge.rs fetch_update deprecation warning.
- Proof: same-base HEAD clean/tracked/untracked with no receipt; inspect repeats preserve working bytes, registration and no journal. Dirty yields merged=true, finish_dirty_checkout, cleanupPending=false. Also novel tip dirty / historical merged dirty / prepared dirty; missing registration/path/branch without receipt. All destructive Git/filesystem setup isolated to tempfile repos. No full Rust suite.

## Discovery and limits
Fallback contracts + callsites: finishStatus sole Store caller; App startup and syncStore backup restore invoke markMissingWorktrees; ProjectStore rebuilds tree. SessionStore/TerminalStore restore retain identity; label and grouping gate remain active-only. Graph runner unavailable: graph impact UNKNOWN, not no risk. Ask/auto App entry reviewed statically, not interactive app reboot. No real user checkout/SQL/receipt inspection; no claim that every user record had this trigger. Window/tray/hook/layout unrelated and unchanged. Independent review (Todo14) covered 4/4 fix/test files and relevant callers with no confirmed findings: agent://bb4265e4-2bc3-46d0-817f-369aed58f94c. TEMP CHANGELOG.md and docs/功能清单.md Worktree completion section updated in Todo15; no further source changes invalidated prior checks. Review confirmed cleanupPending/done cover true recovery phases, failed inspect retains pending, active-only terminal gates and restore identities remain unchanged. No formal knowledge candidates added (0): distinction between historical merge evidence and cleanup authority is already prescribed in the existing Worktree isolation contract; this task records the concrete regression rather than duplicate the governing constraint.

## Schema
.pi/agents/general-executor-report.schema.json and flow/agents/general-executor-report.schema.json absent; use authoritative inline report schema.
