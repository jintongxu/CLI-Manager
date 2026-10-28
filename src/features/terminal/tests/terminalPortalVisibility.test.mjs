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
function fixture(hidden, removed = false) {
  const exports = {}, activated = [];
  const session = { id: 's', kind: 'pty', tabHidden: hidden };
  const store = { activeSessionId: null, sessions: removed ? [] : [session] };
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return { memo: fn => fn, Suspense: 'Suspense' };
    if (name === 'react-dom') return { createPortal: child => ({ type: 'portal', props: { children: child } }) };
    if (name === '../state') return { useTerminalStore: { getState: () => store } };
    if (name.includes('terminalPaneMarker')) return { resolveTerminalPaneMarker: () => null };
    if (name.includes('TerminalCliContext')) return { createTerminalCliContext: () => ({}), isPiTerminalContext: () => false };
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  const pane = { id: 'p', type: 'leaf', sessionIds: ['s'], activeSessionId: 's' };
  const tree = exports.PaneLeafView({
    pane, allPanes: [pane], sessions: [session], projects: [], visibleSessionIds: new Set(),
    activeSessionId: null, historyActive: false, isLayoutVisible: false, paneMarkerSettings: {},
    hookNotifications: {}, hideTabBar: true, currentWorkSessionIds: ['s'], currentWorkActiveSessionId: 's',
    currentWorkPortalTargets: new Map([['s', {}]]), currentWorkVisibleSessionIds: new Set(['s']),
    onActivateSession: id => activated.push(id),
  });
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
  return { nodes: walk(tree), activated };
}
test('hidden current-work portal remains mounted but is not displayed or active', () => {
  const { nodes } = fixture(true);
  assert.equal(nodes.find(n => n.type === 'portal').props.children.props.style.display, 'none');
  const terminal = nodes.find(n => n.type === 'XTermTerminal');
  assert.equal(terminal.props.isVisible, false);
  assert.equal(terminal.props.isActive, false);
});
for (const removed of [false, true]) test(`incidental pointer and focus cannot restore ${removed ? 'deleted' : 'hidden'} session`, () => {
  const { nodes, activated } = fixture(!removed, removed);
  const content = nodes.find(n => n.props?.className?.startsWith('ui-terminal-pane-content'));
  content.props.onPointerDownCapture();
  content.props.onFocusCapture();
  nodes.find(n => n.type === 'portal').props.children.props.onPointerDownCapture();
  assert.deepEqual(activated, []);
});
test('visible current-work portal remains visible and activatable', () => {
  const { nodes, activated } = fixture(false);
  assert.equal(nodes.find(n => n.type === 'portal').props.children.props.style.display, 'block');
  nodes.find(n => n.props?.className?.startsWith('ui-terminal-pane-content')).props.onPointerDownCapture();
  assert.deepEqual(activated, ['s']);
});
