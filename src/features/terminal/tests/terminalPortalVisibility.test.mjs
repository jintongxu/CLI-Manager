import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../components/PaneLeafView.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture(hidden, removed = false, overrides = {}, sessionOverrides = {}) {
  const exports = {}, activated = [];
  const session = { id: 's', kind: 'pty', tabHidden: hidden, ...sessionOverrides };
  const store = { activeSessionId: null, sessions: removed ? [] : [session] };
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return { memo: fn => fn, Suspense: 'Suspense' };
    if (name === '../state') return { useTerminalStore: { getState: () => store } };
    if (name.includes('terminalPaneMarker')) return { resolveTerminalPaneMarker: () => null };
    if (name.includes('TerminalCliContext')) return { createTerminalCliContext: () => ({}), isPiTerminalContext: () => false };
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  const pane = { id: 'p', type: 'leaf', sessionIds: ['s'], activeSessionId: 's' };
  const tree = exports.PaneLeafView({
    pane, allPanes: [pane], sessions: removed ? [] : [session], projects: [], worktrees: [], visibleSessionIds: new Set(hidden || removed ? [] : ['s']),
    activeSessionId: null, historyActive: false, isLayoutVisible: true, paneMarkerSettings: {},
    hookNotifications: {}, hideTabBar: true,
    onActivateSession: id => activated.push(id), ...overrides,
  });
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
  return { nodes: walk(tree), activated };
}
test('hidden canonical parser remains mounted but is not displayed or active', () => {
  const { nodes } = fixture(true);
  assert.equal(nodes.find(n => n.key === 's').props.style.display, 'none');
  const terminal = nodes.find(n => n.type === 'XTermTerminal');
  assert.equal(terminal.props.isVisible, false);
  assert.equal(terminal.props.isActive, false);
});
for (const removed of [false, true]) test(`incidental pointer and focus cannot restore ${removed ? 'deleted' : 'hidden'} session`, () => {
  const { nodes, activated } = fixture(!removed, removed);
  const content = nodes.find(n => n.props?.className?.startsWith('ui-terminal-pane-content'));
  content.props.onPointerDownCapture();
  content.props.onFocusCapture();
  assert.deepEqual(activated, []);
});
test('visible canonical body remains visible and activatable', () => {
  const { nodes, activated } = fixture(false);
  assert.equal(nodes.find(n => n.key === 's').props.style.display, 'block');
  nodes.find(n => n.props?.className?.startsWith('ui-terminal-pane-content')).props.onPointerDownCapture();
  assert.deepEqual(activated, ['s']);
});

for (const overrides of [{ isLayoutVisible: false }, { workspaceVisible: false }, { historyActive: true }]) {
  test(`canonical parser stays mounted while presentation is inactive: ${JSON.stringify(overrides)}`, () => {
    const { nodes } = fixture(false, false, { activeSessionId: 's', ...overrides });
    const terminals = nodes.filter(n => n.type === 'XTermTerminal');
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].props.isVisible, false);
    assert.equal(terminals[0].props.isActive, false);
  });
}
test('deleted canonical session has no parser owner', () => {
  assert.equal(fixture(false, true).nodes.filter(n => n.type === 'XTermTerminal').length, 0);
});
test('visible canonical parser receives active focus without a portal', () => {
  const { nodes } = fixture(false, false, { activeSessionId: 's' });
  const terminal = nodes.find(n => n.type === 'XTermTerminal');
  assert.equal(terminal.props.isVisible, true);
  assert.equal(terminal.props.isActive, true);
  assert.equal(nodes.filter(n => n.type === 'portal').length, 0);
});

test('transient background parser is not duplicated in canonical pane until recovery retention', () => {
  const transient = fixture(false, false, {}, { transientBackground: true });
  assert.equal(transient.nodes.filter(n => n.type === 'XTermTerminal').length, 0);
  const retained = fixture(false, false, {}, { transientBackground: false });
  assert.equal(retained.nodes.filter(n => n.type === 'XTermTerminal').length, 1);
});
test('workspace-hidden content cannot incidentally activate its mounted owner', () => {
  const { nodes, activated } = fixture(false, false, { workspaceVisible: false });
  const content = nodes.find(n => n.props?.className?.startsWith('ui-terminal-pane-content'));
  content.props.onPointerDownCapture();
  content.props.onFocusCapture();
  assert.deepEqual(activated, []);
});
