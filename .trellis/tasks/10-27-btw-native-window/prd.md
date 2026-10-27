# BTW native window single-owner protocol

## Approved source

Immutable approval: `20261027T105336057Z-r0004-76336cdb-h458f09a1cfceaa58fc82841891590d7975210df6f2affa7915379ab8d8a59f4e.md`.
Knowledge gate: prior research `agent://e6a2a74b-5fa4-4c81-a04e-347cd81ea2e7`; coding specs and actual source contracts loaded. GitNexus runner absent; exact source/caller fallback used.

## Requirements

- One static hidden decorated `btw-thread` native window; early bootstrap isolates it from App/SQL/model initialization.
- Main BtwThreadModel is sole inference owner. Child reads selected-thread snapshots and emits draft/send/retry/stop/reset/close intentions only.
- Native sender identity is authoritative. Dedicated minimal capability, no SQL/filesystem/store/process permissions; custom application commands are denied for child except ready/intent.
- Native-generated owner epoch, monotonic revision, selection revision, thread generation and command dedup fence old/duplicate input.
- Listen before ready replay; preserve latest draft on send atomically. Serialize child commands; coalesce ordered main publications without dropping reopen reveals.
- OS close hides without deselecting or cancelling; reopen same card reveals latest stream. Explicit close unselects; deletion/clear/unmount invalidate reader.
- Actual native exit fences new jobs, cancels active jobs, and waits for kill/reap; tray hide never cancels.
- Keep Markdown, question outline, source details and composer, with inline reset confirmation instead of nested Dialog overlays.
- No persistence, production actions, provider calls, commits, global Pi changes or context/selection semantic changes.

## Verification

- Focused Node tests exercise real owner hook and child bootstrap with mocked native transport, plus protocol/model/reader bilingual regressions.
- Rust narrowed tests cover sender authorization, intent validation, mock subprocess lifecycle, and isolated actual-exit registry cleanup.
- TypeScript, Rust check, independent strict architecture gate.
- Root owns temporary-development manual native-window acceptance, changelog and 功能清单 integration.
