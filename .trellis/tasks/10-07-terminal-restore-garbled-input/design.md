# Approved combined design (TEMP)

Authority: approval r0006 / 3c28630be715f668f8adfd89866bef1106fc0ca571f078d95e29f07683c2223f. Six boundaries remain in scope; implementation is ordered, not narrowed.

Root cause: historical output is parsed as current output, and xterm's protocol emissions lose their source at public onData/onBinary. Actual installed 6.1.0-beta.288 emits ESC[O for ?1004h even with DSR filtering. Snapshot reconstruction additionally carries old reporting modes into new processes. Completion, generation, source geometry and destructive ANSI trimming are separate confirmed defects, not proven explanations for every reported character.

1. Pinned adapter wraps actual InputHandler.parse (including WriteBuffer async continuation), intercepts CoreService data/binary only during historical parsing, and carries FIFO origins. No wall-clock input gate, reply guessing, disableStdin, dependency or node_modules change. Exact checked structural interface fails explicitly on mismatch. ConPTY direct DA uses the same origin predicate.
2. All queued, explicit and static snapshot history uses the adapter. New process first unparsed startup replay keeps its existing once-per-sequence handshake exception. ANSI prefix from history cannot gain live response authority from a later suffix; use the installed parser transition table for source carry.
3. New-process static snapshot resets only focus and mouse input-reporting modes after historical reconstruction; same-process attach/remount preserves modes.
4. Next lane owns generation-safe claims/ACK and streamed replay-end callback completion, with current-container fit before pending marker release.
5. Next lane owns optional source size and restore-at-source-size-before-fit, with no live PTY resize at source dimensions.
6. Next lane owns bounded addon serialization, never substring trimming stateful ANSI, full daemon checkpoint and resize dirty capture.

No change to live input, Rust OSC ownership, OSC52 consent, CLI resume, identity, paths, existing unrelated work, wire protocol or user data. No terminal operations, restart, synchronization or commit. Graph unavailable (.gitnexus absent): impact UNKNOWN; bounded contract/symbol fallback is evidence, not low-risk graph clearance.
