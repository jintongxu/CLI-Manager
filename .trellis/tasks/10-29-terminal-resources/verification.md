# TEMP terminal resources delivery

Implemented read-only Windows terminal Job-member working-set observations and existing resource panel Terminals tab. Original session IDs deduplicated, current-page64 sort, visible2500ms singleflight, unknown/partial/remote explicit, existing-terminal navigation without lifecycle changes. Job/root identity and owner/revision checked; no arbitrary PID input, command/env/path disclosure, kills, restarts or deep sleep.

## Evidence
- Backend implementation agent://6b6028a0-9d6b-4b84-83a9-d1bda5b9ce28: production Windows Job allocating child/control fixture; cargo check and owner tests pass.
- Fault coverage agent://61e9a631-87a3-4910-81d7-a702715b9f17: actual aggregation denial/reuse/churn/budget/null/privacy plus real close/recreate handler race; terminal_resources15 pass.
- Frontend agent://3b4a87e2-ce5e-4bf2-b34b-e584bbbfa59f:26 focused and16adjacent pass, tsc.
- Independent final review agent://7331cc30-9bae-4fc7-834c-16e5c692be4c: fixed shared enumeration retry budget and CSS-hidden polling. Affected aggregator9/frontendresources15 tests pass, cargo check/tsc pass. Earlier unchanged navigation evidence reused.
- Root final normal+strict architecture1475files zero violations; diff-check pass line-ending warnings only.

## Limits / pending
Working-set sum includes shared pages, not unique/private RAM; no terminal total.500ms is cooperative not hard Windows syscall timeout. Remote/legacy/unsupported explicitly unavailable; no automatic daemon upgrade. Request-local child Arc safe borrow may defer final handle Drop, never blocks explicit job termination; snapshot discarded across close/root change.

No App launch or user-process operation. Real Pi comparison using equivalent Windows working-set counters, merged/standalone layout and language switching remain manual. Existing44terminal lifecycle harness failures (missing createTerminalRecoveryActions/stale JSX expectation) not fixed or represented as passing all tests.

TEMP CHANGELOG and feature inventory updated preserving prior work. No git commit/sync. Trellis review pending manual acceptance. Zero separate knowledge candidates staged: current lifecycle/statistics rules already recorded in approved contract and review; avoid duplicating design risks as verified general knowledge.
