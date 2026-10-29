import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scope = '[data-theme="dark"][data-dark-palette="tokyo-night-storm"]';
const themes = postcss.parse(read("src/styles/themes.css"));
const chrome = postcss.parse(read("src/styles/components/tokyo-night-storm.css"));
test("Right Storm rail blends into content and uses a thin active marker", () => {
  const rail = '.ui-terminal-action-sidebar:not([data-dock-side="left"])';
  const actual = declarations(rail);
  assert.equal(actual.background, "var(--storm-surface)");
  assert.match(actual["box-shadow"], /^inset 1px 0 0 color-mix/);
  const active = declarations(`.ui-terminal-pane-chrome ${rail} :is(.ui-icon-action, .ui-toolbar-button)[data-active="true"]:not(:disabled):not([data-disabled]):not([aria-disabled="true"])`);
  assert.equal(active.background, "transparent");
  assert.equal(active.color, "var(--storm-solid)");
  assert.equal(active["box-shadow"], "inset 2px 0 0 var(--storm-solid)");
});

const palette = themes.nodes.find((node) => node.selector === scope);
const tokens = Object.fromEntries(palette.nodes.filter((n) => n.type === "decl").map(({ prop, value }) => [prop, value]));
const declarations = (selector) => {
  const result = {};
  chrome.walkRules((rule) => {
    if (rule.selectors.includes(`${scope} ${selector}`)) rule.walkDecls(({ prop, value, important }) => {
      if (!result[prop]?.important || important) result[prop] = { value, important: !!important };
    });
  });
  return Object.fromEntries(Object.entries(result).map(([key, decl]) => [key, decl.value]));
};
const val = (name) => `var(--storm-${name})`;

test("Official storm.lua source colors have explicit project roles and literal stable aliases", () => {
  assert.match(read("src/styles/themes.css"), /https:\/\/github.com\/folke\/tokyonight.nvim\/blob\/main\/lua\/tokyonight\/colors\/storm.lua/);
  for (const [name, value] of Object.entries({ surface: "#24283B", low: "#1F2335", bar: "#1F2335", raised: "#292E42", text: "#C0CAF5", secondary: "#A9B1D6", muted: "#A9B1D6", solid: "#7AA2F7", cyan: "#7DCFFF", border: "#3B4261", selected: "#2E3C64", "on-solid": "#1F2335" })) {
    assert.equal(tokens[`--storm-${name}`], value, name);
  }
  assert.equal(tokens["--bg-primary"], tokens["--storm-surface"]);
  assert.equal(tokens["--on-primary"], tokens["--storm-on-solid"]);
  assert.equal(tokens["--text-muted"], tokens["--storm-secondary"]);
  assert.equal(tokens["--primary-gradient-start"], tokens["--primary-gradient-end"]);
});

test("Strict dark Storm scope; no geometry, font, canvas, warning or independent content overrides", () => {
  chrome.walkRules((rule) => {
    rule.selectors.forEach((selector) => assert.ok(selector.startsWith(`${scope} `), selector));
    assert.doesNotMatch(rule.selector, /\.monaco|\.xterm|\.terminal-skin|data-term-stats-skin|data-terminal-side-panel-content|ui-cpu-cat|data-invalid="true"\]\s*\{/);
  });
  chrome.walkDecls((decl) => {
    assert.match(decl.prop, /^(?:--terminal-(?:tab-|chrome-|action-color$)|background(?:-color)?$|border-(?:color|radius)$|outline(?:-color|-style|-width|-offset)?$|box-shadow$|color$|filter$|opacity$)/);
    if (decl.prop === "opacity") assert.equal(decl.parent.selectors.every((s) => s.endsWith("::placeholder")), true);
    if (decl.important) assert.ok(["color", "background"].includes(decl.prop));
    for (const match of decl.value.matchAll(/var\((--[^),]+)/g)) assert.match(match[1], /^--storm-/);
  });
  palette.walkDecls((decl) => assert.doesNotMatch(decl.prop, /^--(?:term-|terminal-|font-)/));
});

test("Actual TerminalTabRow classes and active, hover, close, scroll and keyboard states", () => {
  const source = read("src/features/terminal/components/TerminalTabRow.tsx");
  for (const part of ["", "-list", "-item", "-main", "-title", "-close", "-scroll"]) {
    const cls = `ui-terminal-tab-row${part}`;
    assert.ok(source.includes(cls));
    assert.ok(Object.keys(declarations(`.${cls}`)).length, cls);
  }
  assert.match(source, /data-active=\{active \? "true" : "false"\}/);
  assert.equal(declarations('.ui-terminal-tab-row-item[data-active="true"]').color, val("text"));
  assert.equal(declarations('.ui-terminal-tab-row-item[data-active="true"]').background, val("selected"));
  assert.equal(declarations('.ui-terminal-tab-row-item[data-active="true"]')["box-shadow"], "inset 0 2px 0 var(--storm-solid)");
  assert.equal(declarations(".ui-terminal-tab-row-item:hover").background, val("hover"));
  for (const part of ["main", "close", "scroll"]) assert.equal(declarations(`.ui-terminal-tab-row-${part}:focus-visible`)["outline-color"], val("solid"));
  assert.equal(declarations(".ui-terminal-tab-row-scroll:disabled").color, val("muted"));
});

test("Actual toolbar, project tree, collapsed/worktree, portals, forms and chrome mappings", () => {
  assert.match(read("src/features/terminal/hooks/useTerminalToolbarRenderer.tsx"), /ui-terminal-actions ui-terminal-action-sidebar/);
  assert.match(read("src/features/projects/components/ProjectTree.tsx"), /ui-tree-collapsed-item/);
  for (const selector of [
    ".ui-workspace-shell", ".window-titlebar", ".ui-sidebar-shell", '.ui-tree-project[data-selected="true"]',
    '.ui-worktree-row[data-selected="true"]', '.ui-tree-collapsed-item[data-selected="true"]', '.ui-pinned-project-item[aria-selected="true"]',
    ".ui-terminal-global-chrome", ".ui-terminal-pane-chrome", ".ui-terminal-action-sidebar", '.ui-terminal-action-sidebar[data-dock-side="left"]',
    ".ui-terminal-pane-chrome .ui-terminal-actions .ui-toolbar-button", ".ui-terminal-pane-chrome .ui-terminal-action-sidebar .ui-icon-action",
    ".ui-terminal-action-sidebar .ui-icon-action:disabled", ".ui-terminal-action-sidebar .ui-icon-action:focus-visible", ".ui-terminal-action-drag-overlay",
    ".ui-terminal-navigation-popup", ".ui-terminal-navigation-drawer", ".ui-current-workbar", ".ui-input", ".ui-input:focus-visible", ".ui-tree-inline-input",
    ".ui-config-modal", '.ui-surface-card[role="dialog"]', ".ui-collapsed-flyout", ".context-menu:not(.terminal-context-menu):not(.ui-file-editor-tab-menu)",
    ".ui-file-editor-header", ".ui-file-editor-tabs", ".ui-history-sidebar-top", ".ui-history-detail-top", ".ui-stats-panel-header",
  ]) assert.ok(Object.keys(declarations(selector)).length, selector);
  assert.equal(declarations(".window-titlebar").background, val("low"));
  assert.equal(declarations(".ui-terminal-pane-chrome .ui-terminal-action-sidebar .ui-icon-action")["--terminal-action-color"], val("muted"));
  for (const selector of [".ui-btn-primary", ".ui-btn-primary:hover:not(:disabled):not([data-disabled]):not([aria-disabled=\"true\"])", ".native-provider-control--primary", ".native-provider-control--primary:hover:not([data-disabled]):not(:disabled)", ".ui-terminal-pane-chrome .ui-terminal-actions .ui-primary-action"]) {
    assert.equal(declarations(selector).color, val("on-solid"), selector);
    assert.equal(declarations(selector).background, val(selector.includes(":hover:not(:disabled):not([data-disabled])") ? "solid-hover" : "solid"), selector);
  }
});

test("AA primary/secondary/accent text and dark filled labels on official Storm surfaces", () => {
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((c) => parseInt(c, 16) / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((a, b) => b - a); return (hi + .05) / (lo + .05); };
  for (const bg of ["surface", "low", "bar", "raised", "selected"]) {
    for (const fg of ["text", "secondary", "muted", "cyan", ...(bg === "selected" ? [] : ["solid"])]) assert.ok(ratio(tokens[`--storm-${fg}`], tokens[`--storm-${bg}`]) >= 4.5, `${fg}/${bg}`);
  }
  assert.equal(declarations('.ui-terminal-action-sidebar .ui-icon-action[data-active="true"]').color, val("cyan"));
  assert.equal(declarations('.ui-workspan-context-button[data-selected="true"]').color, val("cyan"));
  for (const bg of ["solid", "solid-hover"]) assert.ok(ratio(tokens["--storm-on-solid"], tokens[`--storm-${bg}`]) >= 4.5);
});

test("Vite compiles the ordered stylesheet manifest with Storm included", async () => {
  const { preprocessCSS, resolveConfig } = await import("vite");
  const config = await resolveConfig({ configFile: false }, "build");
  const compiled = await preprocessCSS(read("src/styles/components.css"), new URL("../src/styles/components.css", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), config);
  assert.ok(compiled.code.includes(scope));
  assert.ok(compiled.code.includes("--storm-on-solid"));
});

test("Ordered import is additive; frozen color previews are unchanged", () => {
  const imports = read("src/styles/components.css");
  assert.equal(imports.match(/@import "\.\/components\/tokyo-night-storm.css";/g)?.length, 1);
  assert.ok(imports.indexOf('components/tokyo-night-storm.css') > imports.indexOf('components/graphite.css'));
  for (const [ext, hash] of Object.entries({ css: "3b2d3b34a245c27246a20a1c693d43367dc783aa6c1c11d07f5731656e4a6b0b", html: "67542b583b61483c53743d9670446da085df22ab82f271294a2e2f92f1814d7a", js: "8ff7529f9ec61781e6fe09743b3cb16d201bac01a3c4d914e2e8232f42cd6004" })) {
    assert.equal(createHash("sha256").update(read(`design-previews/app-theme/color-directions.${ext}`)).digest("hex"), hash);
  }
});


test("Hover is not selection on real rails, segmented controls, files and navigation", () => {
  for (const cls of [".ui-terminal-action-sidebar .ui-icon-action", ".ui-terminal-pane-chrome .ui-terminal-actions .ui-toolbar-button"]) {
    assert.equal(declarations(`${cls}:hover:not(:disabled):not([data-disabled]):not([aria-disabled="true"]):not([data-active="true"])`).background, val("hover"));
  }
  assert.equal(declarations('.ui-terminal-action-sidebar .ui-icon-action[data-active="true"]').background, val("selected"));
  assert.equal(declarations('.ui-segmented-btn:hover').background, val("hover"));
  assert.equal(declarations('.ui-segmented-btn[data-active="true"]').background, val("selected"));
  assert.equal(declarations('.ui-file-editor-tab:hover').background, val("hover"));
  assert.equal(declarations('.ui-file-editor-tab[data-active="true"]').background, val("selected"));
  assert.equal(declarations('.ui-file-editor-tab[data-active="true"]').color, val("text"));
  assert.match(read("src/features/files/components/FileEditorTabs.tsx"), /data-active=\{active \? "true" : "false"\}/);
  assert.equal(declarations('.ui-terminal-navigation-result:hover:not([aria-selected="true"])').background, val("hover"));
  assert.equal(declarations('.ui-terminal-navigation-result[aria-selected="true"]').background, val("selected"));
});

test("Resting chrome uses two levels without separate icon boxes; fields retain contrast", () => {
  for (const cls of [".ui-icon-action:not([data-active=\"true\"])", ".ui-toolbar-button:not([data-active=\"true\"])"]) {
    assert.equal(declarations(cls).background, "transparent");
    assert.equal(declarations(cls)["box-shadow"], "none");
  }
  for (const cls of [".ui-config-modal", ".ui-input", ".ui-tree-inline-input", ".ui-collapsed-flyout", '.ui-surface-card[role="dialog"]']) {
    assert.equal(declarations(cls).background, val("surface"), cls);
  }
  assert.equal(declarations('.ui-input')["border-color"], val("control-border"));
  assert.equal(declarations('.ui-terminal-tab-row-main:focus-visible')["outline-width"], "2px");
  assert.equal(declarations('.ui-file-editor-tab button:focus-visible')["outline-style"], "solid");
});

test("Native, Radix and ARIA disabled controls are explicit; danger is not recolored", () => {
  const disabled = ':is(.ui-btn, .ui-icon-action, .ui-toolbar-button, .ui-flat-action, .ui-segmented-btn, .ui-terminal-tab-row-scroll, .ui-input, .ui-tree-inline-input):is(:disabled, [data-disabled], [aria-disabled="true"])';
  assert.equal(declarations(disabled).background, "transparent");
  assert.equal(declarations(disabled).color, val("muted"));
  const menu = '.context-menu:not(.terminal-context-menu):not(.ui-file-editor-tab-menu) .context-menu-item';
  assert.equal(declarations(`${menu}:is(:disabled, [data-disabled], [aria-disabled="true"])`).background, "transparent");
  assert.equal(declarations(`${menu}:not(.danger)[data-highlighted]:not([data-disabled])`).background, val("hover"));
  assert.match(read('src/shared/ui/context-menu.tsx'), /danger && "danger"/);
  chrome.walkRules(rule => {
    if (rule.selector.includes('.context-menu-item') && rule.nodes.some(n => n.prop === 'color' && n.value === val('text'))) {
      assert.ok(rule.selector.includes(':not(.danger)'));
    }
    assert.doesNotMatch(rule.selector, /\.danger(?=[\s:{])|native-provider-control--(?:danger|success)|node-accent|data-node-color/);
  });
});

test("Storm marker targets only emitted focus strokes and preserves both user styles/status colors", () => {
  const source = read('src/features/terminal/components/PaneLeafView.tsx');
  assert.match(source, /isSplitLayout: allPanes.length > 1/);
  assert.match(source, /isLayoutVisible: isLayoutVisible && !historyActive/);
  assert.match(source, /\{paneMarker && \([\s\S]*className="ui-terminal-pane-marker"/);
  assert.match(source, /data-marker-style=\{paneMarkerStyle\}/);
  assert.match(source, /data-marker-status=\{paneMarker.status\}/);
  for (const style of ['full', 'tab-top']) {
    assert.deepEqual(declarations(`.ui-terminal-pane-marker[data-marker-style="${style}"][data-marker-status="focus"] > span`), { background: val('solid') });
  }
  chrome.walkRules(rule => {
    if (rule.selector.includes('.ui-terminal-pane-marker')) {
      rule.selectors.forEach(selector => assert.match(selector, /data-marker-status="focus"\] > span$/));
      assert.deepEqual(rule.nodes.filter(n => n.type === 'decl').map(n => n.prop), ['background']);
    }
    assert.doesNotMatch(rule.selector, /\.ui-terminal-pane(?=[:\s,{])|\.ui-terminal-pane-content(?=[:\s,{])/);
  });
  // Execute the production resolver, not a duplicated fixture implementation.
  const output = ts.transpileModule(read('src/shared/lib/terminalPaneMarker.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports){${output}
})`, {}, { timeout: 1000 })(module.exports);
  const { resolveTerminalPaneMarker: resolve, DEFAULT_TERMINAL_PANE_MARKER_SETTINGS: defaults } = module.exports;
  const input = { isLayoutVisible: true, isSplitLayout: true, isAppFocused: true, isPaneFocused: true, isMainSession: true, hookStatus: 'none', settings: { ...defaults, enabled: true } };
  assert.equal(defaults.enabled, false);
  for (const change of [{ settings: defaults }, { isSplitLayout: false }, { isLayoutVisible: false }, { isAppFocused: false }, { isPaneFocused: false }]) {
    assert.equal(resolve({ ...input, ...change }), null);
  }
  for (const style of ['full', 'tab-top']) {
    const settings = { ...input.settings, style, doneColor: '#112233', failedColor: '#445566', attentionColor: '#778899' };
    assert.equal(resolve({ ...input, settings }).status, 'focus');
    for (const hookStatus of ['done', 'failed', 'attention']) {
      assert.equal(resolve({ ...input, settings, hookStatus }).color, settings[`${hookStatus}Color`]);
    }
  }
});
