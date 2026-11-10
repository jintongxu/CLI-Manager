# Bounded design and discovery

One `terminal-tab-skin.css` imported last by components.css; selectors require the dedicated `ui-terminal-page-tab` hook plus an existing real tab class. Scoped root-theme selector establishes enough specificity to beat palette/chrome overrides without !important. No transform/opacity/transition/height/negative-margin changes. Top inset shadow is independent of focus outline. Remove separator pseudo-elements only on the skinned roots.

## Discovery / risk
- TerminalTabRow/TabItem and TerminalNavigationBar: GitNexus impact UNKNOWN (symbols missing, index 126 commits stale). Text-confirmed TerminalNavigationAdapter -> TerminalNavigationBar -> TerminalTabRow -> TabItem, and navigation file-map roots. Only add class hooks; no handler changes.
- SortableTab: graph LOW, PaneTabBar -> PaneLeafView (2 affected processes); use hook on SortableTab only, not legacy SortableWorkspanTab.
- FileEditorTabs: graph LOW, FileEditorPaneView -> FileEditorPane. Remove inline active background/color so styles own presentation; remove old active !important in file-editor.css rather than introducing more. Retain semantics/actions.
- FileEditorHeader has no open-file tabs; unchanged. GitDiffEditorTabs unrelated.
- workspace-chrome.css and terminal-actions-panes.css: inspected git diff HEAD, raw and numstat; no content differences at execution time (only Git EOL dirty flags). No tab removals exist to restore; do not overwrite/revert these files.
- terminalNavigation.css contains prior tab redesign edits; preserve them as base and supersede only target presentation via the new scoped skin.
- App.css imports components.css; TerminalNavigationBar also imports terminalNavigation.css. Higher scoped specificity makes order safe even if feature CSS arrives later.

## Visual contract
Uniform 8px corners, muted opaque theme-mixed resting surface, brighter hover/focus surface, subtle inset perimeter; active tab has stronger theme-mixed surface plus 2px TOP project/terminal accent. Use terminal theme variables with surface/on-surface/primary fallbacks. Keep ring as an outline (not replaced by selected shadow), keep existing close-button focus styles.
