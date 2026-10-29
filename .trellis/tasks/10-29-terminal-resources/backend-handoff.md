# Backend handoff — implemented

The earlier lifetime blocker was an overconstraint and is resolved by the user's explicit clarification: bounded request-local child Arcs are allowed. They can postpone last-handle Drop, but never lock or suppress explicit child.kill / Job termination. No Job handle is duplicated, transferred or cached. All request-local child references are dropped before final owner authorization/revision validation. No exit lifecycle redesign was made; only observation revision increments were added.

## Native API (actual registered command)
`terminal_resources_get_snapshot({ sessionIds: string[] })` is registered for the native main window. It uses only the already-connected DaemonBridge, never connects/spawns/restarts/upgrades. Requires owner binding and advertised `terminal_resources_v1`. Missing/old daemon returns `terminal_resources_unsupported`. WS and legacy relay reject `terminal_resources_native_only`.

Response (camelCase):
```
{ sampledAt: number, daemonEpoch: string, revision: string, rows: [
  { sessionId: string, status: 'complete'|'partial'|'unavailable',
    reasonCodes: string[], rootPid: number|null, rootCreatedFiletime: string|null,
    coverage: 'job_members', enumeratedCount: number, observedCount: number,
    workingSetSumBytes: number|null }
] }
```
Revision and FILETIME are decimal strings. Unix timestamp is milliseconds. Working sets can double-count shared pages; never label as unique RAM or total all rows. No executable/cmdline/environment/credentials or arbitrary PID input. Stable dedup after validating 64-ID/256-UTF8-byte limits. Owner failures reject whole request (including unbound/missing ownership), not permission-probing rows. SSH and WSL/bash launchers return unsupported_remote.

Native command errors: terminal_resources_native_only, terminal_resources_invalid_request, terminal_resources_unsupported, terminal_resources_owner_rejected, terminal_resources_unavailable, terminal_resources_observation_invalidated. Daemon response errors are normalized by native command. Rows use PRD reason allowlist. Empty observations are null. Root invalidation discards memory and identity. Complete requires every enumerated member observed plus stable membership. Partial retains only validated subtotal.

## Implementation and bounds
Production ChildJob sampler uses aligned bounded JobObjectBasicProcessIdList buffer, max 1024 members, max 3 enumeration attempts, max 4096 candidate observations across the request and a cooperative 500ms sampling budget. Individual Windows calls are not hard-time-bounded. Each process handle is scoped and checks FILETIME, alive state and Job membership before and after GetProcessMemoryInfo; root identity checked before/after; final membership detects churn. Request-local child references preserve borrow validity while explicit terminate remains independent. PTY active-entry pointer checks reject closed/replaced sessions. Owner observation revision invalidates prepare/resume ABA, bind/rebind, create/close and reconcile. Bridge revision invalidates native prepare/resume/replacement. Global admission/session locks are not held during process sampling.

## Verification
Windows focused `cargo test --manifest-path src-tauri/Cargo.toml --lib terminal_resources`: five passing tests, including real production PTY Job with allocating descendant and separately owned unrelated control; explicit termination while a request-local child reference exists; stale-root null after termination; auth rejection and prepare/resume ABA injected between sample and final validation; bridge revision, legacy rejection, input bounds/null serialization. Owner suite (`--lib owner_`): 18 passing, now including explicit resource WS rejection. Cargo check passes. Normal/strict architecture pass (zero files over 2000 lines). Logs: output/terminal-resources-{tests,owner-tests,check,architecture,architecture-strict}.txt.

Remaining verification limitations: no deterministic Windows access-denial/PID-reuse/membership-churn injection, no hard syscall timing proof, no manual real-Pi comparison or UI validation. No user process was targeted. Existing dirty work preserved. No frontend or root documentation edited, no commit. Branch has no upstream. GitNexus runner absent: graph impact UNKNOWN, contract/source fallback used. Full approved Plan 44975195edc0453a89d2bbbc8a70e90b3e02b61b4ed2650a49333361fd058b72 subsequently read from the exact approval path supplied by parent; it confirms temporary request-local Arc use and the documented remaining acceptance test gaps.
