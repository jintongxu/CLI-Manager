# Terminal/file page-tab skin

## Authorized requirement
New bounded redesign, not another speculative bug fix. Cover top terminal tabs, pane terminal tabs and open file tabs. Rounded page tabs, soft themed surfaces and TOP accent line. No commit/push or application launch/restart; preserve release preparation, migration normalization, daemon and API changes.

## Acceptance
- Actual TerminalTabRow `ui-terminal-tab-row-item/data-active`, SortableTab `ui-terminal-tab-item/data-selected`, navigation `ui-terminal-file-tab/data-active` and FileEditorTabs `ui-file-editor-tab/data-active` receive the skin.
- Dark/light palette overrides cannot flatten active/hover/focus styling. Preserve geometry, dragging, opacity, scrolling, controls, handlers and translations.
- Headless Chromium checks actual compiled CSS matching and computed states, not screenshots or string-only CSS tests.
- Focused tests, strict architecture, V1.5.1 CHANGELOG and feature-list entry. Do not claim live WebView verification.

## Scenario enumeration
- Window focus: keyboard ring remains visible; no focus/lifecycle behavior changes. Minimized/tray: no rendered interaction.
- Panes: ordinary, split/deep pane and fullscreen use same scoped tab hook; preserve 26/28/30px existing heights.
- Expanded/collapsed/embedded sidebar and focus mode: no sidebar/control selectors changed.
- Single/multiple sessions and workspan switching: selected attributes remain authoritative; long labels truncate and horizontal scrolling remains.
- Local/WSL/SSH, main repo/worktree/missing worktree and installed/missing CLI hooks: retain all icons, status dots, tooltips and context data; no runtime branching introduced.
- File preview/pinned/dirty and companion current/beside: retain labels/actions. Git diff tabs are separate navigation, outside this terminal/open-file-tab skin.
