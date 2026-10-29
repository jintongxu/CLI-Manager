# TEMP Windows exit cleanup — implementation delivered, runtime acceptance pending

## Current code
Native/App exit uses prepare → pause/drain metadata persistence → save → cleanup/status → ready-only commit. Tray minimize is not exit. Legacy background normalizes to ask. PTY/Web owner admission, shared release and last-owner process-signaled checks are integrated; helper stops retain failures. No global process-name kill.

Historical rollback-note/backend-handoff describe earlier abandoned attempts, not current implementation. Current evidence is owner/runtime/helper/web/native/app handoffs plus final corrections below.

## Consolidated review and one correction batch
Review agent://02f1239d-b87b-46ac-b777-bbe35458e0d3 identified four lifecycle blockers. Correction agent://f76c30eb-f757-4203-b52e-e3740d783c32 fixed all four: never-created vs disconnected ownership, dead-daemon resume, shared binding cache after resume, and unacquired/uncertain preparation fences. It exercised actual DaemonClient socket/subprocess fixtures, not just UI string matching.

Passed latest affected evidence:
- Rust cargo check --lib.
- owner_client_ 3; daemon bridge lifecycle 2; exit_coordinator 7; preparation_tests 3; specific daemon server ownership 7.
- Earlier unchanged UI transaction/restore/policy/snapshot batch 45; TypeScript no diagnostics.
- Earlier unchanged helper suites: controlled child tests, cc-connect, live/web server and web-device ownership; detailed counts in individual handoffs, no aggregate inflated count.
- Strict architecture 1458 files zero violations; final normal architecture and git diff --check pass.
- Broad `owner` filter previously also selected unrelated worktree artifact test which failed; final focused exit suites pass. No all-repository pass claim.

## Explicit residual acceptance / limitations
- Windows verified only; Unix strict process identity/tree proof remains unsupported. Do not describe cross-platform acceptance as complete.
- No full GUI/Native AppHandle + actual PTY/Web daemon single end-to-end run; production adapter coordination and real transport tested separately.
- No user process terminated and no app launched for shutdown testing. Real memory reduction, dual installed/dev instances, tray and language switching must be manually verified on test instances.
- Deadlines preserve retained worker authority, not hard cancellation of every underlying synchronous operation. Unknown/timeout stays blocked, not success.
- Old incompatible daemon requires explicit upgrade/restart handling; no ownership-blind kill. Unknown/disconnected owners are not treated as absent. No sweeping historical orphan processes.
- External developer npm/Vite parents, detached unmanaged jobs and independent remote services are not auto-kill targets.

## Records
CHANGELOG.md and docs/功能清单.md TEMP updated, preserving prior dirty work. No git commit, branch sync, credential reads or user-process cleanup performed. Task remains review for manual acceptance, not falsely complete for all platforms.

## Knowledge
Zero separate new knowledge entries staged: exact-owner/no-name-kill rule already exists; protocol-specific lifecycle lessons are preserved in task design/review and are not duplicated as general knowledge.
