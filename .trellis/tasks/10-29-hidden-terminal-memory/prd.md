# Hidden terminal memory (TEMP)

Scope: lowMemoryMode hidden terminal renderer reclamation only; preserve existing default, live PTY/Pi identity, hidden parser, ACK and daemon checkpoint/replay ownership. No process sleep/killing, silence heuristic, exit lifecycle change or app launch.

Discovery: hiddenTerminalDisplayLifecycle (60s) is unused in production. XTermTerminal explicitly retains the parser because TerminalProcessManager.subscribeOutput cleanup leaves its socket subscription and frames queue alive; enqueueOutputFrame appends without a bounded detached spool. Removing xterm would accumulate output and remove the sole live protocol responder. Safe parsed-boundary snapshot capture exists but does not solve this detached-consumer boundary. Therefore this batch takes the explicitly allowed safer renderer-only fallback, not full scrollback/addon disposal.

Acceptance: wire the existing 60s helper into WebGL resource release under lowMemoryMode; keep authoritative xterm/parser mounted and processing ordered output; visible or setting-off recreates the renderer as applicable; cancelled timers and unmount cannot dispose a newer renderer. No extra output snapshots/copies. Existing visibility from PaneLeafView covers current-work, Workspan, pane selection and history. Hook/process/environment identity is irrelevant to this display-only policy; minimize is not treated as process inactivity. Preserve Linux constrained-renderer fallback timing. Correct zh/en description to match actual capability.

Verification: fake-clock callback tests of production hook, continued output/ACK and restore identity; existing continuation/replay/snapshot tests; tsc and architecture. No manual app launch permitted. Root owns CHANGELOG/feature docs. Full display release and optional Pi sleep remain deferred pending bounded authoritative detached-output/runtime-quiescence evidence.

Branch: wt/task-1027-2130-3c711d70c03c, no upstream. Large pre-existing dirty work preserved. Knowledge search returned no relevant hits; GitNexus CLI .gitnexus/run.cjs absent, impact unresolved, fallback workspace-session-restore/output-scheduling contracts and direct call-site tracing used.
