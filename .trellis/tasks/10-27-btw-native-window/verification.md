# Native window integration verification

## Implemented
Reusable statically hidden native decorated btw-thread window; drag/resize/minimize/maximize use OS frame. Child early bootstrap is display-only, no main App SQL initialization or own inference model. Main sole owner publishes selected-thread snapshots through verified backend channel and accepts whitelisted validated intentions. Ready replay, owner epoch/revision/selection/generation fences, native command session + monotonic sequence high-water marks prevent replay with constant memory. Native close hides preserving inflight/history. Actual app exit cancels/reaps owned side processes. Dedicated limited capability; unrelated child app commands denied.

Review agent://f0592cc6-a5ce-455a-871d-3cbe97f839e6 identified lifetime dedup exhaustion and lost theme palettes; fixed in agent://b5f92a65-1c06-456f-a0df-0a33ec95e4fc. Both light/dark palettes now validated and applied on ready/live/reopen. 100001-edit boundary tests ensure legitimate commands remain usable and replays rejected.

## Passing evidence
- Native bridge/protocol tests: 10 pass final root rerun.
- Related BTW UI/model/navigation: 29 pass after fixes.
- tsc --noEmit --strict: pass after fixes.
- Strict architecture: 1382 files, zero >2000 lines, zero violations final root run.
- git diff --check: pass (existing workflow line-ending warnings).
- cargo check: pass implementation lane.
- cargo test --lib btw_window::tests: 3 pass after fixes.
- Isolated actual-exit cancellation test and 3 owned mock-child lifecycle tests: pass implementation lane.

## Limits
Started temporary dev job bg-2-mvqlcqeu. Current dev executable is under this worktree target/debug; installed production PID28032/31132 remained untouched. UIA find_control could not locate BTW toolbar reliably; did not invent coordinates or operate production. Physical native drag/minimize/resize/cross-monitor and close/reopen UI acceptance remain unverified. No real model request performed. Automated command/close/replay tests are not manual OS acceptance.

Unrestricted cargo test invocation hit pre-existing unrelated web_listener Config.trusted_network integration compile failure; focused --lib target passes. No commits or Git sync. Zero new knowledge candidates staged (existing contract/research already records sole-owner requirement).
