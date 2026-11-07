import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = 'src/features/terminal/components/';
const calls = [];
let inputQuery = '';
function load(path) {
  const filename = resolve(path); const exports = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    if (name === 'react') return { useId: () => 'test', useRef: () => ({ current: null }),
      useMemo: fn => fn(), useState: initial => [typeof initial === 'string' ? inputQuery : initial, () => {}] };
    if (name === 'react/jsx-runtime') return require(name);
    if (name.includes('i18n')) return { useI18n: () => ({ t: (key) => key }) };
    if (name.endsWith('/state')) return { useTerminalStore: select => select({ sessionStatuses: {} }) };
    if (name.endsWith('/hooks/useTerminalNavigation')) return { useTerminalNavigation: () => ({ entries: [], memory: { pinnedIds: [] },
      resolveActivation: id => id === 'valid' ? { sessionId: id, unhide: true } : null,
      recordVisit: id => calls.push(['visit', id]) }) };
    if (name.endsWith('/api/terminalPaneTree')) return { collectPaneLeaves: () => [] };
    if (name.endsWith('/hooks/useTerminalDrawerIntent')) return { useTerminalDrawerIntent: () => ({ anchorRef: {}, anchorProps: {}, contentProps: {}, open: false }) };
    if (name.includes('/ui/')) return Object.fromEntries(['Button', 'Input', 'Popover', 'PopoverAnchor', 'PopoverContent'].map(key => [key, key]));
    if (name.endsWith('/TerminalTabRow')) return { TerminalTabRow: 'TerminalTabRow' };
    if (name.endsWith('/PaneTabBar')) return { PaneTabBar: 'PaneTabBar' };
    if (name.endsWith('.css')) return {};
    return load(resolve(dirname(filename), `${name}${name.includes('NavigationDrawer') || name.includes('NavigationBar') ? '.tsx' : '.ts'}`));
  } });
  return exports;
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
const entry = (id, extra = {}) => ({ id, session: { id, title: id, cwd: 'C:/repo' }, current: id === 'a', ...extra });
const entries = [entry('a'), entry('hidden', { session: { id: 'hidden', title: 'Hidden terminal', cwd: 'D:/other', tabHidden: true } })];
const projectGroups = [{ key: 'independent', label: '', entries }];
const drawer = load(`${root}TerminalNavigationDrawer.tsx`);
const bar = load(`${root}TerminalNavigationBar.tsx`);
const adapter = load(`${root}TerminalNavigationAdapter.tsx`);
function drawerProps() { return { open: true, pinned: true, anchor: null, contentProps: {}, projectGroups, totalCount: 2,
  onActivate: id => calls.push(['activate', id]), onClose: id => calls.push(['close', id]),
  onCloseOthers: () => calls.push(['closeOthers']), onTogglePin: id => calls.push(['pin', id]), onOpenChange() {} }; }

test('drawer exposes every terminal including hidden rows through activation, close and pin only', () => {
  calls.length = 0;
  const all = nodes(drawer.TerminalNavigationDrawer(drawerProps()));
  assert.equal(all.filter(n => n.props.role === 'option').length, 2);
  all.filter(n => n.props.className === 'ui-terminal-navigation-drawer-main')[1].props.onClick();
  all.find(n => n.type === 'Button' && n.props['aria-label'] === 'terminal.tab.close').props.onClick();
  all.find(n => n.type === 'Button' && n.props.children === 'terminal.navigation.pin').props.onClick();
  assert.deepEqual(calls, [['activate', 'hidden'], ['close', 'a'], ['pin', 'a']]);
  assert.equal(all.filter(n => n.type === 'input').length, 0);
  assert.doesNotMatch(JSON.stringify(all), /currentWork|removeSelected|addTerminal/);
});

test('drawer search Enter uses the same activation as clicking a row and respects IME', () => {
  calls.length = 0; inputQuery = 'hidden';
  const all = nodes(drawer.TerminalNavigationDrawer(drawerProps()));
  assert.equal(all.filter(n => n.props.role === 'option').length, 1);
  const input = all.find(n => n.type === 'Input');
  input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
  assert.deepEqual(calls, []);
  input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(calls, [['activate', 'hidden']]);
  inputQuery = '';
});

test('bar row and drawer receive the same complete collection and count', () => {
  const tree = bar.TerminalNavigationBar({ navigation: { entries, projectGroups, totalCount: 2 }, position: 'top', ...drawerProps() });
  const row = nodes(tree).find(n => n.type === 'TerminalTabRow');
  const popup = nodes(tree).find(n => n.type === drawer.TerminalNavigationDrawer || n.props.projectGroups);
  assert.equal(row.props.entries, entries);
  assert.equal(popup.props.projectGroups, projectGroups);
  assert.equal(popup.props.totalCount, 2);
});

test('adapter delegates hidden reopening and focusing to canonical activation without a second path', () => {
  calls.length = 0;
  const tree = adapter.TerminalNavigationAdapter({ sessions: [], projects: [], groups: [], worktrees: [], layouts: [],
    scope: { kind: 'all' }, onActivateSession: id => calls.push(['canonical', id]) });
  tree.props.onActivate('closed');
  tree.props.onActivate('valid');
  assert.deepEqual(calls, [['canonical', 'valid'], ['visit', 'valid']]);
});

test('owned navigation surfaces contain no mode, membership or drop-target controls', () => {
  for (const file of ['TerminalNavigationAdapter.tsx', 'TerminalNavigationBar.tsx', 'TerminalNavigationDrawer.tsx', 'TerminalNavigationPanels.tsx', 'TerminalTabRow.tsx', 'PaneTabBar.tsx']) {
    assert.doesNotMatch(readFileSync(`${root}${file}`, 'utf8'), /currentWorkMode|inCurrentWork|currentWorkSessionIds|onToggleCurrentWork|onAddToCurrentWork|onRemoveFromCurrentWork|onRemoveSelected|CURRENT_WORK_DROP_TARGET_ID|CURRENT_WORK_TAB_DRAG_PREFIX/);
  }
  const source = readFileSync(`${root}TerminalTabRow.tsx`, 'utf8');
  assert.match(source, /TERMINAL_TAB_DRAG_PREFIX/);
  assert.match(source, /entries\.map/);
  assert.doesNotMatch(source, /quickEntries|moreCount/);
});

test('main view renders only the original navigation tier and retains every canonical split layout', () => {
  const filename = resolve(`${root}TerminalTabsView.tsx`);
  const exports = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return { useRef: () => ({ current: null }), Suspense: 'Suspense' };
    if (name.endsWith('/chatPanelStore')) return { useChatPanelStore: select => select({ mode: 'dock' }) };
    if (name.endsWith('/useChatPanelDrag')) return { useChatPanelDrag: () => ({}) };
    return new Proxy({}, { get: (_, key) => key });
  } });
  const sessions = [entry('a').session, entry('b').session, entry('hidden').session];
  const first = { type: 'leaf', id: 'one', sessionIds: ['a'], activeSessionId: 'a' };
  const second = { type: 'leaf', id: 'two', sessionIds: ['b'], activeSessionId: 'b' };
  const split = { type: 'split', id: 'split', direction: 'horizontal', ratio: .37, first, second };
  const layouts = [{ workspan: { id: 'w1' }, paneTree: split, visiblePaneTree: split },
    { workspan: { id: 'w2' }, paneTree: second, visiblePaneTree: second }];
  for (const position of ['top', 'bottom']) for (const visible of [true, false]) {
    const activate = () => {};
    const all = nodes(exports.TerminalTabsView({ sessions, mountedWorkspanLayouts: layouts,
      visibleSessions: sessions, effectiveActiveWorkspanId: 'w1', effectiveActiveSessionId: 'a',
      sidebarShell: {}, renderToolbarActions: () => null, workspanTabBarPosition: position,
      workspanTabBarVisible: visible, handleActivateSession: activate,
      terminalScopeValue: { kind: 'all' } }));
    assert.equal(all.filter(n => n.type === 'WorkspanTabBar').length, 0);
    const frame = all.find(n => n.type === 'WorkspanTerminalLayout');
    assert.equal(frame.props.position, position);
    assert.equal(frame.props.tabBarVisible, visible);
    const nav = frame.props.tabBar;
    assert.equal(nav.type, 'TerminalNavigationAdapter');
    assert.equal(nav.props.sessions, sessions); // not restricted to the active workspan
    assert.equal(nav.props.layouts, layouts);
    assert.equal(nav.props.onActivateSession, activate);
    assert.equal(nav.props.legacyOrdering, undefined);
    const splits = all.filter(n => n.type === 'SplitTerminalView');
    assert.equal(splits.length, 2);
    assert.equal(splits[0].props.node, split);
    assert.equal(splits[0].props.node.ratio, .37);
    assert.equal(splits[1].props.node, second);
  }
});
