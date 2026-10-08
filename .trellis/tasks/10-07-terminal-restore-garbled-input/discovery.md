# Discovery / fallback impact

Branch wt/task-1007-1111 has no upstream. Unrelated pre-existing tab/Worktree dirty files preserved. No synchronization authorized.
GitNexus runner/index unavailable; graph impact UNKNOWN. Contracts read: fix-triage-guide, workspace-session-restore, terminal-output-scheduling, pty-daemon. Bounded symbol fallback confirms:
- terminalQueryPolicy -> controller install/direct ConPTY DA1, display queued/explicit replay, manager creation identity.
- useTerminalDisplay -> subscription decoder/color filter, scheduler, parser callback/ACK; generation/completion deferred Todo17.
- useXTermController -> direct serialized snapshot write, adapter lifetime, same/new process distinction; source size/capture deferred Todo17.
- useTerminalInput -> public onData/onBinary forwarding; preserve unchanged.
- sessionSnapshotPersistence/store/types -> ANSI trimming and source size deferred Todo17.
- PtyHostSocket/manager -> streamed end marker and consumer generations deferred Todo17.
- Rust replay/raw reader/OSC10/11 -> confirmed ownership preserved, no production Rust edits.

Reporting emissions vs encoding corruption are distinct. Ordinary byte path uses streaming decoding and raw byte preservation; abnormal oversized/incomplete input remains unproven without sample.
