import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/features/terminal/components/TerminalTabRow.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/features/terminal/components/terminalNavigation.css", import.meta.url), "utf8");

test("real tab row renders the passed collection without quick-list or more-count logic", () => {
  assert.match(source, /entries: readonly TerminalNavigationEntry\[\]/);
  assert.match(source, /entries\.map\(\(entry\)/);
  assert.doesNotMatch(source, /hiddenCount|quickEntries/);
  assert.match(source, /data-current-work-session-id=\{entry\.id\}/);
  assert.match(source, /data-sortable=\{sortable \? "true" : "false"\}/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected=\{active\}/);
  assert.doesNotMatch(source, /ui-terminal-tab-row-add/);
  assert.doesNotMatch(source, /onAdd\(entry\.id\)/);
});

test("real terminal tabs form a continuous strip without gaps or outer rounding", () => {
  const list = css.match(/\.ui-terminal-tab-row-list \{([^}]*)\}/)?.[1] ?? "";
  const item = css.match(/\.ui-terminal-tab-row-item \{([^}]*)\}/)?.[1] ?? "";
  assert.match(list, /gap: 0;/);
  assert.match(item, /border-radius: 0;/);
  assert.match(item, /border: 0;/);
  assert.match(item, /background: transparent;/);
  const active = css.match(/\.ui-terminal-tab-row-item\[data-active="true"\] \{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(active, /(?:height|padding|font-size|transform):/);
  for (const theme of ["sea-salt", "tokyo-night-storm"]) {
    const themeCss = readFileSync(new URL(`../src/styles/components/${theme}.css`, import.meta.url), "utf8");
    const activeTheme = themeCss.match(/\.ui-terminal-tab-row-item\[data-active="true"\]:hover \{([^}]*)\}/)?.[1] ?? "";
    assert.match(activeTheme, /35%/);
    assert.match(activeTheme, /inset 0 1px/);
  }
  assert.match(css, /\.ui-terminal-tab-row-item\[data-active="true"\] \{[^}]*border-radius: 5px 5px 0 0;[^}]*box-shadow: inset 0 1px/);
  assert.match(css, /\.ui-terminal-tab-row-item::after \{[^}]*pointer-events: none/);
  assert.match(css, /\.ui-terminal-tab-row-item:focus-within \.ui-terminal-tab-row-close/);
});

test("tab row reuses project color, context information and shared smooth scrolling", () => {
  assert.match(source, /buildTerminalTabContext/);
  assert.match(source, /projectColor/);
  assert.match(source, /formatTerminalTabContext/);
  assert.match(source, /useCurrentWorkTabScroll/);
  assert.match(source, /scrollTabs\(-1\)/);
  assert.match(source, /scrollTabs\(1\)/);
  assert.match(source, /title=\{`\$\{entry\.session\.title\}/);
});

test("tab row keeps activation and drag on the tab body without inline action buttons", () => {
  assert.match(source, /onActivate\(entry\.id\)/);
  assert.doesNotMatch(source, /onRemove\(entry\.id\)/);
  assert.doesNotMatch(source, /ui-terminal-tab-row-remove/);
  assert.doesNotMatch(source, /ui-terminal-tab-row-add/);
});

test("sortable mode uses the existing dnd sortable context and disables listeners in ordinary mode", () => {
  assert.match(source, /useSortable\(\{[\s\S]*disabled: !sortable/);
  assert.match(source, /SortableContext/);
  assert.match(source, /items=\{sortable \? entries\.map\(\(entry\) => `\$\{mode === "current-work" \? CURRENT_WORK_TAB_DRAG_PREFIX : TERMINAL_TAB_DRAG_PREFIX\}\$\{entry\.id\}`\) : \[\]\}/);
  assert.match(source, /DND_SORTABLE_TRANSITION/);
});

test("context menu exposes ask-btw entry gated on real selection state", () => {
  const view = readFileSync(new URL("../src/features/terminal/components/XTermView.tsx", import.meta.url), "utf8");
  assert.match(view, /handleMenuAskBtw/);
  const btwItem = view.slice(view.indexOf("onClick={handleMenuAskBtw}") - 600, view.indexOf("onClick={handleMenuAskBtw}") + 60);
  assert.doesNotMatch(btwItem, /(?:^|\s)disabled\s*=/);
  const menuContainer = view.slice(view.indexOf('className="terminal-context-menu"'), view.indexOf('onMouseUp={(e) =>', view.indexOf('className="terminal-context-menu"')));
  assert.doesNotMatch(menuContainer, /e\.preventDefault\(\)/);
  const controller = readFileSync(new URL("../src/features/terminal/hooks/useXTermController.ts", import.meta.url), "utf8");
  assert.match(controller, /openMenu\(e\.clientX, e\.clientY, text\.length > 0, text\)/);
  const contextMenuFn = controller.slice(controller.indexOf("const onContextMenu ="), controller.indexOf("contextMenuTarget.addEventListener"));
  assert.doesNotMatch(contextMenuFn, /copySelection/);
  assert.match(controller, /contextMenuTarget\.addEventListener\("contextmenu", onContextMenu, \{ capture: true \}\)/);
  assert.match(controller, /contextMenuTarget\.addEventListener\("mousedown", onMouseDownCapture, \{ capture: true \}\)/);
  const selectionReader = controller.slice(controller.indexOf("const readCurrentSelectionText ="), controller.indexOf('document.addEventListener("selectionchange"'));
  assert.ok(selectionReader.indexOf("window.getSelection()") < selectionReader.indexOf("terminal.getSelection()"));
  assert.match(controller, /const captureTerminalSelection = \(\) => \{[\s\S]*?terminal\.getSelection\(\)\.trim\(\)/);
  assert.match(controller, /document\.addEventListener\("mouseup", onSelectionMouseUp\)/);
  assert.match(controller, /isPiTerminalContext\(getSessionToolContext\(\)\)/);
  assert.match(controller, /piDragStart = pointerCell\(e\);[\s\S]*?contextMenuSelectionRef\.current = "";[\s\S]*?terminal\.clearSelection\(\)/);
  assert.match(controller, /terminal\.select\(first\.column, first\.row, length\)/);
  const mirroredSelection = controller.slice(controller.indexOf("queueMicrotask(() =>", controller.indexOf("const onSelectionMouseUp")), controller.indexOf("document.addEventListener", controller.indexOf("const onSelectionMouseUp")));
  assert.doesNotMatch(mirroredSelection, /if \(!terminal\.hasSelection\(\)\)/);
  assert.match(controller, /const selection = readCurrentSelectionText\(\)\.trim\(\);\s*if \(selection\) contextMenuSelectionRef\.current = selection;/);
  assert.match(controller, /const text = readCurrentSelectionText\(\)\.trim\(\) \|\| contextMenuSelectionRef\.current/);
  const actions = readFileSync(new URL("../src/features/terminal/hooks/useTerminalSelectionActions.ts", import.meta.url), "utf8");
  assert.match(controller, /useTerminalSelectionActions\(/);
  assert.match(actions, /const handleMenuAskBtw = \(menuSelection\?: string\) => \{[\s\S]*?onAskBtw\?\.\(selection, sessionId\)/);
  assert.doesNotMatch(controller, /openMenu\(e\.clientX, e\.clientY, false\)/);
  const paneLeaf = readFileSync(new URL("../src/features/terminal/components/PaneLeafView.tsx", import.meta.url), "utf8");
  assert.match(paneLeaf, /onAskBtw=\{onAskBtw\}/);
  const tabsController = readFileSync(new URL("../src/features/terminal/hooks/useTerminalTabsController.tsx", import.meta.url), "utf8");
  const askBtwCallback = tabsController.slice(tabsController.indexOf("onAskBtw:"), tabsController.indexOf("onDuplicateSession:"));
  assert.match(askBtwCallback, /btwSideQuestion\.stageFromTerminal\(quote, sourceTerminalId\)/);
  assert.match(askBtwCallback, /setBtwDrawerOpen\(true\)/);
  assert.doesNotMatch(askBtwCallback, /setSidePanelTab\("btw"\)/);
  assert.doesNotMatch(askBtwCallback, /setBtwPanelOpen\(true\)/);
  assert.doesNotMatch(askBtwCallback, /btwSideQuestion\.submit/);
});

test("drag overlay uses a compact title-only preview for new terminal tabs", () => {
  const overlay = readFileSync(new URL("../src/features/terminal/components/TerminalTabDragOverlay.tsx", import.meta.url), "utf8");
  assert.match(overlay, /type:.*terminal-tab/);
  assert.match(overlay, /const compact = dragData\?\.type === "terminal-tab"/);
  assert.match(overlay, /ui-terminal-simple-drag-overlay/);
  assert.match(overlay, /width: active\?\.rect\.current\.initial\?\.width/);
  assert.match(overlay, /height: active\?\.rect\.current\.initial\?\.height/);
  assert.match(overlay, /adjustScale=\{false\}/);
  assert.match(source, /scaleX: 1, scaleY: 1/);
  assert.match(source, /CSS\.Transform\.toString\(horizontalTransform\)/);
  const previewCss = css.match(/\.ui-terminal-simple-drag-overlay \{([^}]*)\}/)?.[1] ?? "";
  assert.match(previewCss, /box-sizing: border-box/);
  assert.match(previewCss, /height: 28px/);
  assert.match(previewCss, /pointer-events: none/);
  assert.match(overlay, /const preview = overlay && compact \?/);
  assert.match(overlay, /style=\{compact \? undefined : style\}/);
  assert.match(source, /data-drag-hidden=\{isDragging \? "true" : "false"\}/);
});

test("tab-row CSS provides enlarged hit areas while preserving active, focus and touch affordances", () => {
  for (const token of ["ui-terminal-tab-row", "ui-terminal-tab-row-title", "ui-terminal-tab-row-scroll"]) {
    assert.match(css, new RegExp(`\\.${token}`));
  }
  const tabItem = css.match(/\.ui-terminal-tab-row-item \{([^}]*)\}/)?.[1] ?? "";
  assert.match(tabItem, /min-width: 112px/);
  assert.match(tabItem, /height: 28px/);
  assert.match(tabItem, /padding: 0 8px/);
  assert.match(css, /\.ui-terminal-navigation-row--tabs \{ height: 28px; \}/);
  assert.match(css, /\.ui-terminal-navigation-row--tabs > button \{ height: 26px; min-height: 0;/);
  const tabMain = css.match(/\.ui-terminal-tab-row-main \{([^}]*)\}/)?.[1] ?? "";
  assert.match(tabMain, /flex: 1 1 auto/);
  assert.match(tabMain, /min-height: 26px/);
  assert.match(css, /ui-terminal-tab-row-list[^}]*gap: 0;/);
  assert.match(css, /var\(--tab-accent/);
  assert.match(css, /data-sortable/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /pointer: coarse/);
});
