import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const scope = '[data-theme="dark"][data-dark-palette="tokyo-night-storm"] .ui-sidebar-shell';
const path = 'src/styles/components/tokyo-night-storm-sidebar.css';
const css = postcss.parse(read(path));
const rules = [];
css.walkRules(rule => rules.push(rule));
const rule = selector => rules.find(r => r.selectors.includes(`${scope} ${selector}`));
const declarations = selector => Object.fromEntries(rule(selector)?.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value]) ?? []);
const rows = ':is(.ui-tree-project, .ui-tree-group, .ui-tree-collapsed-item, .ui-pinned-project-item, .sidebar-terminal-row)';
const selected = ':is(.ui-tree-project, .ui-tree-group, .ui-tree-collapsed-item, .sidebar-terminal-row)[data-selected="true"]';

test('Sidebar module is additive, last, dark Storm only; no geometry or semantic mutation', () => {
  const manifest = read('src/styles/components.css');
  assert.equal(manifest.match(/tokyo-night-storm-sidebar.css/g)?.length, 1);
  assert.ok(manifest.trimEnd().endsWith('@import "./components/tokyo-night-storm-sidebar.css";'));
  const before = manifest.slice(0, manifest.indexOf('@import "./components/tokyo-night-storm-sidebar.css";'));
  assert.ok(before.trimEnd().endsWith('@import "./components/tokyo-night-storm.css";'));
  for (const r of rules) for (const selector of r.selectors) assert.ok(selector.startsWith(`${scope} `), selector);
  css.walkDecls(d => {
    assert.match(d.prop, /^(background|border-color|box-shadow|color|transform|display|visibility|opacity|pointer-events|outline|outline-offset)$/);
    if (['display', 'visibility', 'opacity', 'pointer-events'].includes(d.prop)) {
      assert.ok(d.parent.selector.endsWith('.ui-tree-item-actions'));
      assert.notEqual(d.value, 'hidden');
      if (d.prop === 'display') assert.notEqual(d.value, 'none', 'Actions cannot leave tab order');
    }
    assert.doesNotMatch(d.prop, /^(?:font|width|height|padding|margin|gap|order)(?:-|$)/);
  });
  assert.doesNotMatch(read(path), /--node-accent\s*:|--term-[\w-]+\s*:/);
});

test('Selectors reflect actual tree/group/pinned/worktree DOM and state contracts', () => {
  const tree = read('src/features/projects/components/TreeNodeItem.tsx');
  const pinned = read('src/features/projects/components/PinnedProjectSection.tsx');
  const root = read('src/features/projects/components/ProjectTree.tsx');
  const terminal = read('src/features/projects/components/SidebarTerminalList.tsx');
  for (const cls of ['ui-tree-node', 'ui-tree-project', 'ui-tree-group', 'ui-worktree-row', 'ui-tree-item-actions', 'ui-tree-meta-chip', 'ui-tree-warning-chip']) assert.ok(tree.includes(cls), cls);
  assert.match(tree, /ui-tree-node ui-tree-project ui-worktree-row/);
  assert.match(tree, /ui-tree-item-actions hidden/); // CSS must beat this legacy utility.
  for (const attr of ['data-selected', 'data-open', 'data-invalid', 'data-accent', 'data-drop-target']) assert.ok(tree.includes(attr), attr);
  assert.ok(pinned.includes('ui-pinned-project-item'));
  assert.ok(pinned.includes('aria-selected='));
  assert.ok(root.includes('ui-tree-collapsed-item'));
  for (const cls of ['sidebar-terminal-row', 'sidebar-terminal-icon', 'sidebar-terminal-status']) assert.ok(terminal.includes(cls));
  assert.match(terminal, /data-selected=/);
  const sidebar = read('src/features/projects/components/SidebarView.tsx');
  assert.ok(sidebar.includes('ui-sidebar-shell'));
});

test('Resting rows/open groups are transparent; hover, selection, focus and drop remain distinct', () => {
  assert.equal(declarations(rows).background, 'transparent');
  assert.equal(declarations('.ui-tree-group[data-open="true"]').background, 'transparent');
  assert.equal(declarations(`${rows}:hover`).background, 'var(--storm-hover)');
  for (const selector of [selected, `${selected}:hover`, '.ui-tree-group[data-selected="true"][data-open="true"]', '.ui-pinned-project-item[aria-selected="true"]:hover']) {
    assert.equal(declarations(selector).background, 'var(--storm-selected)');
    assert.equal(declarations(selector)['box-shadow'], 'inset 2px 0 0 var(--storm-solid)');
  }
  assert.equal(declarations('.ui-tree-node[data-accent="true"][data-selected="true"]')['box-shadow'], 'none');
  assert.equal(declarations('.ui-tree-group[data-drop-target="true"]')['border-color'], 'var(--storm-solid)');
  const focus = rules.find(r => r.selector.includes('.icon-btn):focus-visible'));
  assert.equal(focus.nodes.find(n => n.prop === 'outline').value, '2px solid var(--storm-solid)');
  assert.ok(!focus.nodes.some(n => n.prop === 'box-shadow'));
});

test('Actions remain keyboard-enterable, reveal on focus/hover and visible on no-hover/coarse input', () => {
  const normal = rules.find(r => r.selector === `${scope} .ui-tree-item-actions` && r.parent.type === 'root');
  const values = Object.fromEntries(normal.nodes.map(n => [n.prop, n.value]));
  assert.equal(values.display, 'flex');
  assert.equal(values.visibility, 'visible');
  assert.equal(values.opacity, '0');
  assert.equal(values['pointer-events'], 'none');
  const reveal = declarations(':is(.ui-tree-node, .ui-pinned-project-item):is(:hover, :focus-within) .ui-tree-item-actions');
  assert.equal(reveal.opacity, '1');
  assert.equal(reveal['pointer-events'], 'auto');
  const media = css.nodes.find(n => n.type === 'atrule');
  assert.equal(media.params, '(hover: none), (pointer: coarse)');
  assert.ok(media.nodes[0].nodes.some(n => n.prop === 'opacity' && n.value === '1'));
  // Legacy base hides visibility and group utility hides display; the new scope
  // carries 2 attributes + shell + actions (0,4,0), above either old rule.
  assert.match(read('src/styles/components/project-tree.css'), /\.ui-tree-item-actions \{[\s\S]*?visibility: hidden/);
  assert.equal((normal.selector.match(/\[data-/g) ?? []).length + (normal.selector.match(/\.ui-/g) ?? []).length, 4);
});

test('Warning/lifecycle/membership colors are not muted or hidden; invalid borders survive', () => {
  for (const r of rules) assert.doesNotMatch(r.selector, /ui-tree-warning-chip|sidebar-terminal-status|sidebar-terminal-membership|worktree-terminal-membership/);
  assert.equal(declarations('.ui-tree-project[data-invalid="true"]:not([data-selected="true"])')['border-color'], 'color-mix(in srgb, var(--danger) 22%, transparent)');
  assert.ok(rule('.ui-worktree-row:not([data-invalid="true"]) .ui-worktree-tree-icon'));
  assert.equal(declarations('.ui-tree-meta-chip').color, 'var(--storm-secondary)');
  assert.equal(declarations('.ui-tree-status-dot')['box-shadow'], 'none');
});

test('Ordered production stylesheet preprocessing accepts the sidebar module', async () => {
  const { preprocessCSS, resolveConfig } = await import('vite');
  const config = await resolveConfig({ configFile: false }, 'build');
  const result = await preprocessCSS(read('src/styles/components.css'), new URL('../src/styles/components.css', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), config);
  assert.ok(result.code.includes(`${scope} .ui-tree-item-actions`));
  assert.ok(result.code.indexOf(`${scope} .ui-tree-item-actions`) > result.code.indexOf('.ui-tree-item-actions {'));
});
