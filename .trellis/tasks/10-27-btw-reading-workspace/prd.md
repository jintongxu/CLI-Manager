# BTW reading workspace

## Approved outcome
Replace the cramped thread modal with a desktop reading workspace: fixed compact header and composer, independently scrolling conversation, right-hand outline of asked **questions**, not Markdown headings. Collapse the outline behind a localized toggle on narrow screens. Keep source/settings and quote secondary and collapsed by default.

## Contracts
- Reuse shared `MarkdownContent` for completed and streaming/failed partial assistant output; retain its safe external URL allowlist and disabled raw HTML. User questions remain plain text.
- Outline retains repeated questions, numbers each user turn, provides snippets, highlights the current question and jumps/focuses only inside the owning transcript scroller; never use ancestor-scrolling `scrollIntoView` for outline jumps.
- Preserve send/stop/retry, context/source identity, draft, copy, close and reset/mode confirmation handlers. No backend changes.
- Explicit scoped CSS owns shell geometry instead of relying on shared Dialog utility ordering. Keyboard focus must remain visible; English and Chinese labels required.

## Impact and verification
GitNexus entry `.gitnexus/run.cjs` absent; exact fallback inspected `TerminalTabsView` → `BtwThreadDialog`, `BtwThreadModel`, shared `Dialog`, global surface styles, shared Markdown rendering/link policy, and existing bilingual panel tests. Historical Pi integration knowledge is not authority to change the current isolated request lifecycle.

Executed: 31 focused tests across `btwQuestionNavigation`, `terminalBtwPanel`, `terminalBtwThreads`, `terminalBtwCommand`, `terminalBtwSource`, and `markdownRendering`; `npx tsc --noEmit`. Navigation tests execute real helpers with bordered/already-scrolled geometry, repeated jumps, focus, active tracking, missing targets and a separate portal fixture. Panel render tests mock the shared renderer and assert both final/streaming delegation and bilingual outlines. No visual acceptance claimed; desktop/narrow theme checks remain for final validation. Root owns user-facing documentation.
