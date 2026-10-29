# Final native integration review

## Verdict: partial integration delivered; Windows acceptance remains BLOCKED

Recovered existing work, not restarted. Read `native-final-check.txt` (successful cargo check) and `native-final-tests.txt` (4 passing tests); checked visible cargo/rustc process list (none). Preserved other dirty changes, no commits, no app launch, no credentials read, no user process termination, no Todo/status changes. Knowledge search `maestro knowhow search 'exit ownership'` returned no hits using BM25 fallback; coding spec loaded. `.gitnexus/run.cjs` unavailable, bounded direct source/contract review substituted, graph risk not claimed resolved. Report schema files unavailable; inline schema applies.

## Confirmed integration fixed in this continuation

1. Guard activation was actually missing: frontend listens for `app-exit-requested`, but never called the old opt-in setter. Removed the disableable guard flag/setter. Native ExitRequested now prevents all **uncommitted** exits and emits confirmation; committed native ready transactions pass. This is not an unconditional exit lockout: tested ready -> commit succeeds. Early requests before frontend listener readiness fail closed; user may retry after initialization. Legacy `app_exit` only emits a request and cannot call `app.exit` itself. Critical synchronous fallback cleanup removed from RunEvent::Exit (only graceful marker remains).
2. Owner receipt transaction ID was not validated before caching/acceptance. Client now rejects mismatch before cache/wait/owner release; native mapper independently rejects mismatched receipt.
3. Strengthened controlled ready coverage: actual idle cc-connect/live/web-server/side-question cleanup, real PTY server owner registration/prepare/admission rejection/shared release, real web-device server owner registration/prepare/admission rejection/shared release, production owner mapper and parallel stop orchestration feed coordinator -> ready -> commit. No user daemon discovery or process exit. This is meaningfully beyond the earlier constant owner/web success mock, but is **not** full Native/AppHandle transport E2E. Fixture uses shared/idle domains, not a live whole-GUI resource mix.

## Consolidated critical-chain findings

### Connected / supported by source and tests
- Prepare calls PTY prepare_owner_exit + web-device prepare_exit + all four helper gates before metadata phase. Remote owner create/mutation gates reject prepared owner; web prepare/resume preserves runtime. Main native IPC fence keeps storage plugin calls available.
- Frontend App native/tray/window entry points share confirmation and transaction. Minimize/cancel do not stop. Commit requires matching native transaction/generation, metadata saved, no worker, ready. JavaScript receipt is not authorization.
- Metadata barrier drains prior writes, suppresses exit callback autosaves; explicit session snapshot Store.save awaited. Metadata failure aborts before cleanup. Actual store tests verify restore data survives late close writes.
- Cleanup workers remain retained across timeout; same-ID retry cannot spawn while worker runs. Partial cleanup cannot resume and silently reopen gates. Resource failure/missing proof/unknown status cannot become ready. Native commit is single use; stale commit fails.
- Shared owner release preserves other owners. Last PTY daemon OS-exit proof exercised by existing controlled executable fixture in owner suite. Legacy/unknown ownership fails closed, no automatic kill-to-upgrade.
- Unix process identity/tree proof is unsupported in current code. This review targets Windows only; no Unix readiness claim.

### Remaining concrete blockers / acceptance limits

**B1: PTY bridge absence/recovery remains unimplemented.** `Native::new` captures `DaemonBridge::get`; None unconditionally blocks prepare and cleanup with daemon_owner_connection_unavailable. Bridge evicts disconnected/released clients without durable never-created/last-owned state. Startup connects asynchronously before publishing bridge; it may have registered owner/reconciled routing before publication. Therefore simply treating None as absent would create false-ready. Need bridge lifecycle/admission state synchronized with initial connect and reconnect, retaining uncertain ownership, before safe never-created absence can be accepted. Current implementation deliberately blocks instead of guessing. Ready is demonstrated for controlled registered shared owners, not all production startup/failure paths.

**B2: Post-cleanup resume cannot work for last-owner daemon termination.** `Native::resume` always invokes `DaemonClient::resume_owner_exit`; after verified last daemon shutdown that socket/process is gone. It will reject instead of releasing local gates. This is safe but leaves the visible Resume action nonfunctional in that case. Must distinguish pre-stop abort, shared live-owner reopening, and completed released/stopped owner needing a new registration, without abandoning unresolved resources.

**B3: Shared PTY resume identity/cache inconsistency.** `owner_exit_until` removes `client_owner` binding cache immediately after owner release. `resume_owner_exit` can reopen the old owner and clear owner_released but does not repopulate that cache. A subsequent connection can register a new owner while resumed old-owner resources remain. Needs retained/restored cache identity coordinated with successful resume, and actual reconnect test. Do not advertise complete resume lifecycle.

**B4: Partial prepare abort can strand gates.** Prepare executes every fence and records first error. Resume attempts both remote reopen operations, but returns on owner/web error before reopening local helper gates. Example legacy daemon has no owner: prepare fails unsupported, abort sends owner operation and also fails unsupported even when no owner fence was acquired. Need per-domain prepare acquisition/uncertainty bookkeeping so known-not-acquired domains don't veto non-destructive abort; uncertain acquired fences must remain fail-closed. No user kill workaround.

**B5: Full production adapter transport acceptance not proven.** New test exercises production server adapters and local helpers through shared orchestration, but not `Native::prepare/stop/resume` with real DaemonClient socket and web native lifecycle together. Prior handoff's mock orchestration was insufficient; new coverage narrows, not eliminates, this gap. A controlled fixture using actual client adapters plus absent/disconnected/shared/final-stop/resume states is still needed. No launched App/manual restart/UI validation under this task's boundary.

**B6: Bounded completion remains fail-closed, not hard 15-second cancellation.** Coordinator can report worker timeout and preserve authority; scoped stop joins retain worker until domains settle. No assertion that all underlying synchronous locks/I/O are cancelled at deadline.

## Verification actually observed

- Original logs reused: native-final check succeeded; native-final coordinator 4/4.
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`: PASS after guard/mapper changes (`output/final-integration-check.txt`); final test-only helper relocation compiled in tests afterward.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib exit_coordinator -- --test-threads=1`: PASS 6/6 (`output/final-integration-tests.txt`). Includes real server/helper controlled ready path and native/frontend source guard assertion.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib preparation_tests -- --test-threads=1`: PASS 3/3 (`output/final-integration-prepare-tests.txt`).
- Broad `cargo test ... --lib owner -- --test-threads=1`: FAIL overall, 16 passed / 1 failed. Exit-related tests passed including actual Windows PTY/SSH process fixtures and final daemon OS wait. Unrelated `commands::git_worktree::finish::cleanup_plan::tests::artifact_v1_intent_without_ownership_never_upgrades` failed (expected Err, got Ok); preserved without out-of-scope edits. See `output/final-integration-owner-tests.txt`.
- `node --test src/app/exitTransaction.test.mjs scripts/terminalRestorableExit.test.mjs scripts/exitPolicyPreferences.test.mjs scripts/terminalSnapshotCapture.test.mjs scripts/terminalRemountSnapshot.test.mjs`: PASS 45/45 (`output/final-integration-frontend-tests.txt`).
- `npx tsc --noEmit`: PASS (`output/final-integration-tsc.txt`, empty successful output).
- `npm run check:architecture -- --strict`: PASS, 1456 files, zero violations (`output/final-integration-architecture.txt`). Initial test helper exceeded server file line budget; moved to existing ownership_tests module and reran successfully.
- Scoped `git diff --check`: PASS.
- Initial fixture compile had two unresolved protocol references; corrected qualification; subsequent compile/tests pass. No repeated failing production redesign cycles.

## Handoff

Do not mark complete. Root should resolve B1-B4 with controlled real-client lifecycle tests (B5), preserving fail-closed legacy/unknown behavior; then rerun final Windows acceptance. Current guard closes the old unprotected exit bypass but intentionally surfaces backend lifecycle failures rather than silently exiting. Root owns status/docs/changelog updates outside this requested review file.
