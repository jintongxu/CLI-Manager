# Verification

## Follow-up: general presentation isolation
- Reproduction state showed the closed local terminal hidden and global fallback selecting an existing Current Work SSH session. No new SSH connection was established by this evidence.
- Root cause: navigation excluded Current Work members in ordinary mode while content did not; Current Work portals also bypassed outer scope.
- Shared allowed IDs now govern navigation/content/effective focus/Current Work geometry and portal targets. Backing pane trees remain mounted and unchanged. Empty allowed set yields null effective focus/empty content, not a global fallback. Focus repair also applies in All scope.
- `scripts/terminalPresentation.test.mjs`: 72 behavioral hook/model cases covering 4 scopes × 2 modes × 3 environments × 3 geometries, last-visible hide, mode switching and backing-state preservation. With recovery/layout/UI tests: 116 passed.
- TypeScript and strict architecture passed (1661 sources, zero violations); diff check passed with existing metadata line-ending warnings.
- Independent bounded review agent://68412ba8-5145-44ea-b56c-7878e201d30a: approved, no material findings. Native desktop click reproduction remains unverified because multi-monitor pointer calibration failed; no unrelated PTY was closed.

## Implemented
- Shared prepare/create implementation and unpublished prepared PTY ownership; strict ACK-before-replace, source incarnation/close coordination, latest-layout replace.
- Current Work synchronous identity substitution and queued latest DTO persistence; emergency enters/activates normal Current Work path.
- Environment checks: inherited path, matching active Worktree, shell/env, WSL distro+cwd; source/resolved SSH rejected.
- Shared risk-grouped menu, busy/error/confirmation feedback in zh-CN/en-US; navigation fallback. No CLI replay.

## Independent review and correction
Review agent://e9aafc4e-fa17-4b2b-8380-364a87ee9823 found three concrete defects; fixed together, evidence agent://985890a0-997c-4a00-b851-df9e609a5633:
1. Live TerminalStore getter could spread functions into persistence: exact eight-key JSON DTO whitelist now tested with full-store-shaped getter.
2. Dead candidate could authorize old close: exited/error before close now rejected without destroying original; death during irreversible close records actual committed identity/status and explicit error.
3. Force-end incorrectly required reconstructible launch environment: production-binding tests now permit missing Worktree/cwd/distro while rebuild remains blocked.

## Final checks
- `node --test scripts/currentWorkRecovery.test.mjs scripts/terminalRecoveryUi.test.mjs scripts/currentWorkAnonymousClose.test.mjs scripts/terminalWorkspan.test.mjs`: 44 passed, 0 failed.
- `node --test --test-name-pattern=recovery src/features/terminal/tests/terminalTabLifecycle.test.mjs`: 23 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- `npm run check:architecture -- --strict`: 1658 sources, 0 above 2000 lines, 0 violations.
- `git diff --check`: passed (existing workflow logs have LF/CRLF warnings).

## Baseline / manual limitations
Full terminalTabLifecycle suite retains five failures reproduced with HEAD old-store fixture by implementation agent: daemon hidden-state restore, renderer source contract, daemon task-state restore, create/split saveSessions failure-logging assertions. These unrelated failures were not changed or declared passing.
Native Tauri PTY and nondefault WSL execution, physical keyboard/menu interaction and Settings language switching were not manually exercised. Tests mock native boundaries. No Rust modifications in this task; no Rust checks required. No automatic commit/merge/push.

## Knowledge assessment
No knowledge candidate staged: source-specific implementation facts are recorded here; no additional stable cross-task policy is asserted.
