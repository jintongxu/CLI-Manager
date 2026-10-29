# Native coordinator handoff — integration implemented, activation withheld

Branch `wt/task-1027-2130-3c711d70c03c` has no upstream. No git synchronization or commit. Knowledge search found instance-specific process cleanup guidance; coding spec loaded. GitNexus `.gitnexus/run.cjs` missing; bounded contract/caller inspection used, risk unresolved rather than declared low.

## API for Todo13
All commands require window label `main`. Tauri parameter keys are camelCase. Native generates transaction IDs and generation. Never send receipt/canExit back as authorization.

```ts
export type ExitPhase = 'preparing' | 'prepared' | 'stopping' | 'blocked' | 'ready' | 'committed';
export type ExitStatus = 'stopped' | 'absent' | 'released_shared' | 'retained_shared' | 'pending' | 'failed' | 'timeout' | 'unsupported';
export interface ExitResource {
  kind: string; resourceId: string;
  ownership: 'exclusive' | 'shared' | 'unknown';
  status: ExitStatus; evidence: string | null;
  errorCode: string | null; retryable: boolean;
}
export interface ExitReceipt {
  protocolVersion: 1; transactionId: string; instanceId: string; generation: number;
  phase: ExitPhase; canExit: boolean; metadataSaved: boolean; workerRunning: boolean;
  resources: ExitResource[];
  daemon: { epoch: string | null; status: ExitStatus };
  errors: { resourceId: string; code: string }[];
}
export interface ExitCommands {
  app_exit_prepare: { args: { source: 'window' | 'tray' | 'menu' | 'native' | 'quit' }; result: ExitReceipt };
  app_exit_cleanup: { args: { transactionId: string; metadataSaved: boolean }; result: ExitReceipt };
  app_exit_status: { args: { transactionId: string }; result: ExitReceipt };
  app_exit_abort: { args: { transactionId: string }; result: null };
  app_exit_resume: { args: { transactionId: string }; result: null };
  app_exit_commit: { args: { transactionId: string }; result: null };
}
```

Flow: confirmation (minimize/cancel returns before prepare) → await prepare and require prepared → snapshot/await metadata saves → cleanup(metadataSaved:true) → poll status until workerRunning=false → require ready+canExit → app_exit_commit(transactionId). Cleanup returns immediately with stopping. Duplicate requests share the same worker and native receipt. Retry blocked only after workerRunning=false, with the SAME transaction ID. A worker exceeding 15 seconds is reported blocked/exit_worker_timeout_retained while workerRunning stays true; retry/resume cannot start another worker. Late completion updates this transaction only and never exits the app. Metadata save failure: abort before cleanup; no stop call has occurred.

`app_exit_commit` is the safe new command. Existing `app_exit` and OS exit behavior remain temporarily compatible. NO unconditional prevent_exit was added. ExitRequested no longer calls side-question shutdown. Exit fallback cleanup remains for compatibility and must be removed/made nonblocking in atomic frontend/guard activation. Do not advertise protected application exit yet.

## Actual integration
- Four local helper prepare/stop/resume APIs called; real web-device shutdown_until and real PTY DaemonClient::owner_exit called. All blocking work off GUI thread.
- Independent cleanup domains run concurrently; shared daemon accepted only when owner release successful. PTY stopped relies on native owner's verified OS handle wait, not ACK/EOF. Captured Arc survives bridge eviction for retries.
- Local helper errors retained as per-resource failures. No credential/config reads or deletes. No Node/Vite parent kill. No filesystem/process enumeration.
- Main IPC creation/control families fenced during transaction; plugin storage IPC stays available for metadata. Native helper admission gates cover already-dispatched local work.
- Generation advances on abort/resume; stale commit rejected; commit is single-use.

## Explicit blockers: not a COMPLETE Todo12 yet
1. PTY owner API currently exposes destructive OwnerExit only: no non-destructive prepare/abort/resume. Existing direct WebSocket creation is therefore not fenced during metadata save (it is fenced by OwnerExit before drain). Main IPC/helper fences cannot substitute for this daemon admission API. Root was asked once for the missing contract.
2. Web-device handoff exposes shutdown_until but no prepare/resume. Native adapter cannot invent those APIs. Post-stop resume deliberately returns `exit_owner_resume_unsupported`, retaining transaction and same-ID retry authority rather than clearing it and stranding partially drained owners. Pre-stop abort is implemented. Do not present resume as functional until owner APIs land.
3. Missing/disconnected PTY bridge is conservatively blocked (`daemon_owner_connection_unavailable`), not assumed absent; adapter needs trustworthy never-created tracking/reconnection for a ready no-daemon case.
4. 15s deadline is passed to local/web helpers, but PTY API has its own 10s RPC+5s wait and web handoff notes unbounded peer/lock conditions. Coordinator reports retained-worker timeout without claiming worker cancellation. No hard total-duration guarantee.
5. Tests cover state machine fixtures, not a full real Tauri+all-daemon end-to-end ready flow. Production ready path is wired, but activation withheld pending end-to-end evidence and frontend compile integration. Unix strict proof remains unsupported; Windows is product target.
6. Generic Resource mapper assumes backend success evidence strings are authoritative. PTY session job_empty is Windows proof; no Unix full-tree claim.

## Discovery/scenarios
Root cause boundary: old app_exit trusted JS intent and ExitRequested prematurely shut down side questions; coordinator must own metadata ordering, lifecycle admission, process proofs, and commit authority. Touchpoints inspected: lib command registration/run events; daemon bridge/client owner RPC and process proof; helper prepare/stop/resume; web shutdown; side-question private process module; direct WS admission (gap); frontend persistence (outside scope, intentionally untouched). Main vs child window, abort/minimize, multi/shared owner, duplicate/retry, timeout/late completion, generation, metadata failure covered by API or fixtures. Focus/split/worktree presentation is unrelated because native transaction drains whole owner. Windows tree evidence delegated to tested ownership APIs; Unix unsupported explicitly.

## Verification
- cargo check --manifest-path src-tauri/Cargo.toml --lib: passed before final small worker-status/concurrency changes; final test compilation covers these changes.
- cargo test --manifest-path src-tauri/Cargo.toml --lib exit_coordinator -- --test-threads=1: 3 passed; fixtures exercise metadata failure/abort, generation, ready/shared, duplicate, commit, failure/retry, running-worker resume rejection.
- npm run check:architecture -- --strict: passed (1449 source files, zero violations).
- Scoped git diff --check: passed.
- No user process/app exit tests. No frontend modifications. Report schema files absent, inline schema used.

Parent must record TEMP changelog + feature list integration notes (those dirty files are outside this task's explicit ownership).
