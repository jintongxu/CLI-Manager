import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scope = '[data-theme="dark"][data-dark-palette="graphite"]';
const themes = postcss.parse(read("src/styles/themes.css"));
const chrome = postcss.parse(read("src/styles/components/graphite.css"));
const palette = themes.nodes.find((node) => node.selector === scope);
const tokens = Object.fromEntries(palette.nodes.map(({ prop, value }) => [prop, value]));

test("Graphite palette is additive, dark-only and separates emphasis from solid actions", () => {
  assert.equal(tokens["--bg-primary"], "#292c33");
  assert.equal(tokens["--bg-secondary"], "#32363f");
  assert.equal(tokens["--bg-tertiary"], "#3b404b");
  assert.equal(tokens["--surface-container-highest"], "#444b58");
  assert.equal(tokens["--text-primary"], "#eef0f6");
  assert.equal(tokens["--text-muted"], "#bdc5d4");
  assert.equal(tokens["--border"], "#596171");
  assert.equal(tokens["--accent"], "#aec8ff");
  assert.equal(tokens["--graphite-solid"], "#416ee8");
  assert.equal(tokens["--primary-gradient-start"], "var(--graphite-solid)");
  assert.equal(tokens["--primary-gradient-end"], "var(--graphite-solid)");
  assert.ok(themes.nodes.some((n) => n.selector?.includes('data-dark-palette="graphite-red"')));
});

test("Graphite chrome is fully scoped and does not mutate layout, fonts or content themes", () => {
  chrome.walkRules((rule) => {
    for (const selector of rule.selectors) assert.ok(selector.startsWith(`${scope} `), selector);
    assert.doesNotMatch(rule.selector, /\.monaco|\.xterm|\.terminal-skin|data-term-stats-skin/);
  });
  const allowed = /^(?:--terminal-(?:tab-|chrome-)|background(?:-color)?$|border-(?:color|radius)$|outline-color$|box-shadow$|color$|filter$)/;
  chrome.walkDecls((decl) => {
    assert.match(decl.prop, allowed);
    assert.ok(!decl.important);
  });
  palette.walkDecls((decl) => assert.doesNotMatch(decl.prop, /^--(?:term-|terminal-|font-)/));
  const imports = read("src/styles/components.css").trim().split(/\r?\n/);
  const graphite = '@import "./components/graphite.css";';
  assert.equal(imports.filter((line) => line === graphite).length, 1);
  assert.ok(imports.indexOf(graphite) > imports.indexOf('@import "./components/cream-forest.css";'));
});

test("Graphite default text, muted labels, emphasis and filled buttons meet AA contrast", () => {
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const fg of ["--text-primary", "--text-muted", "--accent"]) {
    for (const bg of ["--bg-primary", "--bg-secondary", "--bg-tertiary", "--surface-container-highest"]) {
      assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${fg} on ${bg}`);
    }
  }
  for (const bg of ["--graphite-solid", "--graphite-solid-hover"]) {
    assert.ok(contrast("#ffffff", tokens[bg]) >= 4.5, `white on ${bg}`);
  }
});
