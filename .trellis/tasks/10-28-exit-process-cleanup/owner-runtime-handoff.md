# Runtime owner continuation — Todo12 remains incomplete

This supersedes owner-exit-handoff's blanket retained_shared description. No app_exit coordinator, frontend, theme, changelog or feature-list changes in this continuation. No commit. Branch wt/task-1027-2130-3c711d70c03c has no upstream.

## Implemented and exercised on Windows

- New runtime_owner_exit_v1 feature (not owned_exit_v1). AuthOk carries optional OS process creation time. Native opens a wait-only process handle and checks discovery PID + handshake PID + OS creation time; no termination rights. Missing identity is unsupported before native OwnerExit. Spawn keeps Child on the connected client and requires discovered PID to equal the spawned child.
- OwnerExit now stops final-owner routing explicitly with retained bounded worker joins, releases owner SSH/session references, and fences all registration/creation/runtime requests during final drain. Other registered owners and tracked legacy runtime/session/client references retain the daemon. Unknown running routing yields unsupported, never retained_shared; failed cleanup remains pending.
- Routing acquire/release uses existing native/WS binding; SSH consumers are owner-namespaced while preserving history/files/git prefixes. SSH launch is suspended on Windows, assigned a Job before NtResumeProcess, and retains jobs and worker handles for strict release/join retry. Ordinary close paths remain.
- Root server observes drain, closes native/WS listeners, explicitly stops/joins hook listener, then returns to the existing daemon entrypoint. Routing and bridges are stopped before this transition, not by process::exit Drop. Native changes stopping to stopped only after WaitForSingleObject signals.
- Native caches successful/partial OwnerExit receipts. SAME transaction retries stopped/stopping release without depending on a now-dead socket; bounded process-wait timeout preserves cached stopping and handle. Pending RPC outcomes retry the same transaction. Different transaction rejected. On verified stopped or retained_shared release, cache binding is removed and DaemonBridge excludes the released client; fresh connection gets a fresh owner capability. Old client remains the retry/tombstone authority.
- Removed ownership-blind native version-upgrade shutdown and live-PID handshake-failure discovery replacement.

## Exact limitations / remaining work (do not call Todo12 finished)

- Unix strict PTY tree close remains pty_tree_proof_unsupported. Native daemon identity and strict SSH proof are explicitly unsupported on Unix. Unix was not built/tested.
- Runtime control currently holds the ownership mutex across SSH requests (which can wait for remote history up to 180s). OwnerExit try_lock returns owner_state_busy_retry rather than starting cleanup, but this is not the desired inflight reservation design. Several existing bridge termination paths still use kill/wait and ignore errors before joining; strict release checks retained Job emptiness, worker completion and empty root slot, but not every legacy failure path is redesigned.
- Hook listener join and ordinary runtime/SSH operations are not fully deadline bounded. Native process wait is bounded; a stuck hook worker will yield timeout, not stopped. Hook approval/notification background worker lifecycle is still existing behavior at root process exit.
- No auto-reclamation of dead owner registration. No full GUI process identity registration, web-daemon owner protocol, app helpers, metadata transaction or app_exit coordinator. Existing SSH identity replacement policy and legacy implicit bridge reuse need concurrency review before full backend acceptance.
- No live-user SSH/credentials or user processes were used. Active SSH job test uses a local test-owned cmd loop, not a remote bridge handshake fixture. Native OS wait proof tested directly plus full production daemon run in a child test harness; no Tauri GUI integration test.

## Evidence

- Final cargo test --manifest-path src-tauri/Cargo.toml --lib daemon:: -- --test-threads=1: 154 pass (output/owner-runtime-daemon-tests.txt).
- Targeted owner_: 9 pass: actual child daemon last-owner routing stop and OS signal; shared runtime preservation; unknown/legacy classification; registration fence; cache release/new binding; PID creation mismatch; active test-owned SSH Job stop; previous native/WS/session/race coverage. output/owner-runtime-tests.txt.
- cargo check: pass, existing/dead-code warnings. output/owner-runtime-check.txt (before final capability-only edit, final test compilation includes it).
- npm run check:architecture and --strict: pass, 1440 files, zero violations. Scoped git diff --check passed.
- Initial subprocess integration exposed Windows accepted-socket inherited nonblocking mode; fixed by making accepted native/WS/hook sockets blocking. Initial failed fixture retained executable and caused LNK1104; only that exact test fixture was terminated after verifying PID 4020, executable path, start time 20261029003758 and command line. Re-run passed. This was resolved, not an unavoidable platform blocker.
- Knowledge search (BM25 fallback) found instance-specific no-image-kill guidance; coding spec loaded. Maestro graph uninitialized, .gitnexus/run.cjs absent: bounded source/contract/caller fallback used. Report schema files absent; inline schema used. Existing dirty prior-owner/backend and unrelated frontend changes preserved.
