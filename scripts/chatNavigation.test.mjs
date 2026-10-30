import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const jsx = require('react/jsx-runtime');
function load(path, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    if (name in mocks) return mocks[name];
    if (name === 'react/jsx-runtime') return jsx;
    if (name.includes('i18n')) return { useI18n: () => ({ t: key => key }) };
    if (name === 'react') return { memo: fn => fn, useCallback: fn => fn, useEffect() {} };
    return new Proxy({}, { get: (_, key) => key });
  } });
  return exports;
}
function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const workspace = load('src/app/components/AppWorkspace.tsx');

test('space toggles preserve both owner element paths/types/keys and keep hidden tree inert', () => {
  function TerminalOwner() {}
  function ChatOwner() {}
  const terminal = jsx.jsx(TerminalOwner, {});
  const chat = jsx.jsx(ChatOwner, {});
  const owners = new Map(); let mounts = 0; let unmounts = 0;
  // Reconcile the actual composition element tree by React sibling identity.
  function reconcile(tree) {
    const next = new Map();
    function visit(node, path) {
      if (!node || typeof node !== 'object') return;
      const id = `${path}:${node.key ?? ''}`;
      if (node.type === TerminalOwner || node.type === ChatOwner) {
        const previous = owners.get(id);
        if (!previous || previous.type !== node.type) mounts++;
        next.set(id, node);
      }
      [node.props?.children].flat(Infinity).forEach((child, index) => visit(child, `${id}/${index}`));
    }
    visit(tree, 'root');
    for (const id of owners.keys()) if (!next.has(id)) unmounts++;
    owners.clear(); for (const pair of next) owners.set(...pair);
  }
  for (const space of ['projects', 'chat', 'projects', 'chat']) {
    const tree = workspace.AppWorkspace({ space, children: terminal, chatWorkspace: chat });
    reconcile(tree);
    const [projects, conversation] = tree.props.children;
    assert.equal(projects.props.inert, space !== 'projects');
    assert.equal(conversation.props.inert, space === 'projects');
    assert.equal(projects.props.children, terminal);
    assert.equal(conversation.props.children, chat);
  }
  assert.equal(mounts, 2); assert.equal(unmounts, 0);
});

test('primary navigation has explicit accessible selection and independent global settings', () => {
  const { PrimarySpaceNav } = load('src/app/components/PrimarySpaceNav.tsx');
  const calls = [];
  const tree = PrimarySpaceNav({ space: 'chat', onChange: s => calls.push(s), onOpenSettings: () => calls.push('settings') });
  const buttons = nodes(tree).filter(n => n.type === 'button');
  assert.equal(buttons[1].props['aria-current'], 'page');
  buttons[0].props.onClick(); buttons[2].props.onClick();
  assert.deepEqual(calls, ['projects', 'settings']);
});

test('ordinary and Current Work portal terminal/file/transcript bodies are inactive and hidden in chat', () => {
  const portals = [];
  const { PaneLeafView } = load('src/features/terminal/components/PaneLeafView.tsx', {
    'react-dom': { createPortal: (node, target) => { portals.push(target); return node; } },
    '../../../shared/lib/terminalPaneMarker': { resolveTerminalPaneMarker: () => null },
    '../browser/TerminalCliContext': { createTerminalCliContext: () => ({}), isPiTerminalContext: () => false },
  });
  for (const kind of ['pty', 'file-editor', 'subagent-transcript']) for (const portal of [false, true]) {
    const calls = [];
    const session = { id: 'a', kind };
    const target = {};
    const props = {
      workspaceVisible: false, pane: { id: 'p', sessionIds: ['a'], activeSessionId: 'a' },
      sessions: [session], projects: [], worktrees: [], allPanes: [], activeSessionId: 'a',
      paneMarkerSettings: {}, hookNotifications: {}, isLayoutVisible: true, historyActive: false,
      currentWorkSessionIds: ['a'], currentWorkPortalTargets: portal ? new Map([['a', target]]) : undefined,
      currentWorkVisibleSessionIds: new Set(['a']), currentWorkActiveSessionId: 'a',
      onActivateSession: id => calls.push(id),
    };
    const tree = PaneLeafView(props);
    const all = nodes(tree);
    const body = all.find(n => 'isActive' in n.props || 'isVisible' in n.props);
    assert.ok(body, kind);
    if ('isActive' in body.props) assert.equal(body.props.isActive, false);
    if ('isVisible' in body.props) assert.equal(body.props.isVisible, false);
    for (const n of all) { n.props.onFocusCapture?.(); n.props.onPointerDownCapture?.(); }
    assert.equal(calls.length, 0);
    assert.ok(all.some(n => n.props.style?.display === 'none'));
    if (portal) assert.equal(portals.at(-1), target, 'keep portal target identity while hidden');
  }
});

test('chat blocks terminal keyboard/current-work/sidebar/fullscreen/history and mouse switches but permits palette', () => {
  const listeners = new Map(); const refs = []; let refIndex = 0;
  const effects = []; let palette = 0; let writes = 0; let switched = 0;
  const settings = { keyboardShortcuts: { commandPalette: 'Ctrl+K', closeTerminal: 'Ctrl+W', nextTab: 'Ctrl+Tab',
    sessionHistory: 'Ctrl+H', toggleSidebar: 'Ctrl+B', toggleTerminalFullscreen: 'F11', newTerminal: 'Ctrl+T' }, viewMode: 'full' };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {}, dispatchEvent: () => writes++ };
  const { useKeyboardShortcuts } = load('src/features/workspace/api/useKeyboardShortcuts.ts', {
    react: { useRef: initial => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }), useEffect: fn => effects.push(fn) },
    '../../../shared/preferences/settingsStore': { useSettingsStore: fn => fn(settings) },
    './CommandPalette': { useCommandPaletteStore: { getState: () => ({ toggle: () => palette++ }) } },
    '../../terminal/state': { useTerminalStore: { getState: () => ({ sessions: [{ id: 'a' }, { id: 'b' }],
      getNextSessionIdForShortcut: () => 'b', setActive: () => switched++ }) } },
    '../../terminal/api/currentWorkEvents': { dispatchCurrentWorkAction: () => writes++ },
    '../../history/index': { useHistoryStore: { getState: () => { writes++; return {}; } } },
  }, { window });
  const render = visible => { refIndex = 0; useKeyboardShortcuts({ workspaceVisible: visible,
    onToggleSidebar: () => writes++, onToggleTerminalFullscreen: () => writes++ }); };
  render(false); effects.splice(0).forEach(fn => fn());
  function key(key, extra = {}) { let prevented = false; listeners.get('keydown')({ key, ctrlKey: true,
    target: { tagName: 'TEXTAREA', closest: () => null }, preventDefault: () => { prevented = true; }, ...extra }); return prevented; }
  for (const k of ['W', 'Tab', 'H', 'B', 'T']) assert.equal(key(k), false);
  key('W', { shiftKey: true }); key('ArrowRight', { shiftKey: true }); key('F11', { ctrlKey: false });
  listeners.get('mouseup')({ button: 4, preventDefault() {}, stopPropagation() {} });
  assert.equal(writes, 0); assert.equal(switched, 0);
  assert.equal(key('K'), true); assert.equal(palette, 1);
  render(true);
  listeners.get('mouseup')({ button: 4, preventDefault() {}, stopPropagation() {} });
  assert.equal(switched, 1, 'latest visibility ref re-enables existing listener');
});

test('explicit resource/current-work navigation returns projects, passive store changes do not', () => {
  const listeners = new Map(); let projectRoutes = 0; let terminalRoutes = 0;
  const { useTerminalNavigationListeners } = load('src/features/terminal/hooks/useTerminalNavigationListeners.ts', {
    react: { useEffect: fn => fn() },
    '../../workspace/api/primarySpaceState': { showProjectSpace: () => projectRoutes++ },
    '../api/currentWorkEvents': { CURRENT_WORK_ACTION_EVENT: 'action', CURRENT_WORK_TARGET_EVENT: 'target' },
    '../../history/index': { useHistoryStore: { getState: () => ({ closeHistory() {} }) } },
    '../state': { useTerminalStore: { getState: () => ({ sessions: [{ id: 'a' }] }) } },
    '../lib/terminalResourceNavigation': { TERMINAL_RESOURCE_TARGET_EVENT: 'resource', navigateTerminalResource: (_, o) => o.showTerminal() },
  }, { window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} } });
  useTerminalNavigationListeners({ currentWorkMode: false, currentWorkSessionIds: [], setActive() {},
    setActiveWorkspaceTab: () => terminalRoutes++, activateCurrentWork() {}, leaveCurrentWork() {} });
  assert.equal(projectRoutes, 0);
  listeners.get('target')({ detail: { sessionId: 'a' } });
  listeners.get('resource')({ detail: { sessionId: 'a' } });
  listeners.get('action')({ detail: 'toggle-view' });
  assert.equal(projectRoutes, 3); assert.equal(terminalRoutes, 2);
});

test('notification target activation routes only after validating target; arrival registration has no route', async () => {
  const source = readFileSync('src/app/App.tsx', 'utf8');
  const start = source.indexOf('async (tabId: string) => {', source.indexOf('const handleActivateHookNotificationTarget'));
  const end = source.indexOf('\n  }, []);', start) + 4;
  const callback = source.slice(start, end);
  let space = 'chat'; let active = null; let warning = 0; let dispatched = 0;
  const globals = { flushSync: fn => fn(), showProjectSpace: () => { space = 'projects'; },
    useTerminalStore: { getState: () => ({ sessions: [{ id: 'a' }], setActive: id => { active = id; } }) },
    useHistoryStore: { getState: () => ({ closeHistory() {} }) },
    useSettingsStore: { getState: () => ({ projectScopedTerminalViewEnabled: false }) },
    toast: { warning: () => warning++ }, translateCurrent: key => key,
    dispatchCurrentWorkTarget: () => dispatched++, isMainWindowFocused: async () => true,
  };
  const code = ts.transpileModule(`const activate = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const activate = vm.runInNewContext(`${code}\nactivate`, globals);
  await activate('missing'); assert.equal(space, 'chat'); assert.equal(warning, 1);
  await activate('a'); assert.equal(space, 'projects'); assert.equal(active, 'a'); assert.equal(dispatched, 1);
  const passive = source.slice(source.indexOf('const unlistenHook ='), source.indexOf('const unlistenSystemNotification ='));
  assert.doesNotMatch(passive, /showProjectSpace\(|setSpace\(/);
});

test('palette explicit terminal actions route synchronously, theme stays in chat', () => {
  const calls = [];
  const { runProjectNavigation } = load('src/features/workspace/api/projectNavigation.ts', {
    'react-dom': { flushSync: fn => { calls.push('flush'); fn(); } },
    './primarySpaceState': { showProjectSpace: () => calls.push('projects') },
  });
  runProjectNavigation(() => calls.push('terminal-command'));
  assert.deepEqual(calls, ['flush', 'projects', 'terminal-command']);
  const source = readFileSync('src/features/workspace/api/CommandPalette.tsx', 'utf8');
  const expression = source.slice(source.indexOf('return result.map('), source.indexOf('\n  }, [projects'));
  const wrap = vm.runInNewContext(`(result) => { ${expression} }`, { runProjectNavigation });
  const entries = wrap([{ id: 'action:toggle-theme', action: () => calls.push('theme') },
    { id: 'template:1', action: () => calls.push('template') }, { id: 'project:1', action: () => calls.push('project') }]);
  calls.length = 0; entries[0].action(); assert.deepEqual(calls, ['theme']);
  entries[1].action(); assert.deepEqual(calls.slice(-3), ['flush', 'projects', 'template']);
  entries[2].action(); assert.deepEqual(calls.slice(-3), ['flush', 'projects', 'project']);
});

test('App composition keeps TerminalTabs at the same sibling identity across compact/fullscreen/sidebar/space modes', () => {
  const source = readFileSync('src/app/App.tsx', 'utf8');
  const start = source.indexOf('<AppWorkspace space={space}>');
  const end = source.indexOf('</AppWorkspace>', start) + '</AppWorkspace>'.length;
  const composition = source.slice(start, end);
  const code = ts.transpileModule(`exports.render = (space, viewMode, terminalFullscreen, projectSidebarSide) => {
    const workspaceVisible = space === 'projects'; return (${composition});
  };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const context = { exports, require: () => jsx };
  for (const name of ['AppWorkspace', 'Sidebar', 'TerminalTabs', 'handleOpenSettings', 'handleOpenStats',
    'projectScopedTerminalViewEnabled', 'terminalScope', 'setTerminalScope', 'handleToggleTerminalFullscreen']) context[name] = name;
  vm.runInNewContext(code, context);
  const paths = new Set();
  for (const space of ['projects', 'chat']) for (const mode of ['compact', 'full'])
    for (const fullscreen of [false, true]) for (const side of ['left', 'right']) {
      const tree = exports.render(space, mode, fullscreen, side);
      function walk(node, path = '') {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'TerminalTabs') {
          paths.add(`${path}/${node.key ?? ''}`);
          assert.equal(node.props.workspaceVisible, space === 'projects' && mode !== 'compact');
        }
        [node.props?.children].flat(Infinity).forEach((child, i) => walk(child, `${path}/${i}`));
      }
      walk(tree);
      assert.equal(nodes(tree).filter(n => n.type === 'TerminalTabs').length, 1);
    }
  assert.equal(paths.size, 1);
});

test('visibility invalidates memoized panes and Current Work targets retain registration while inert', () => {
  const { arePaneLeafViewPropsEqual } = load('src/features/terminal/components/PaneLeafView.tsx');
  assert.equal(arePaneLeafViewPropsEqual({ workspaceVisible: true }, { workspaceVisible: false }), false);
  const targets = load('src/features/terminal/components/CurrentWorkPaneTarget.tsx', {
    '../lib/currentWorkPresentation': { formatTerminalTabContext: () => '' },
  });
  const registered = [];
  const tree = targets.CurrentWorkPaneTarget({ workspaceVisible: false, paneId: 'p', session: { id: 'a' },
    showHeader: false, active: true, registerTarget: (...args) => registered.push(args) });
  assert.equal(tree.props.inert, true);
  assert.equal(tree.props['data-active'], 'false');
  const all = nodes(tree);
  assert.equal(all.find(n => 'enabled' in n.props).props.enabled, false);
  const target = {}; all.find(n => n.props.ref).props.ref(target);
  assert.deepEqual(registered, [['p', target]]);
});
