# Design: Focused desktop workspace

## Visual directions

- **Graphite**: neutral graphite surfaces, cobalt actions, precise compact UI hierarchy; default dark theme for the first 1440px screenshot.
- **Porcelain**: warm ivory/forest palette, softer corners and editorial serif page headings; warmer raised project sidebar. Dark mode is olive-charcoal rather than inverted ivory.
- **Midnight**: navy/cyan palette, sharper corners, technical micro-typography and a thin cyan titlebar rule. Light mode uses cool blue-white surfaces.

All six palettes provide semantic background, panel, text, muted text, border, focus/accent, success, warning, error and diff tokens. No production tokens are imported or changed. Typography uses local system UI and monospace stacks; no downloads.

## Information architecture

Read-only references: `src/app/App.tsx`, `src/features/projects/components/{SidebarView,SidebarHeader,SidebarFooter}.tsx`, `src/styles/themes.css`. The preview retains project/session navigation, Worktree branch context, terminal tabs, file changes, and footer statistics/settings access. Unlike production modal panels, settings and analytics occupy the main pane for easier full-application theme comparison; this is a preview presentation decision, not a proposed behavior migration.

## Files

- `index.html`: standalone document and ordered deferred classic script loading; direct `file://` opening supported.
- `themes.css`: six semantic palettes.
- `app.css`: desktop shell, scene layouts, density and breakpoints.
- `app.js`: state, shell, inline icons and delegated mock event handlers.
- `views.js`: four render functions and deterministic scene fixtures.
- `verify.cjs`: dependency-free VM render matrix and interaction smoke tests.

Classic scripts are used deliberately instead of ES imports to avoid local-file module CORS restrictions. Responsibilities remain split by file. No production imports, process operations, storage or network requests.

## Interaction and accessibility

Native buttons/selects, labeled controls, pressed/checked/current states, visible focus rings and status feedback. State re-renders preserve the active control when possible. Mock terminal submission escapes HTML. Empty submission displays a localized prompt. Project names truncate with full title text. Review status and diff layout can be changed; preferences persist only until reload.

Default canvas targets 1440px; 1150/900/650 breakpoints adapt shell, inspectors and charts. Diff panes retain local horizontal scrolling rather than forcing document width. Screen-reader and visual browser verification remain the root agent's follow-up gate.
