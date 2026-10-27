# BTW thread boundary contract

Approved plan handoff: eef2dc8fce038fae488e6faffcf9e93485231ac5aea64caa63fa45590ab09f1b.

## IPC (camelCase JSON)
- `side_question_context({request:{requestId:string, sourceSessionId:string}})` => `{available:boolean, text:string, truncated:boolean, reason:string|null}`. Resolve exact indexed Pi ID backend; never accept frontend paths or cwd fallback. SDK reads current branch; no transcript contents in logs. Unavailable returns explicit reason; new thread inherit defaults false. Source ID comes from exact terminal runtime agentIdentity/source pi or terminal.cliSessionId with cliTool pi. SSH/WSL/unbound not supported unless identity and local accessibility verified.
- `side_question_ask({request:{requestId:string, threadId:string, quote:string, context:string, messages:[{role:'user'|'assistant',content:string}]}})` => `string` final answer; messages include new user message last. Keep legacy `{prompt}` request compatibility if needed by existing tests/consumers; new UI must use structured messages.
- `side_question_cancel({requestId:string})` => void. Rust cancels only owned subprocess; unknown/already-finished id idempotent. Caller IDs are unique per operation (context or inference) and never reused. Cancellation before registration and completed IDs are fenced by bounded tombstones (4096 recent IDs, 5-minute TTL); only owned registrations can control a child, never frontend PIDs. Root ownership/race-safe register before execution; timeout enforced backend, kill and reap.
- Tauri event `side-question-progress`: `{requestId,threadId,text}`; `text` is complete cumulative answer-so-far, not append delta. Subscribe before ask. Every event/result checked against current thread generation/request ID. Frontend listener disposed on unmount.

Backend owns subprocess lifecycle; one shot per inference, no terminal/PT Y creation. Pi session restored from explicit structured successful turns, separate context text, quote and safe system instructions. All tools/extensions disabled. Preserve output flush before process exit. Context snapshot is immutable once acquired; no automatic refresh while main thread progresses. Inheritance toggle/restart confirms thread reset; stale async context response rejected. Context registers before the history-index await, with the caller-known requestId; reset/delete/clear/unmount cancel contextRequestId as well as inference requestId. Snapshot failure retains inherit=true, failed status/error and the unsent draft; it never submits context-free. Retry re-acquires context then sends the question exactly once; explicit confirmed reset(inherit=false) is required to continue without inheritance.

## Frontend
Thread: unique id, source terminalId / Pi sessionId, original quote, initial title, inherit bool, context snapshot/truncated flag, own ordered turns, current request id and generation, own draft/status/error. History isolated per card. No persistence. New quote stages new question but must not clear cards. Panel has compact card previews and open/retry/copy/delete. Large in-app shared Dialog with followups, stop/retry/copy/restart, inherit mode with reset confirmation. Close dialog preserves thread. Delete/clear/restart/unmount cancel requests, late results ignored. Retry failed/interrupted turn does not duplicate user turn. New cards don't auto-open. Bilingual labels and unavailable/truncation explanations required.

Integration: frontend lane owns src/features/terminal/** TS/UI/tests/locales except scripts/piSideQuestionAgent*. Backend lane owns Rust and scripts/piSideQuestionAgent*. Both may create cohesive <=2000 line modules. Root owns task/docs and review integration.

## Discovery / scenarios
- Terminal cliSessionId and runtime agentIdentity bind exact Pi identity from hook; history summary source/session_id/file_path identifies transcript. File path not directly from terminal; no same-cwd guesses.
- Source switches/split/blur/hidden panels don't change saved thread source.
- Missing hooks/file, no-session, remote/inaccessible path => explicit unavailable, noninherit remains usable.
- Two cards concurrent, cancel/delete/restart/clear/unmount, failed retry, late events, changing context pending, long snapshots, zh/en must be tested.
- Actual installed pi-btw uses bounded 40k user/assistant branch text snapshots, retained side threads, no tool execution. Do not claim full effective context inheritance.

## Verification
Focused state-machine tests and structured sidecar mock tests; backend narrowed Rust tests; tsc; strict architecture independently. Root integration review. No production process actions or Git synchronization. Manual UI limitations reported honestly.
