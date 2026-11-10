# Execution

1. Add a dedicated `ui-terminal-page-tab` hook to the four real roots: top TerminalTabRow, pane SortableTab, navigation file tabs and FileEditorTabs. Preserve all handlers, state attributes, drag styles and accessibility.
2. Import `terminal-tab-skin.css` last from `components.css`; scope every selector to the hook and existing real root class. Use rounded page-tab corners, opaque theme-mixed surfaces, subtle perimeter and a 2px top accent for active tabs. Do not change geometry, scrolling, transforms or opacity.
3. Restore prior experimental presentation edits in legacy tab CSS so the dedicated skin is the only new visual authority. Preserve the existing public API import and display-label behavior.
4. Validate actual computed CSS for all four roots in dark/light states using headless Chromium, then run focused TypeScript, strict architecture and diff checks. Do not claim live Tauri WebView visual verification.
5. Keep the worktree uncommitted and unpushed for user testing.
