import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext, runInContext } from "node:vm";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scope = '[data-theme="light"][data-light-palette="cream-forest"]';
const themes = postcss.parse(read("src/styles/themes.css"));
const chrome = postcss.parse(read("src/styles/components/cream-forest.css"));
const palette = themes.nodes.find((node) => node.selector === scope);
const tokens = Object.fromEntries(palette.nodes.map(({ prop, value }) => [prop, value]));

function contrast(a, b) {
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("Cream Forest is cream-white/apricot/forest, additive after light semantic bridges", () => {
  assert.equal(tokens["--bg-primary"], "#FFF9EE");
  assert.equal(tokens["--bg-secondary"], "#F5E6CF");
  assert.equal(tokens["--bg-tertiary"], "#FFFCF5");
  assert.equal(tokens["--accent"], "#286044");
  assert.equal(tokens["--interactive-selected-bg"], "#DEECD9");
  assert.equal(tokens["--surface-container-low"], "#F5E6CF");
  assert.equal(tokens["--surface-container-high"], "#FFFCF5");
  assert.ok(themes.nodes.indexOf(palette) > themes.nodes.findLastIndex((n) => n.selector === '[data-theme="light"]'));
  for (const name of ["cream-green", "graphite", "graphite-red"]) {
    assert.ok(themes.nodes.some((n) => n.selector?.includes(`="${name}"`)));
  }
});

test("Every chrome selector is scoped; layout, fonts, terminal and content skins are untouched", () => {
  chrome.walkRules((rule) => {
    rule.selectors.forEach((selector) => assert.ok(selector.startsWith(`${scope} `), selector));
    assert.doesNotMatch(rule.selector, /\.monaco|\.xterm|\.terminal-skin|data-term-stats-skin/);
  });
  const allowed = /^(?:--terminal-(?:tab-|chrome-)|background(?:-color)?$|border-(?:color|radius)$|outline-color$|box-shadow$|color$|filter$)/;
  chrome.walkDecls((decl) => {
    assert.match(decl.prop, allowed);
    assert.ok(!decl.important);
    if (decl.prop === "border-radius") assert.match(decl.value, /^[68]px$/);
  });
  palette.walkDecls((decl) => assert.doesNotMatch(decl.prop, /^--(?:term-|terminal-|font-)/));
  const imports = read("src/styles/components.css").trim().split(/\r?\n/);
  const position = (name) => imports.indexOf(`@import "./components/${name}.css";`);
  assert.ok(position("file-editor") >= 0);
  assert.ok(position("cream-forest") > position("file-editor"));
  assert.ok(position("graphite") > position("cream-forest"));
});

test("Text including muted labels meets AA on every warm interaction surface", () => {
  for (const fg of ["--text-primary", "--text-secondary", "--text-muted", "--accent"]) {
    for (const bg of ["--bg-primary", "--bg-secondary", "--bg-tertiary", "--interactive-hover-bg", "--interactive-selected-bg"]) {
      assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${fg} on ${bg}: ${contrast(tokens[fg], tokens[bg])}`);
    }
  }
  for (const bg of ["--cream-forest-solid", "--cream-forest-solid-hover"]) {
    assert.ok(contrast("#FFFFFF", tokens[bg]) >= 4.5);
  }
  // Border is decorative; focus/selected indicators are forest, not the pale separator.
  for (const bg of ["--bg-primary", "--bg-secondary", "--interactive-selected-bg"]) {
    assert.ok(contrast(tokens["--interactive-focus-ring"], tokens[bg]) >= 3);
  }
  assert.ok(contrast(tokens["--cream-forest-control-border"], tokens["--bg-tertiary"]) >= 3);
});

test("Real application chrome coverage uses stable aliases even inside content-theme remaps", () => {
  for (const selector of [".window-titlebar", ".ui-sidebar-shell", ".ui-tree-project", ".sidebar-terminal-row",
    ".ui-worktree-row", ".ui-terminal-pane-chrome", ".ui-tab-trigger", ".ui-terminal-action-sidebar",
    ".ui-btn-primary", ".ui-input", ".context-menu", ".ui-config-modal", ".ui-file-editor-header",
    ".ui-file-editor-tabs", ".ui-history-sidebar-top", ".ui-history-detail-top", ".ui-stats-panel-header"]) {
    assert.ok(chrome.nodes.some((n) => n.selector?.includes(selector)), selector);
  }
  chrome.walkDecls((decl) => {
    for (const [, variable] of decl.value.matchAll(/var\((--[^)]+)\)/g)) {
      assert.ok(variable.startsWith("--cream-forest-"), variable);
      assert.ok(tokens[variable], variable);
    }
  });
  assert.ok(chrome.nodes.some((n) => n.selector?.includes('.ui-tab-trigger:focus-visible')));
});

const preview = "design-previews/app-theme/cream-forest";
test("Preview has independent actual layout assets and valid CSS/JS, no application side effects", () => {
  const html = read(`${preview}.html`);
  const js = read(`${preview}.js`);
  postcss.parse(read(`${preview}.css`));
  new Script(js);
  for (const landmark of ["titlebar", "project-sidebar", "project-tree", "workspace-tabs", "terminal", "icon-rail"]) {
    assert.ok(html.includes(landmark), landmark);
  }
  assert.match(html, /href="cream-forest.css"/);
  assert.match(html, /src="cream-forest.js"/);
  assert.doesNotMatch(html, /real-layout\.(?:css|js)|graphite|dashboard/i);
  assert.doesNotMatch(js, /fetch\(|WebSocket|localStorage|sessionStorage|invoke\(|import\s|pty_create|location\s*=/);
});

test("Preview actually switches both terminal illustrations and zh/en copy locally", () => {
  class Element {
    constructor() { this.dataset = {}; this.children = []; this.attrs = {}; this.value = ""; this.events = {}; }
    setAttribute(key, value) { this.attrs[key] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.events[name] = fn; }
  }
  const ids = new Map();
  const get = (name) => {
    if (!ids.has(name)) ids.set(name, new Element());
    return ids.get(name);
  };
  get("language").value = "zh-CN";
  get("terminal-mode").value = "dark";
  const label = new Element(); label.dataset.i18n = "projects";
  const document = {
    body: new Element(), documentElement: new Element(),
    getElementById: get, querySelector: get, querySelectorAll: () => [label],
    createElement: () => new Element(), createElementNS: () => new Element()
  };
  const context = createContext({ document });
  runInContext(read(`${preview}.js`), context);
  assert.equal(document.body.dataset.terminal, "dark");
  assert.equal(label.textContent, "项目");
  assert.equal(get("icon-rail").children.length, 13);
  get("language").value = "en";
  get("language").events.change();
  assert.equal(label.textContent, "Projects");
  assert.match(get("preview-note").textContent, /Keep dark terminal/);
  get("terminal-mode").value = "auto";
  get("terminal-mode").events.change();
  assert.equal(document.body.dataset.terminal, "auto");
  assert.match(get("preview-note").textContent, /Warm-light auto illustration/);
  get("language").value = "zh-CN";
  get("language").events.change();
  assert.match(get("preview-note").textContent, /暖浅 auto 示意/);
});
