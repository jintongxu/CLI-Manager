// Static production-CSS reference, not a running application or an xterm instance.
import { compile } from '@tailwindcss/node';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'lightningcss';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = readFileSync(resolve(root, 'src/shared/lib/terminalThemes.ts'), 'utf8');
const ast = ts.createSourceFile('terminalThemes.ts', source, ts.ScriptTarget.Latest, true);
let initializer;
for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(ast) === 'tokyoNightStormOfficial') {
      initializer = declaration.initializer?.getText(ast);
    }
  }
}
if (!initializer) throw new Error('Missing production tokyoNightStormOfficial ITheme');
const theme = vm.runInNewContext(ts.transpile(`(${initializer})`), {}, { timeout: 1000 });
const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const ansiKeys = [...ansi, ...ansi.map(key => `bright${key[0].toUpperCase()}${key.slice(1)}`)];
for (const key of ['background', 'foreground', 'cursor', ...ansiKeys]) {
  if (!/^#[\da-f]{6}$/i.test(theme[key])) throw new Error(`Invalid production theme field ${key}`);
}

// Render the real TSX TerminalTabRow, with real React and dnd-kit. App-only context
// adapters avoid starting stores/native bridges. The real scroll hook is SSR-safe.
const cache = new Map();
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const localRequire = name => {
    if (name.endsWith('/i18n/index')) return { useI18n: () => ({ t: key => key }) };
    if (name.endsWith('/terminalTabsModel')) {
      return { buildTerminalTabContext: () => ({ projectColor: theme.blue }) };
    }
    if (name.endsWith('/currentWorkPresentation')) {
      return { formatTerminalTabContext: () => 'cli-manager · main · PowerShell' };
    }
    if (name.endsWith('/dragInteraction')) {
      return { DND_SORTABLE_TRANSITION: undefined,
        CURRENT_WORK_TAB_DRAG_PREFIX: 'current-work:', TERMINAL_TAB_DRAG_PREFIX: 'terminal:' };
    }
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(file), name);
    const found = ['.ts', '.tsx'].map(ext => base + ext).find(existsSync);
    if (!found) throw new Error(`Unresolved fixture import ${name}`);
    return loadTs(found);
  };
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {}, { timeout: 1000 })(
    localRequire, module, module.exports,
  );
  return module.exports;
}
const { TerminalTabRow } = loadTs(resolve(root, 'src/features/terminal/components/TerminalTabRow.tsx'));
const entries = ['Claude Code', 'PowerShell', 'Build watcher'].map((title, index) => ({
  id: `storm-session-${index}`, session: { id: `storm-session-${index}`, title },
}));
const tabRow = renderToStaticMarkup(React.createElement(TerminalTabRow, {
  entries, activeId: entries[0].id, mode: 'ordinary', sortable: false,
  contextLabels: { unboundProject: 'cli-manager', missingWorktree: 'Missing', defaultShell: 'Shell' },
  onActivate() {}, onClose() {}, closeLabel: title => `Close ${title}`, ariaLabel: 'Terminal tabs',
})).replaceAll('><', '>\n<');

const imports = ['tailwindcss', './src/styles/themes.css', './src/styles/components.css',
  './src/features/terminal/components/terminalNavigation.css'];
const compiler = await compile(imports.map(path => `@import "${path}";`).join('\n'), {
  base: root, onDependency() {},
});
const productionCss = compiler.build(['flex', 'flex-col', 'items-center', 'gap-2']);
// Keep generated source reviewable and below 500 characters per line, without
// changing CSS semantics. Lightning CSS preserves the production selector cascade.
const minified = transform({ filename: 'production.css', code: Buffer.from(productionCss),
  minify: true }).code.toString();
function wrapCss(css) {
  let line = '';
  const lines = [];
  let token = '';
  let quote = '';
  let escaped = false;
  const flush = () => {
    if (line.length + token.length > 480) { lines.push(line); line = ''; }
    line += token;
    token = '';
  };
  for (const char of css) {
    token += char;
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if ('{};,'.includes(char)) flush();
  }
  flush();
  if (line) lines.push(line);
  return lines.join('\n');
}
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const iconPaths = {
  terminal: '<path d="m4 6 6 6-6 6m9 0h7"/>',
  folder: '<path d="M3 7V4h6l2 3h10v13H3Z"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/>'
    + '<circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-5h6a6 6 0 0 0 6-4"/>',
  files: '<path d="M8 3h8l4 4v14H8Zm8 0v5h4M4 7v14"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/>'
    + '<circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
};
const icon = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
 stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
 aria-hidden="true">${iconPaths[name]}</svg>`;
const label = (zh, en) => `<span data-zh="${escape(zh)}" data-en="${escape(en)}">${zh}</span>`;
const treeTerminal = (title, selected = false) => `<button class="sidebar-terminal-row"
 data-selected="${selected}" data-status="running">${icon('terminal')}
 <span class="sidebar-terminal-heading"><span class="sidebar-terminal-title-line">${title}</span>
 <span class="sidebar-terminal-metadata">${label('运行中 · 本地', 'Running · Local')}</span></span></button>`;
const rail = ['files', 'search', 'branch', 'history', 'split', 'settings'].map((name, i) => `
 <div class="ui-terminal-action-sort-item" data-tooltip="${name}">
 <button class="ui-icon-action" id="rail-${name}" aria-label="${name}"
 ${i === 0 ? 'data-active="true"' : ''}>${icon(name)}</button></div>`).join('');
const terminalVariables = Object.entries(theme).map(([key, value]) => `--ansi-${key}:${value};`).join('\n');
const swatches = ansiKeys.map(key => `<span class="ansi-swatch" style="color:var(--ansi-${key})"
 title="${key}: ${theme[key]}">██<small>${key}</small></span>`).join('\n');

const skeleton = `
/* Fixture geometry only. Production classes above own all application chrome colors. */
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.5 var(--font-ui-sans); color: var(--text-primary); }
.fixture-controls { display: flex; gap: 16px; align-items: center; padding: 10px 18px;
 background: var(--surface-container-lowest); color: var(--text-secondary); }
.fixture-controls strong { margin-right: auto; font-size: 12px; font-weight: 500; }
.fixture-shell { margin: 16px; min-width: 900px; height: calc(100vh - 78px); min-height: 680px;
 display: grid; grid-template-rows: 36px 1fr; overflow: hidden; }
.fixture-title { display: flex; align-items: center; gap: 12px; padding: 0 14px; }
.fixture-title small { margin-left: auto; }
.fixture-workspace { display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 0; }
.fixture-sidebar { display: flex; flex-direction: column; min-height: 0; }
.fixture-sidebar-head { padding: 16px 12px 10px; display: grid; gap: 12px; }
.fixture-sidebar-body { flex: 1; padding: 0 8px; }
.fixture-sidebar-foot { display: flex; align-items: center; gap: 10px; padding: 12px; }
.fixture-project, .fixture-worktree { display: flex; align-items: center; gap: 8px;
 padding: 8px; width: 100%; text-align: left; }
.fixture-worktree { margin-left: 12px; width: calc(100% - 12px); }
.fixture-section-label { padding: 18px 8px 8px; font-size: 11px; color: var(--text-muted); }
.fixture-main { display: grid; grid-template-rows: 46px minmax(0, 1fr); min-width: 0; }
.fixture-navigation { display: flex; align-items: center; padding: 5px 12px; }
.fixture-pane { display: grid; grid-template-columns: minmax(0, 1fr) 48px; min-height: 0; }
.fixture-content { display: grid; grid-template-rows: minmax(260px, 1fr) auto; min-width: 0; }
.fixture-terminal { padding: 26px 28px; overflow: auto; background: var(--ansi-background);
 color: var(--ansi-foreground); font: 13px/1.8 var(--font-ui-mono); }
.fixture-terminal pre { margin: 0; font: inherit; white-space: pre-wrap; }
.fixture-terminal ::selection { background: var(--ansi-selectionBackground); }
.fixture-ansi { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
.ansi-swatch { display: inline-flex; flex-direction: column; font-size: 15px; }
.ansi-swatch small { font-size: 9px; }
.fixture-cursor { display: inline-block; width: 8px; height: 16px;
 background: var(--ansi-cursor); vertical-align: middle; }
.fixture-settings { margin: 16px; padding: 18px 20px; }
.fixture-settings h2 { margin: 0 0 4px; font-size: 16px; }
.fixture-settings p { margin: 0 0 16px; color: var(--text-muted); }
.fixture-setting-row { display: flex; align-items: center; gap: 18px; margin-top: 12px; }
.fixture-setting-row > label { margin-right: auto; }
.fixture-rail { padding-top: 12px; }
.fixture-rail .ui-terminal-action-sort-item:last-child { margin-top: auto; margin-bottom: 12px; }
.fixture-collapsed { display: none; padding: 10px; }
[data-sidebar-collapsed="true"] .fixture-workspace { grid-template-columns: 56px minmax(0, 1fr); }
[data-sidebar-collapsed="true"] .fixture-expanded { display: none; }
[data-sidebar-collapsed="true"] .fixture-collapsed { display: grid; gap: 10px; }
@media (max-height: 850px) { .fixture-terminal { padding: 18px 24px; } }
`;
const html = `<!doctype html>
<html lang="zh-CN" data-theme="dark" data-dark-palette="tokyo-night-storm">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tokyo Night Storm — production stylesheet reference</title>
<style id="production-styles">
${wrapCss(minified)}
</style><style id="fixture-layout">
${skeleton}
#terminal-output {
${terminalVariables}
}
</style></head><body>
<header class="fixture-controls" id="fixture-controls">
<strong>${label('静态外观参考 · 真实生产 CSS / 非运行应用', 'Static appearance reference · Production CSS / not the live app')}</strong>
<button id="language-toggle" class="ui-btn ui-btn-outline" type="button">English</button>
<button id="sidebar-toggle" class="ui-btn ui-btn-outline" type="button" aria-pressed="false">
${label('折叠侧栏', 'Collapse sidebar')}</button></header>
<div id="storm-reference" class="fixture-shell ui-workspace-shell" data-sidebar-collapsed="false">
<header class="window-titlebar fixture-title">${icon('terminal')}<strong>CLI Manager</strong>
<small>Tokyo Night Storm · ${label('静态示例', 'Static sample')}</small><span>−　□　×</span></header>
<div class="fixture-workspace">
<aside id="project-sidebar" class="ui-sidebar-shell fixture-sidebar" aria-label="Projects">
<div class="fixture-collapsed"><button class="ui-tree-collapsed-item" data-selected="true"
 aria-label="cli-manager">${icon('folder')}</button>${icon('terminal')}${icon('settings')}</div>
<div class="fixture-expanded ui-sidebar-top fixture-sidebar-head">
<strong>${label('项目', 'Projects')}</strong>
<input class="ui-input" aria-label="Search projects" placeholder="cli-manager" readonly></div>
<div class="fixture-expanded fixture-sidebar-body">
<button id="selected-project" class="ui-tree-node ui-tree-project fixture-project"
 data-selected="true" data-accent="true">${icon('folder')}cli-manager <span>⌄</span></button>
<button class="ui-worktree-row fixture-worktree" data-selected="true">${icon('branch')}main</button>
<div class="sidebar-terminal-list">${treeTerminal('Claude Code', true)}${treeTerminal('PowerShell')}</div>
<button class="ui-worktree-row fixture-worktree">${icon('branch')}feature/appearance</button>
<div class="sidebar-terminal-list">${treeTerminal('Build watcher')}</div>
<div class="fixture-section-label">${label('其他项目', 'Other projects')}</div>
<button class="ui-tree-node ui-tree-project fixture-project">${icon('folder')}design-system</button>
<button class="ui-tree-node ui-tree-project fixture-project">${icon('folder')}web-client</button>
</div><footer class="fixture-expanded ui-sidebar-footer fixture-sidebar-foot">
${icon('settings')}${label('设置与偏好', 'Settings & preferences')}</footer></aside>
<main class="ui-main-shell fixture-main">
<div id="terminal-navigation" class="ui-terminal-pane-chrome fixture-navigation">
${tabRow}
</div><div class="fixture-pane">
<div class="fixture-content">
<section id="terminal-output" class="fixture-terminal" aria-label="Static terminal output">
<pre><span style="color:var(--ansi-cyan)">╭─ CLI Manager / cli-manager</span>
<span style="color:var(--ansi-brightBlack)">│  Tokyo Night Storm (Official) · mock terminal, not xterm</span>
<span style="color:var(--ansi-cyan)">╰─</span> <span style="color:var(--ansi-green)">main</span> <span style="color:var(--ansi-blue)">~/workspace/cli-manager</span>

<span style="color:var(--ansi-magenta)">❯</span> npm run build
<span style="color:var(--ansi-brightBlack)">&gt; tsc &amp;&amp; vite build</span>

<span style="color:var(--ansi-green)">✓</span> 284 modules transformed. <span style="color:var(--ansi-brightBlack)">[illustrative output]</span>
<span style="color:var(--ansi-yellow)">!</span> Static sample — no command was executed here.
<span style="color:var(--ansi-cyan)">dist/index.html</span>              0.78 kB
<span style="color:var(--ansi-cyan)">dist/assets/index.js</span>       426.12 kB
<span style="color:var(--ansi-green)">✓ built in 2.14s</span>

<span style="color:var(--ansi-magenta)">❯</span> <span class="fixture-cursor"></span></pre>
<div id="ansi-swatches" class="fixture-ansi">${swatches}</div></section>
<section id="settings-sample" class="ui-config-modal fixture-settings" aria-labelledby="settings-heading">
<h2 id="settings-heading">${label('外观设置', 'Appearance settings')}</h2>
<p>${label('只读示例 · 不修改任何应用设置', 'Read-only sample · does not change app settings')}</p>
<div class="fixture-setting-row"><label>${label('应用主题', 'Application theme')}</label>
<div class="ui-segmented"><button class="ui-segmented-btn">${label('浅色', 'Light')}</button>
<button class="ui-segmented-btn" data-active="true">${label('深色', 'Dark')}</button></div></div>
<div class="fixture-setting-row"><label>${label('配色方案', 'Color scheme')}</label>
<button class="ui-btn ui-btn-outline">Tokyo Night Storm ▾</button></div>
<div class="fixture-setting-row"><label>${label('终端主题', 'Terminal theme')}</label>
<button class="ui-btn ui-btn-outline">${label('自动', 'Auto')} · Tokyo Night Storm (Official)</button></div>
<div class="fixture-setting-row"><span>${label('生产按钮状态示例', 'Production button state sample')}</span>
<button id="primary-sample" class="ui-btn ui-btn-primary">${label('主要操作', 'Primary action')}</button>
<button class="ui-btn ui-btn-outline" disabled>${label('不可用', 'Disabled')}</button></div>
</section></div>
<nav id="action-rail" class="ui-terminal-actions ui-terminal-action-sidebar fixture-rail flex flex-col items-center gap-2"
 data-dock-side="right" aria-label="Static action rail">${rail}</nav>
</div></main></div></div>
<script id="fixture-interactions">
const language = document.getElementById('language-toggle');
language.addEventListener('click', () => {
  const en = document.documentElement.lang !== 'en';
  document.documentElement.lang = en ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-zh][data-en]').forEach(node => {
    node.textContent = en ? node.dataset.en : node.dataset.zh;
  });
  language.textContent = en ? '中文' : 'English';
});
document.getElementById('sidebar-toggle').addEventListener('click', event => {
  const shell = document.getElementById('storm-reference');
  const collapsed = shell.dataset.sidebarCollapsed !== 'true';
  shell.dataset.sidebarCollapsed = String(collapsed);
  event.currentTarget.setAttribute('aria-pressed', String(collapsed));
});
</script></body></html>
`;
const output = resolve(root, 'design-previews/app-theme/storm-production-reference.html');
const lines = html.split('\n');
if (lines.some(line => line.length > 500)) throw new Error('Generated HTML exceeds 500 characters per line');
if (lines.length >= 2000) throw new Error(`Generated HTML exceeds line budget: ${lines.length}`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html);
console.log(pathToFileURL(output).href);
console.log(`Production CSS reference: ${lines.length} lines; real TerminalTabRow SSR; ${ansiKeys.length} ANSI colors.`);
