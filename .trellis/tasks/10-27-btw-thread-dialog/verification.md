# Integration verification

## Implemented
Independent compact cards and explicit-open in-app conversation dialog; source terminal/Pi identity captured from actual right-click terminal; default-off source-context inheritance; immutable current-branch text snapshot; isolated structured multi-turn SDK inference with tools/extensions disabled; cumulative streaming; stop/retry/copy/delete/clear; confirmation before reset/mode change; view-local memory only.

Reviewed and fixed: contradictory live agent identity must not fall back to stale saved Pi ID; context subprocess has caller-known cancellation identity; bounded registry tombstones cover cancel-before-register races; context failure keeps requested inherited mode and never silently starts noninherit inference; cards display mode; installed resources resolve from Tauri resource directory, not development checkout.

## Automated evidence
- `node --test scripts/terminalTabRow.test.mjs scripts/terminalBtw*.test.mjs scripts/piSideQuestionAgent.test.mjs`: 41 passed (final integration).
- `node --test scripts/terminalNavigation*.test.mjs scripts/terminalDrawerIntent.test.mjs scripts/terminalTabRow.test.mjs scripts/terminalProjectTabsInteraction.test.mjs scripts/workspanTabBarLayout.test.mjs`: 81 passed.
- `npx tsc --noEmit`: passed final integration.
- `npm run check:architecture -- --strict`: 1373 files, zero >2000 lines, zero violations.
- `git diff --check`: passed (existing .workflow line-ending warnings only).
- Backend lane final `cargo test --manifest-path src-tauri/Cargo.toml side_question --lib -- --nocapture`: 13 passed after packaging/lifecycle integration.
- Packaging lane `node --test scripts/sideQuestionRuntime.test.mjs scripts/piSideQuestionAgent.test.mjs`: 13 passed including real SDK runtime relocation, with follow-up focused staging tests after optional-dependency validation tightened.
- Frontend lane `npm run build`: TypeScript + Vite passed before subsequent small root mode labels and lifecycle updates; final tsc covers later TS changes.

## Review
Independent read-only review agent://09b8517c-a084-46e1-a1fa-5848c3023425 found 1 P1 and 2 P2 findings. All fixed and focused tests extended. Backend deployment result agent://7901b3e3-e7ad-4f59-b5b1-bf6a996942c0; lifecycle result agent://6031cce8-89a8-4bcd-9769-026ead9acaa4; source resolver independently tested in scripts/terminalBtwSource.test.mjs.

## Runtime/manual limitations
Started `npm run tauri -- dev`, job bg-1-mvq4w6ny. Startup completed, development window PID 17060 was identified separately from installed production PID 28032. UIA enumerated Chinese controls and the BTW toolbar button. Input failed with STALE_CONTROL_REF; stopped input as required. Physical end-to-end two-card followup/context toggle/cancel and manual settings language switching are NOT verified. Component bilingual render/handler tests are not a substitute for manual UI acceptance. No production process actions, no real provider calls, no clean-machine installer test.

Node >=22.19.0 must be on the installed application's PATH; dependency closure staging currently adds approximately 134 MiB (119 production packages). Offline relocation verifies deployable resources, not a full installer installation.

## Knowledge assessment
Zero new knowledge candidates staged. Actual upstream BTW snapshot/thread facts and the stale hidden-PTY recipe conflict were already captured in research evidence; no duplicate prescriptive entry added.
