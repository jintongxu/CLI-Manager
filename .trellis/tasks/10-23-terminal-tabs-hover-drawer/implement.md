# Implementation

## Delivered
- `terminalNavigationModel`: added same-source project grouping, independent group marker, and total count.
- `useTerminalDrawerIntent`: hover/pin/escape/disabled lifecycle with timer cleanup and focus restoration fallback.
- `TerminalTabRow`: direct real tabs, project accent, status/action slots, current-work removal, namespaced sortable IDs, smooth scroll/reveal.
- `TerminalNavigationDrawer`: project groups, local search, keyboard activation, explicit add/remove semantics, safe multi-select, order hint and current-work controls.
- `TerminalNavigationBar`/Adapter: removed visible range/quick/find/manage stack and mounted row + drawer; uses outer scope and member mode as the collection boundary.
- `useTerminalPaneAdapter`: restored workspan-enabled and visible-session-count guard for local pane tabs.
- Added bilingual drawer labels and TEMP documentation.

## Review corrections
- Ordinary view now exposes add-only membership action; it cannot remove membership or batch-remove members.
- Add-candidate rows do not show close/pin/session menu controls.
- Drawer click after hover-open pins instead of closing.
- Anonymous Pi removal defers destructive close by one microtask with a generation guard so remove→re-add cancels the close.
- Activation re-resolves after async unhide and checks current-work membership.
- Global rows expose `data-terminal-tab-id` for close/dirty confirmation anchoring.
- Current-work drag IDs are namespaced and ordering-only rows no longer expose remove controls.

## Verification
95 focused tests pass; TypeScript, strict architecture (0 over-limit files), and diff check pass. Real WebView/manual hover, touch, locale and DnD verification remains user-facing work and was not claimed.
