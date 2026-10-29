# Safe rollback supersedes the implementation below

Todo12 is BLOCKED / incomplete; Todo13 remains blocked. All exit-feature backend implementation described below has been rolled back to HEAD 7681748a (full SHA in rollback-manifest.json). The old text is historical evidence, NOT current API documentation. app_exit no longer requires a transaction; no exit coordinator or owner protocol remains registered. See rollback-note.md for exact scope, checks, and remaining gaps. No process-leak fix is claimed.

---

# Todo12 continuation — NOT acceptance-complete

Plan: `bcaf76ae3633e47245f54c6f473e205b05fb2d71790b729d59824f09a4e24862`.

## Critical delivery status

This continuation adds working safety pieces but **does not finish Todo12**. No environmental or unavoidable blocker was established. The missing work is implementation, not a permission issue. Todo13 must remain blocked. Do not mistake passing targeted tests for backend-contract acceptance.

**Current behavior change:** native `app_exit` and `ExitRequested` fail closed. Since cleanup currently produces unsupported ownership receipts, ordinary application exit cannot yet reach ready. This is an intermediate worktree, not a shippable release. The incomplete coordinator must be finished before delivery; do not bypass the guard to claim success.

## Implemented in this continuation

- `pty/manager.rs`: removes raw-PID taskkill close paths; consumes platform tree proof; active -> retained closing slots; one retained controller-release worker, reader and process-watcher joins checked by deadline; retry reuses handles. Creation rejects IDs still closing. Worker panic remains sticky failure. Shared 7-second close-all budget. Windows root signal + Job-empty proof comes from previous adapter foundation. Unix proof remains unsupported (including normal close currently), requiring platform implementation before cross-platform delivery.
- `daemon/server/ownership.rs`: bounded instance/token/epoch registry; same-owner reconnect; disconnect does not erase owner; session creation admission/inflight accounting; foreign and unknown session mutation rejection for bound owners; native text and binary input owner checks. Credentials are random in-memory UUIDs. **OS process identity verification is not implemented.**
- `daemon/protocol.rs` + `server/owned_exit.rs`: additive RegisterOwner/BindOwner/OwnerExit frames, real per-PTY close attempts. OwnerExit explicitly returns unsupported because shared helpers/daemon proof are incomplete. `owned_exit_v1` is deliberately NOT advertised. Native client does not yet negotiate/register/bind these operations. Existing unbound clients remain legacy.
- Legacy daemon CloseAll/Shutdown now reject global operations. Native discovery no longer shuts an old daemon down based on idle-list inference, and a live recorded daemon handshake failure no longer deletes discovery/spawns a replacement. Web-device upgrade and shutdown no longer issue ownership-blind daemon Shutdown.
- `features/terminal/exit_coordinator.rs` and `lib.rs`: native single-flight prepare/status/abort/resume state; generation invalidation; missing/forged/unready transaction denied at app_exit; ExitRequested prevented without internal permit; emits `app-exit-requested`; removed premature side-question shutdown from ExitRequested. No main-thread wait added. Cleanup currently stops nothing and returns explicit unsupported receipts. IPC denylist is only a preliminary fence, NOT complete creation/inflight admission.
- cc-connect service and Weixin cancellation retain child slots on kill/query/timeout errors and poll bounded root/Job completion rather than take+ignore+infinite wait. Existing post-spawn Job assignment still cannot prove no escaped descendants. Log readers and startup-failure handling remain incomplete.
- Live-server adds deadline stop that retains unfinished tasks; not yet wired into coordinator and not full watcher join proof.

## Exact current command shapes (NOT a usable successful exit API)

- `app_exit_prepare({ source: string }) -> ExitReceipt` (full receipt with phase prepared, not just two fields).
- `app_exit_abort({ transactionId: string }) -> void` (prepared only).
- `app_exit_cleanup({ transactionId: string, metadataSaved: boolean }) -> ExitReceipt` (false rejects; true currently always blocked/unsupported, canExit=false; no process stop).
- `app_exit_status({ transactionId: string }) -> ExitReceipt`.
- `app_exit_resume({ transactionId: string }) -> void` (invalidates generation/receipt).
- `app_exit({ transactionId?: string }) -> void/error` (native ready state required; none can currently become ready).
- Event: `app-exit-requested` with null payload.
- Receipt is camelCase as design.md; unsupported resource IDs `pty-daemon`, `web-daemon`, `app-helpers`, error `exit_ownership_integration_incomplete`.

Do not unblock frontend implementation as if success paths exist. No frontend file was edited.

## Remaining required integration, ordered

1. Finish actual OS process identity/handle and native registration/binding (same owner shared with WS endpoint), validate startup identity and retain daemon Child. Connect ownership-aware native client to coordinator. Daemon owner admission must cover routing/SSH, mutations and background sources, not just PTY create. Epoch is currently learned from RegisterOwner, not handshake identity.
2. Implement routing/SSH owner reference accounting, web-daemon equivalent owner protocol, shared release receipts, final-owner atomic drain/listener/helper shutdown and OS process signal wait. Current OwnerExit remains intentionally unsupported; no daemon force permission exists. Session SSH bridge references currently are not released by new OwnerExit.
3. Finish global native admission/inflight guard across all actual helper entrypoints and automatic startup paths; replace cleanup placeholder with bounded single-flight worker and retained per-resource receipts. Side-question tree/reap, cc-connect suspended admission + reader joins, live watcher completion, web-device local helpers and proxy shutdown remain required. Existing web_server retained timeout worker can be reused.
4. PTY graceful phase, Unix identity-safe group completion, suspended spawn-failure retention, concurrent-create/close tests, and platform closure lifecycle proof still required. Current Unix close is fail-closed unsupported, not complete functionality.
5. Coordinator metadata ordering, retry worker coalescing and true ready commit; shared-daemon fixture tests and all ownership acceptance scenarios. Only then unblock Todo13 and describe successful commands.

## Verification actually run after continuation

All following final runs passed:
- `cargo test --manifest-path src-tauri/Cargo.toml --lib owned_exit`: 2 tests (registry rebind/foreign/fence/token and legacy shutdown rejection with fixture routing).
- `cargo test --manifest-path src-tauri/Cargo.toml --lib owned_process`: 5 tests (previous four plus closing reader timeout/retry). Test-owned fixture trees only.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib exit_coordinator`: 1 state-machine test (single flight, forged/unready/stale denial, abort/resume).
- `cargo test --manifest-path src-tauri/Cargo.toml --lib oneshot_conpty`: 1 real PTY test.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib cc_connect`: 90 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib live_server`: 13 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib web_device`: 20 tests.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed, existing/dead-code warnings.
- `npm run check:architecture` and `npm run check:architecture -- --strict`: 1435 files, zero violations.
- `git diff --check`: passed (line-ending warnings only).

Evidence logs: `output/exit-{owned,process,coordinator,conpty,cc,live,web}-tests.txt`, `output/exit-backend-check.txt`, `output/exit-architecture*.txt`.
Earlier checkpoint web-server timeout retry test remains reused; web_server.rs unchanged. No full GUI exit, live-user process test or shared-daemon OS completion test was run.

## Scope / knowledge

Read full design/prd/implement and previous checkpoint; Maestro knowledge search found no-image-kill rule; coding specs loaded. Graph unavailable as already established; manual contract/symbol fallback. All existing dirty frontend/theme/sidebar/CHANGELOG/root docs preserved. No commit, no user process termination, no image-name kill. Report schema paths absent; inline schema used.
