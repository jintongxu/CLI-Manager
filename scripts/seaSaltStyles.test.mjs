import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scope = '[data-theme="light"][data-light-palette="sea-salt"]';
const themes = postcss.parse(read("src/styles/themes.css"));
const chrome = postcss.parse(read("src/styles/components/sea-salt.css"));
const palette = themes.nodes.find((node) => node.selector === scope);
const tokens = Object.fromEntries(palette.nodes.filter((n) => n.type === "decl").map(({ prop, value }) => [prop, value]));
const preview = postcss.parse(read("design-previews/app-theme/color-directions.css"));
const sea = Object.fromEntries(preview.nodes.find((n) => n.selector === "body").nodes.filter((n) => n.type === "decl").map(({ prop, value }) => [prop, value.toUpperCase()]));
const declarations = (selector) => {
  const result = {};
  chrome.walkRules((rule) => {
    if (rule.selectors.includes(`${scope} ${selector}`)) rule.walkDecls(({ prop, value }) => { result[prop] = value; });
  });
  return result;
};
const val = (name) => `var(--sea-salt-${name})`;

test("Sea Salt is the exact frozen sea preview, additive after all light bridges", () => {
  const mapping = {
    "--bg-primary": "--surface", "--bg-secondary": "--sidebar", "--bg-tertiary": "--bar",
    "--text-primary": "--text", "--text-secondary": "--muted", "--text-muted": "--muted",
    "--border": "--line", "--accent": "--accent", "--accent-hover": "--accent-hover",
    "--interactive-selected-bg": "--selected", "--interactive-hover-bg": "--selected",
    "--surface-container-low": "--sidebar", "--surface-container-high": "--bar",
    "--sea-salt-surface": "--surface", "--sea-salt-low": "--sidebar", "--sea-salt-bar": "--bar",
    "--sea-salt-raised": "--terminal", "--sea-salt-text": "--text", "--sea-salt-muted": "--muted",
    "--sea-salt-border": "--line", "--sea-salt-solid": "--accent", "--sea-salt-solid-hover": "--accent-hover",
    "--sea-salt-selected": "--selected",
  };
  for (const [actual, reference] of Object.entries(mapping)) assert.equal(tokens[actual], sea[reference], actual);
  assert.equal(tokens["--primary-gradient-start"], tokens["--accent"]);
  assert.equal(tokens["--primary-gradient-end"], tokens["--accent"]);
  assert.ok(themes.nodes.indexOf(palette) > themes.nodes.findLastIndex((n) => n.selector === '[data-theme="light"]'));
  assert.ok(themes.nodes.some((n) => n.selector?.includes('data-light-palette="cream-forest"')));
  assert.ok(themes.nodes.some((n) => n.selector?.includes('data-dark-palette="graphite"')));
});

test("Frozen reference HTML/CSS/JS are byte-identical; no preview UI is shipped into chrome", () => {
  for (const [ext, hash] of Object.entries({
    css: "3b2d3b34a245c27246a20a1c693d43367dc783aa6c1c11d07f5731656e4a6b0b",
    html: "67542b583b61483c53743d9670446da085df22ab82f271294a2e2f92f1814d7a",
    js: "8ff7529f9ec61781e6fe09743b3cb16d201bac01a3c4d914e2e8232f42cd6004",
  })) {
    const bytes = readFileSync(new URL(`../design-previews/app-theme/color-directions.${ext}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  }
  assert.doesNotMatch(chrome.toString(), /preview-strip|mock-terminal|terminal-output|\.ansi-|content\s*:/);
});

test("All selectors are light/sea-only; fonts, geometry, PTY canvas and independent content skins are untouched", () => {
  chrome.walkRules((rule) => {
    rule.selectors.forEach((selector) => assert.ok(selector.startsWith(`${scope} `), selector));
    assert.doesNotMatch(rule.selector, /\.monaco|\.xterm|\.terminal-skin|data-term-stats-skin|data-terminal-side-panel-content|\*/);
  });
  const exceptions = new Map([
    ['.ui-terminal-tab-row-list|gap', '0'],
    ['.ui-terminal-tab-row-item|border-radius', '0'],
    ['.ui-worktree-row .ui-worktree-tree-icon|transform', 'none'],
    ['.ui-terminal-action-sidebar[data-dock-side="right"]:not([data-show-text="true"])|gap', '9px'],
    ['.ui-terminal-action-sidebar[data-dock-side="right"]:not([data-show-text="true"])|padding-block', '12px'],
  ]);
  chrome.walkDecls((decl) => {
    const key = `${decl.parent.selector.replace(`${scope} `, "")}|${decl.prop}`;
    if (exceptions.has(key)) {
      assert.equal(decl.value, exceptions.get(key), key);
      assert.ok(!decl.important);
      return;
    }
    assert.match(decl.prop, /^(?:--terminal-(?:tab-|chrome-|action-color$)|background(?:-color)?$|border-(?:color|radius)$|outline-color$|box-shadow$|color$|filter$)/);
    assert.ok(!decl.important);
    if (decl.prop === "border-radius") assert.match(decl.value, /^[68]px$/);
  });
  palette.walkDecls((decl) => assert.doesNotMatch(decl.prop, /^--(?:term-|terminal-|font-)/));
});

test("Actual TerminalTabRow source and its active/hover/focus/close/scroll states are mapped, not only ui-tab-trigger", () => {
  const source = read("src/features/terminal/components/TerminalTabRow.tsx");
  for (const cls of ["ui-terminal-tab-row", "ui-terminal-tab-row-list", "ui-terminal-tab-row-item", "ui-terminal-tab-row-main", "ui-terminal-tab-row-title", "ui-terminal-tab-row-close", "ui-terminal-tab-row-scroll"]) {
    assert.ok(source.includes(cls), cls);
    assert.ok(Object.keys(declarations(`.${cls}`)).length, cls);
  }
  assert.match(source, /data-active=\{active \? "true" : "false"\}/);
  assert.equal(declarations('.ui-terminal-tab-row-item[data-active="true"]').background, val("raised"));
  assert.equal(declarations('.ui-terminal-tab-row-item[data-active="true"]').color, val("solid"));
  assert.equal(declarations('.ui-terminal-tab-row-item[data-active="true"]')["box-shadow"], `inset 0 2px 0 ${val("solid")}`);
  assert.equal(declarations(".ui-terminal-tab-row-item:hover").background, val("hover"));
  assert.equal(declarations(".ui-terminal-tab-row-item:focus-within")["border-color"], val("solid"));
  for (const cls of ["main", "close", "scroll"]) assert.equal(declarations(`.ui-terminal-tab-row-${cls}:focus-visible`)["outline-color"], val("solid"));
  assert.equal(declarations(".ui-terminal-tab-row-close:hover").background, val("selected"));
  assert.equal(declarations(".ui-terminal-tab-row-scroll:hover:not(:disabled)").background, val("selected"));
});

test("Real rails, navigation, tree, overlays and file/history/stats headers have explicit chrome coverage", () => {
  assert.match(read("src/features/terminal/hooks/useTerminalToolbarRenderer.tsx"), /ui-terminal-actions ui-terminal-action-sidebar/);
  for (const selector of [
    ".ui-workspace-shell", ".ui-main-shell", ".window-titlebar", ".ui-sidebar-shell", ".ui-sidebar-top", ".ui-sidebar-footer",
    ".ui-tree-project:hover", '.ui-tree-project[data-selected="true"]', '.ui-tree-collapsed-item[data-selected="true"]',
    '.ui-pinned-project-item[aria-selected="true"]', '.sidebar-terminal-row[data-selected="true"]',
    ".ui-current-workbar", '.ui-workspan-context-button[data-selected="true"]', ".ui-terminal-navigation-popup", ".ui-terminal-navigation-drawer",
    ".ui-terminal-action-sidebar", '.ui-terminal-action-sidebar[data-dock-side="left"]', ".ui-terminal-action-drag-overlay",
    ".ui-terminal-pane-chrome .ui-terminal-action-sidebar .ui-icon-action", ".ui-terminal-action-sidebar .ui-toolbar-button:hover:not(:disabled)",
    '.ui-terminal-action-sidebar .ui-icon-action[data-active="true"]', ".ui-terminal-side-panel-frame", ".ui-terminal-panel-header",
    ".ui-input", ".ui-input:focus-visible", ".ui-btn-primary", ".ui-btn-primary:hover:not(:disabled)", ".ui-config-modal", ".ui-collapsed-flyout",
    '.ui-surface-card[role="dialog"]', ".context-menu:not(.terminal-context-menu):not(.ui-file-editor-tab-menu)",
    ".ui-terminal-action-sort-item[data-tooltip]::after", ".ui-file-tooltip[data-tooltip]::after",
    ".ui-file-editor-header", ".ui-file-editor-tabs", ".ui-history-sidebar-top", ".ui-history-detail-top", ".ui-stats-panel-header",
  ]) assert.ok(Object.keys(declarations(selector)).length, selector);
  const rail = declarations(".ui-terminal-pane-chrome .ui-terminal-action-sidebar .ui-icon-action");
  assert.equal(rail["--terminal-action-color"], val("muted"));
  assert.equal(rail.color, val("muted"));
  assert.equal(declarations(".ui-terminal-action-sidebar").background, val("bar"));
  assert.equal(declarations('.ui-terminal-action-sidebar .ui-icon-action[data-active="true"]')["--terminal-action-color"], val("solid"));
});

test("AA text and filled actions, plus opaque focus/control boundaries, on all sea surfaces", () => {
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((c) => parseInt(c, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); };
  for (const bg of ["surface", "low", "bar", "raised", "selected"]) {
    for (const fg of ["text", "muted", "solid"]) assert.ok(ratio(tokens[`--sea-salt-${fg}`], tokens[`--sea-salt-${bg}`]) >= 4.5, `${fg}/${bg}`);
    for (const fg of ["solid", "control-border"]) assert.ok(ratio(tokens[`--sea-salt-${fg}`], tokens[`--sea-salt-${bg}`]) >= 3, `${fg}/${bg}`);
  }
  for (const bg of ["solid", "solid-hover"]) assert.ok(ratio("#FFFFFF", tokens[`--sea-salt-${bg}`]) >= 4.5, bg);
});

test("Manifest imports sea once after base chrome without reordering any old imports", () => {
  const imports = read("src/styles/components.css").trim().split(/\r?\n/);
  const entry = '@import "./components/sea-salt.css";';
  assert.equal(imports.filter((line) => line === entry).length, 1);
  assert.ok(imports.indexOf(entry) > imports.indexOf('@import "./components/terminal-actions-panes.css";'));
  const ordered = ["file-editor", "cream-forest", "graphite"].map((name) => `@import "./components/${name}.css";`);
  const positions = ordered.map((entry) => imports.indexOf(entry));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
});


test("Bounded fidelity overrides target real source hooks without broad geometry exemptions", () => {
  const tree = read("src/styles/components/project-tree.css");
  const worktree = read("src/features/projects/styles/sidebar-terminals.css");
  const rail = read("src/features/terminal/hooks/useTerminalToolbarRenderer.tsx");
  assert.match(tree, /\.ui-tree-node\[data-accent="true"\]::before/);
  assert.match(worktree, /transform: scale\(1\.04\)/);
  assert.match(rail, /data-show-text=\{terminalToolbarVisibility.showText/);
  assert.match(rail, /data-dock-side=\{terminalSidePanelSide\}/);
  assert.equal(declarations('.ui-tree-project[data-selected="true"][data-accent="true"]::before').background, "none");
  assert.equal(declarations('.ui-tree-project[data-selected="true"]')["box-shadow"], `inset 2px 0 0 ${val("solid")}`);
  assert.equal(declarations('.ui-tree-project:focus-visible')["box-shadow"], `inset 0 0 0 2px ${val("solid")}`);
  assert.deepEqual(declarations('.ui-worktree-row .ui-worktree-tree-icon'), { background: "transparent", transform: "none" });
  assert.equal(declarations('.ui-worktree-row:not([data-invalid="true"]) .ui-worktree-tree-icon').color, val("muted"));
  chrome.walkRules(rule => {
    if (rule.selector.includes("ui-worktree-tree-icon") && rule.nodes.some(d => d.prop === "color")) {
      rule.selectors.forEach(s => assert.ok(s.includes(':not([data-invalid="true"])'), s));
    }
    assert.doesNotMatch(rule.selector, /data-dragging|ui-tree-warning-chip|data-invalid="true"\] \.ui-worktree-tree-icon/);
  });
  assert.equal(declarations('.ui-terminal-tab-row-list').gap, "0");
  assert.equal(declarations('.ui-terminal-tab-row-item')["border-radius"], "0");
  assert.equal(declarations('.ui-terminal-tab-row-item')["border-color"], `transparent ${val("border")} transparent transparent`);
  assert.deepEqual(declarations('.ui-terminal-action-sidebar[data-dock-side="right"]:not([data-show-text="true"])'), { gap: "9px", "padding-block": "12px" });
});
