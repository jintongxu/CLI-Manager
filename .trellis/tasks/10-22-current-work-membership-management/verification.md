# Verification

- `node --test scripts/terminalNavigation.test.mjs scripts/terminalNavigationUi.test.mjs scripts/currentWorkAnonymousClose.test.mjs scripts/currentWorkTabScroll.test.mjs scripts/terminalProjectTabsInteraction.test.mjs scripts/workspanTabBarLayout.test.mjs`: 68/68 passed.
- `npx tsc --noEmit`: passed.
- `npm run check:architecture -- --strict`: 1349 source files; zero >2000 lines; zero violations.
- `git diff --check`: passed; existing workflow analytics line-ending warnings only.

Focused new regressions exercise member-only quick/search/management projection with empty membership and outside active, rejection of outsider activation, add picker callback without navigation, mixed Pi/PTY scoped batch and safe zero, default single list without checkboxes/legacy ordering, separate order mode, and retained empty-state Add entry. Existing anonymous closure, scrolling, project tabs and workspan layout regressions remain passing.

No desktop/runtime/manual bilingual or visual verification performed. No dependencies, sync or commit. Both dedicated general-executor schema paths were absent; report checked against inline schema.
