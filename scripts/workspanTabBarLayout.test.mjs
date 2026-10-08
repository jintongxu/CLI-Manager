import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/readComposedSource.mjs";

const tabsSource = readFileSync(new URL("../src/features/terminal/components/TerminalTabsView.tsx", import.meta.url), "utf8");
const sortableTabsSource = readFileSync(new URL("../src/features/terminal/components/SortableTerminalTabs.tsx", import.meta.url), "utf8");
const tabDialogsSource = readFileSync(new URL("../src/features/terminal/components/TerminalTabDialogs.tsx", import.meta.url), "utf8");
const tabBarSource = readFileSync(
  new URL("../src/features/workspace/api/WorkspanTabBar.tsx", import.meta.url),
  "utf8",
);
const layoutComponentSource = readFileSync(
  new URL("../src/features/workspace/api/WorkspanTerminalLayout.tsx", import.meta.url),
  "utf8",
);
const controlsSource = readFileSync(
  new URL("../src/features/workspace/api/WorkspaceLayoutControls.tsx", import.meta.url),
  "utf8",
);
const menuSource = readFileSync(
  new URL("../src/features/workspace/components/WorkspaceLayoutMenu.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../src/styles/workspace-layout.css", import.meta.url), "utf8");
const i18nSource = readFileSync(new URL("../src/shared/i18n/index.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/shared/lib/workspaceLayout.ts", import.meta.url), "utf8");

test("top-level Workspan tabs use one direction-aware document-flow slot", () => {
  assert.equal((tabsSource.match(/<WorkspanTabBar/g) ?? []).length, 1);
  assert.match(tabsSource, /<WorkspanTerminalLayout/);
  assert.match(layoutComponentSource, /key="workspan-tabbar"/);
  assert.match(layoutComponentSource, /key="terminal-body"/);
  assert.match(layoutComponentSource, /tabBarVisible: boolean/);
  assert.match(layoutComponentSource, /ui-workspan-tabbar-slot/);
  assert.match(layoutComponentSource, /position === "top" \? topToBottom : bottomToTop/);
  assert.match(tabBarSource, /<SortableContext/);
  assert.match(tabBarSource, /data-workspan-tabbar-position=\{position\}/);
  assert.match(stylesSource, /.ui-workspan-terminal-body/);
  assert.match(stylesSource, /flex-direction: column/);
});

test("bottom overflow list opens toward the terminal content", () => {
  assert.match(tabBarSource, /side=\{position === "bottom" \? "top" : "bottom"\}/);
  assert.match(tabBarSource, /collisionPadding=\{8\}/);
  assert.match(tabDialogsSource, /<PopoverContent[\s\S]*collisionPadding=\{8\}/);
  assert.match(tabBarSource, /onWheel=\{\(event\) =>/);
  assert.match(tabBarSource, /WORKSPAN_TABBAR_END_DROP_ID/);
});

test("the persisted layout contract keeps top as the default and validates bottom", () => {
  assert.match(layoutSource, /workspanTabBarPosition: WorkspanTabBarPosition/);
  assert.match(layoutSource, /workspanTabBarVisible: boolean/);
  assert.match(layoutSource, /workspanTabBarPosition: "top"/);
  assert.match(layoutSource, /raw\.workspanTabBarPosition === "bottom"/);
  assert.match(controlsSource, /workspanTabBarPosition/);
  assert.match(menuSource, /workspaceLayout\.controls\.reset/);
  assert.match(i18nSource, /"workspaceLayout\.controls\.tabsTop": "Tab 栏置于顶部"/);
  assert.match(i18nSource, /"workspaceLayout\.controls\.tabsBottom": "Place tabs at the bottom"/);
});

test("pane-level terminal tab ownership remains outside the top-level docking slot", () => {
  const paneTabBarSource = readFileSync(new URL("../src/features/terminal/components/PaneTabBar.tsx", import.meta.url), "utf8");
  assert.match(sortableTabsSource, /function SortableTab\(/);
  assert.match(paneTabBarSource, /function PaneTabBar\(/);
  assert.doesNotMatch(tabBarSource, /SplitTerminalView|PaneTabBar/);
});

test("full current context wraps and scrolls above fixed badge rows without group headers", () => {
  const css = readFileSync(new URL("../src/styles/components/focus-controls.css", import.meta.url), "utf8");
  const context = css.match(/\.ui-terminal-current-context\s*\{([^}]+)\}/)?.[1];
  assert.ok(context);
  for (const declaration of ["white-space: normal", "overflow-wrap: anywhere", "max-height: 30%", "overflow-y: auto"]) assert.ok(context.includes(declaration));
  assert.doesNotMatch(context, /ellipsis|line-clamp|overflow:\s*hidden/);
  assert.doesNotMatch(css, /\.ui-workspan-group-label/);
  assert.doesNotMatch(tabBarSource, /ui-workspan-group-label/);
  assert.match(css, /\.ui-workspan-project-group\s*\{[^}]*height: 36px/);
  assert.match(css, /\.ui-workspan-groups-row\s*\{[^}]*height: 36px;[^}]*flex: 0 0 36px/);
  assert.match(css, /\.ui-workspan-overflow-control\s*\{[^}]*flex: 0 0 28px/);
  assert.match(tabBarSource, /ui-workspan-group-tabs/);
  assert.match(tabsSource, /showWorktreeBadge=\{true\}/);
  assert.equal((tabsSource.match(/<TerminalCurrentContext/g) ?? []).length, 1);
  assert.match(tabsSource, /<TerminalCurrentContext[^>]+\/>\s*<WorkspanTerminalLayout/);
});

test("bar, document-flow slot and aurora override have natural height; insertion line anchors to purpose row", () => {
  const chrome = readFileSync(new URL("../src/styles/components/workspace-chrome.css", import.meta.url), "utf8");
  assert.match(stylesSource, /\.ui-workspan-tabbar-slot\s*\{[^}]*flex: 0 0 auto;[^}]*min-height: 0;/);
  assert.match(chrome, /\[data-dark-palette="midnight-aurora"\] \.ui-terminal-pane-chrome\.ui-workspan-tabbar\s*\{[^}]*height: auto;/);
  assert.doesNotMatch(chrome, /78px/);
  assert.match(chrome, /\.ui-workspan-detach-insertion\s*\{[^}]*bottom: 8px;/);
  assert.doesNotMatch(tabBarSource, /translate3d\([^`]*-50%/);
});
