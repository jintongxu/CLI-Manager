# Current-work membership navigation and clean management (TEMP)

User authorized task and TEMP; preserve all existing dirty work. No dependencies, synchronization or commit.

## Root cause / discovery
Model filtered outer scope but ignored currentWorkMode; bar prepended outside currentEntry. Adapter passed unscoped management entries, mixed legacy ordering with repeated rows, and forwarded clear's zero-selection clear-all fallback. Fix at model, adapter and panel contracts, not terminal lifecycle.

Inspected model/useTerminalNavigation, adapter/bar/panels/UI model/CSS, TerminalTabsView, PaneTabBar menus and useCurrentWorkSessionController callbacks. Existing removeCurrentWorkSessions owns anonymous Pi closure; unchanged. Ordinary activation and creation lifecycle unchanged. DnD continues in TerminalTabsView's owning context. Backend/IPC unrelated.
Knowledge gate: maestro search current work terminal navigation --wiki-only returned no matches; coding specs and fix-triage/architecture contracts read. .gitnexus/run.cjs absent; contract plus symbol search fallback. Risk: navigation/management UI consumers, no lifecycle changes. Branch wt/task-1022-2147-9319cbf51fe9 has no upstream; no sync performed.

## Acceptance / scenarios
- Current-work quick/search/manage only outer-scope members; outsider active and empty set never leak outsiders. Member activation stays in current work.
- Explicit Add terminal picker uses outer-scope nonmembers, adds without activation/exit. All range remains explicit exit.
- One normal management list: title/context, remove/add, compact existing menu (including pin). Checkboxes only in explicit multiselect; scoped member count; remove selected disabled/no-op at zero, never clear fallback. Anonymous Pi removal labeled 移出并关闭 / Remove and close.
- Ordering separately selected, no simultaneous repeated management list; existing DnD context/menu actions preserved.
- Scenarios: ordinary/current-work, populated/empty, inside/outside active, local/SSH/WSL/worktree identity via canonical scope resolver, hidden/disconnected sessions, split/single pane, mixed PTY/Pi batch, stale/out-of-scope selection, narrow/theme/bilingual UI. Window focus/minimize/hooks/process lifecycle unaffected.
- Focused regressions + tsc + strict architecture; no claim of manual runtime verification.
