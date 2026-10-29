# Terminal resources — TEMP

Approved plan: 44975195edc0453a89d2bbbc8a70e90b3e02b61b4ed2650a49333361fd058b72. Created with --no-start. Read-only diagnostic; no process close/restart/upgrade, DB changes or Pi sleep. Parent owns CHANGELOG/features documentation.

## Frozen API contract (implementation required before frontend integration)
Native main-window command `terminal_resources_get_snapshot({sessionIds: string[]})` returns snapshot below. Feature `terminal_resources_v1`. NDJSON request `TerminalResources { id, session_ids }`, response `TerminalResources { id, snapshot }`. WS and legacy relay reject explicitly with `terminal_resources_native_only`. Existing native bridge only: missing/old daemon returns `terminal_resources_unsupported` without spawning/restarting it.

JSON DTO (camelCase):
```
Snapshot { sampledAt: number, daemonEpoch: string, revision: string, rows: Row[] }
Row { sessionId: string, status: 'complete'|'partial'|'unavailable',
 reasonCodes: Reason[], rootPid: number|null, rootCreatedFiletime: string|null,
 coverage: 'job_members', enumeratedCount: number, observedCount: number,
 workingSetSumBytes: number|null }
```
`sampledAt` is Unix milliseconds; revision and root FILETIME decimal strings avoid JS integer precision loss. Reason enum: `unsupported_platform`, `unsupported_remote`, `session_missing`, `not_pty`, `root_changed`, `member_unavailable`, `membership_changed`, `member_limit`, `enumeration_failed`, `budget_exhausted`, `identity_changed`, `observation_invalidated`. Empty observations always null, never fabricated zero. Complete requires successful member enumeration and validated samples of every member; partial carries only validated subtotal. Root invalidation discards all numeric memory. No env/cmdline/executable paths/token/raw OS errors. Counts are observed metadata, not process details.

Input bounded before dedup: 64 IDs, each nonempty <=256 UTF8 bytes. Dedup stable. Each session <=1024 Job members, <=3 enumeration attempts; total <=4096 candidate observations and 500ms cooperative deadline (not a hard bound on individual Windows calls). Reject invalid request with `terminal_resources_invalid_request`. Owner/transport failures are fixed errors, not permission-probing rows.

## Ownership and lifetime
Registered native client bound to same owner for every session required. Legacy, foreign, unbound, draining rejected before touching process state. Capture owner observation revision and runtime/session identity under admission lock; sample outside global lock; revalidate before return. Prepare/resume, bind/rebind, close/recreate and native client replacement invalidate in-flight observation, even if final owner appears unchanged. Native bridge generation checked before and after request. Job handle borrowed, never duplicated/cached. Bounded request-local child Arc references are allowed and dropped before final authorization revalidation. They may postpone last-handle Drop but must never block explicit child.kill/Job termination; no global lock during OS work. No duplicate/cache/transfer of owning Job handles or lifetime redesign is authorized.

Production Windows Job enumeration, aligned bounded buffer. Open each candidate with query/VM-read access, check FILETIME+alive+IsProcessInJob before and after GetProcessMemoryInfo on same handle; deduplicate PID/FILETIME. Validate root before/after; final membership enumeration detects churn. Never global sysinfo or PPID/root-only approximation. Sum working sets (shared pages may be double-counted), not unique RAM/private bytes. Do not total across terminals. SSH/WSL remote memory unavailable.

## UI handoff
Original session IDs including hidden, unique rows; 64-page local sorting only, unknown last, ID tie break. Existing system tab retained; stop its top-process polling while terminal tab active. 2500ms singleflight only when open+visible+active+document visible; stale success/error invalidated on lifecycle/page/session/owner/transport changes. Existing-terminal navigation only, no restore/create or current-work membership mutation. Bilingual copy/aria, 24-hour time.

## Scenarios and verification
Windows root+allocating child in production Job, unrelated control excluded; tests kill only their fixtures. Test bounds, null, denied members, churn, root exit/reuse, dedup, exact serialization allowlist; native owner isolation, prepare/resume/recreate and bridge replacement races, WS/relay rejection, old daemon no restart. Rust targeted --lib terminal_resources, owner-specific tests, cargo check; Node focused polling/navigation tests, tsc and normal/strict architecture. No app launch/user-process operations. Manual real Pi comparison and language/layout acceptance remain explicitly unperformed.

Scenario matrix includes focus/hidden/minimized/tray, split/deep split/workspan/current-work member/nonmember/deleted session, local shell versus SSH/WSL, project/worktree/missing directory, hooks present/absent. Sampling independent of display visibility and hooks; polling is visibility-gated.

## Baseline and discovery
Branch wt/task-1027-2130-3c711d70c03c has no upstream. No sync or commit attempted. Existing dirty exit/process/platform/owner/theme/sidebar changes must be preserved; inventory at output/terminal-resources-baseline.txt. Knowledge search found instance-specific process-cleanup safety guidance; no reusable sampling implementation. GitNexus .gitnexus/run.cjs absent; contract/source bounded fallback explicitly authorized by plan; graph impact UNKNOWN, not low. Read pty-daemon contract and actual ownership/ChildJob code. server.rs baseline 1994 lines: extract cohesive handler rather than exceed 2000. No report schema at .pi/agents/ or flow/agents/: inline report schema applies.
