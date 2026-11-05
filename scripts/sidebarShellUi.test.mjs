import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; } });
  return exports;
}
const terminal = 'features/terminal/';
test('resolution and context switching never launch; explicit selection launches only unowned context', () => {
  let context = { key: 'a' }, opens = 0;
  const owners = {};
  const state = { owners, open: async c => { opens++; owners[c.key] = { phase: 'ready' }; } };
  const { useSidebarShell } = load(terminal + 'hooks/useSidebarShell.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useState: () => [null, () => {}] },
    sonner: { toast: { error() {} } }, '../../../shared/i18n/index': { useI18n: () => ({ t: x => x }) },
    '../lib/sidebarShellContext': { resolveSidebarShellContext: () => context },
    '../store/sidebarShellStore': { useSidebarShellStore: { getState: () => state } },
  });
  const first = useSidebarShell({}); assert.equal(opens, 0);
  first.select(); first.select(); assert.equal(opens, 1);
  context = { key: 'b' }; const next = useSidebarShell({}); assert.equal(opens, 1);
  next.open(); assert.equal(opens, 2);
  owners.b.phase = 'closeFailed'; next.select(); assert.equal(opens, 2);
  context = null; useSidebarShell({}).select(); assert.equal(opens, 2);
});
test('host is outside conditional panels and uses one stable portal destination for every owner', () => {
  const view = read(terminal + 'components/TerminalTabsView.tsx');
  assert.ok(view.indexOf('<SidebarShellHost') < view.indexOf('{workspaceVisible && <>'));
  const host = read(terminal + 'components/SidebarShellHost.tsx');
  assert.match(host, /useState\(\(\) =>/);
  assert.match(host, /appendChild\(surface\)/);
  assert.match(host, /Object.values\(owners\).filter\(owner => owner.sessionId\).map/);
  assert.match(host, /key=\{owner.sessionId\}/);
  assert.match(host, /isActive=\{shown && focused\}/);
  assert.match(host, /isVisible=\{shown\}/);
  assert.doesNotMatch(host, /setActive|closeSession|\.close\(/);
  const panel = read(terminal + 'components/SidebarShellPanel.tsx');
  assert.doesNotMatch(panel, /<XTermTerminal/);
  assert.match(panel, /ConfirmDialog/);
  assert.match(panel, /await useSidebarShellStore.getState\(\).close\(context.key\);\s*await useSidebarShellStore.getState\(\).open\(context\)/);
  assert.match(panel, /status === "exited"/);
});
test('shell is absent from sidepanel tabs and slots in every dock/merged mode', () => {
  const source = read(terminal + 'components/TerminalSidePanel.tsx');
  assert.doesNotMatch(source, /"shell"|shellPanelContent/);
  const tabs = ['stats', 'git'];
  const { selectVisibleSidePanelTabs } = load(terminal + 'lib/sidePanelTabs.ts', {
    '../components/TerminalSidePanel': { TERMINAL_SIDE_PANEL_TAB_ORDER: tabs },
  });
  const input = { terminalToolbarVisibility: { shell: true, stats: true, gitChanges: true },
    panelCapabilities: { files: false, history: false, statistics: true }, panelGitSupported: true };
  assert.deepEqual([...selectVisibleSidePanelTabs(input)], tabs);
  input.terminalToolbarVisibility.shell = false;
  assert.deepEqual([...selectVisibleSidePanelTabs(input)], tabs);
  const view = read(terminal + 'components/TerminalTabsView.tsx');
  assert.doesNotMatch(view, /sidePanelTab === "shell"|shellPanelContent|key="shell"/);
  const center = view.slice(view.indexOf('data-terminal-center'), view.indexOf('</TerminalWorkspaceFrame>'));
  assert.ok(center.includes('<BottomShellPanel'));
  assert.ok(center.indexOf('<BottomShellPanel') > center.indexOf('<WorkspanTerminalLayout'));
});
test('all shell UI messages are bilingual and main controller does not activate the shell', () => {
  for (const lang of ['en-US', 'zh-CN']) {
    const messages = read('shared/i18n/messages/terminal.' + lang + '.ts');
    for (const key of ['panel.shell', 'shell.closeConfirm', 'shell.noContext', 'shell.contextError', 'shell.createFailed',
      'shell.closeFailed', 'shell.retryClose', 'shell.reopen', 'shell.exited', 'shell.resize', 'shell.collapse', 'shell.maximize', 'shell.restore', 'shell.heightSaveFailed']) assert.ok(messages.includes('"terminal.' + key + '"'));
  }
  const controller = read(terminal + 'hooks/useTerminalTabsController.tsx');
  const toggle = controller.slice(controller.indexOf('handleToggleShellPanel:'), controller.indexOf('systemResourcesPanelActive,', controller.indexOf('handleToggleShellPanel:')));
  assert.match(toggle, /sidebarShell.toggle\(\)/);
  assert.doesNotMatch(toggle, /setActive\(|setSidePanelTab|setSidePanelOpen|ensureTerminalSidePanelVisible/);
});

test('host renders all retained parsers hidden across collapse, selection and dock target replacement', () => {
  const stateSlots = [];
  let cursor = 0, owners = { a: { context: { key: 'a' }, sessionId: 'sa' }, b: { context: { key: 'b' }, sessionId: 'sb' } };
  const jsx = (type, props, key) => ({ type, props, key });
  const fakeReact = {
    useState(initial) {
      const index = cursor++;
      if (!(index in stateSlots)) stateSlots[index] = typeof initial === 'function' ? initial() : initial;
      return [stateSlots[index], value => { stateSlots[index] = value; }];
    },
    useRef: () => ({ current: null }), useLayoutEffect() {}, useEffect() {},
  };
  // Document construction is the only host platform operation during render.
  const exports = {};
  function XTermTerminal() {}
  const deps = { react: fakeReact, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-dom': { createPortal: (children, destination) => ({ children, destination }) },
    '../../../shared/preferences/settingsStore': { useSettingsStore: () => ({}) },
    '../store/sidebarShellStore': { useSidebarShellStore: select => select({ owners }) },
    './XTermTerminal': { XTermTerminal } };
  vm.runInNewContext(ts.transpileModule(read(terminal + 'components/SidebarShellHost.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: id => deps[id], document: { createElement: () => ({ setAttribute() {} }) } });
  const render = props => { cursor = 0; return exports.SidebarShellHost(props).props.children[1]; };
  let first = render({ target: {}, contextKey: 'a', visible: true });
  assert.deepEqual(Array.from(first.children, child => child.key), ['sa', 'sb']);
  assert.equal(first.children[0].props.children.props.isVisible, true);
  assert.equal(first.children[1].props.children.props.isVisible, false);
  for (const props of [{ target: null, contextKey: 'a', visible: false },
    { target: {}, contextKey: 'b', visible: true }, { target: {}, contextKey: 'c', visible: true }]) {
    const next = render(props);
    assert.equal(next.destination, first.destination, 'portal container must not change');
    assert.deepEqual(Array.from(next.children, child => child.key), ['sa', 'sb']);
    assert.equal(next.children.length, 2, 'no parser is removed on context/collapse');
    for (const child of next.children) assert.equal(child.props.children.props.isActive, false);
  }
  owners = { b: owners.b };
  assert.deepEqual(Array.from(render({ target: {}, contextKey: 'b', visible: true }).children, child => child.key), ['sb']);
});

test('bottom frame drag/keyboard sizing, parent clamp, maximize/restore and collapse are independent', () => {
  const slots = []; let cursor = 0; const writes = [], effects = [];
  let available = 600;
  const parent = { get clientHeight() { return available; } };
  const geometry = load('shared/preferences/auxiliaryTerminal.ts', {});
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial };
      if (initial === null && i === 3) slots[i].current = { parentElement: parent };
      return slots[i]; },
    useLayoutEffect(fn) { effects.push(fn); },
  };
  const exports = {}; let observe;
  const deps = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, sonner: { toast: { error() {} } },
    '../../../shared/preferences/settingsStore': { useSettingsStore: Object.assign(fn => fn({ auxiliaryTerminalHeight: 240 }),
      { getState: () => ({ update: async (key, value) => writes.push([key, value]) }) }) },
    '../../../shared/preferences/auxiliaryTerminal': geometry,
    '../../../shared/i18n/index': { useI18n: () => ({ t: x => x }) }, './SidebarShellPanel': { SidebarShellPanel: 'panel' } };
  vm.runInNewContext(ts.transpileModule(read(terminal + 'components/BottomShellPanel.tsx'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: id => deps[id], ResizeObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} } });
  let collapsed = 0;
  const render = (visible = true) => { cursor = 0; effects.length = 0;
    return exports.BottomShellPanel({ visible, onCollapse: () => collapsed++, context: null, registerTarget() {}, onOpen() {}, error: false }); };
  render(); effects.forEach(fn => fn());
  let frame = render(); assert.equal(frame.props.style.height, 240);
  const handle = () => render().props.children[0].props;
  const event = { button: 0, clientY: 400, pointerId: 1, preventDefault() {}, stopPropagation() {},
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } };
  handle().onPointerDown(event); handle().onPointerMove({ ...event, clientY: 300 });
  handle().onPointerCancel(); assert.equal(render().props.style.height, 240);
  handle().onPointerDown(event); handle().onPointerUp(event);
  assert.deepEqual(writes.at(-1), ['auxiliaryTerminalHeight', 240]);
  handle().onPointerDown(event); handle().onPointerMove({ ...event, clientY: 300 }); handle().onPointerUp(event);
  assert.equal(render().props.style.height, 340); assert.deepEqual(writes.at(-1), ['auxiliaryTerminalHeight', 340]);
  handle().onKeyDown({ ...event, key: 'ArrowUp' }); assert.equal(render().props.style.height, 350);
  const count = writes.length;
  render().props.children[1].props.onToggleMaximize();
  assert.equal(render().props.style.height, 600); assert.equal(writes.length, count);
  render().props.children[1].props.onToggleMaximize(); assert.equal(render().props.style.height, 350);
  available = 260; observe(); assert.equal(render().props.style.height, 180);
  available = 600; observe(); assert.equal(render().props.style.height, 350);
  render().props.children[1].props.onCollapse(); assert.equal(collapsed, 1);
  assert.equal(render(false).props.style.display, 'none'); assert.equal(writes.length, count);
});

test('independent shellOpen toggles without auto-launching on context changes', () => {
  let context = { key: 'a' }, cursor = 0, opens = 0;
  const slots = [], owners = {};
  const state = { owners, open: async c => { opens++; owners[c.key] = {}; } };
  const { useSidebarShell } = load(terminal + 'hooks/useSidebarShell.ts', {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useState(initial) { const i = cursor++;
      if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = next; }]; } },
    sonner: { toast: { error() {} } }, '../../../shared/i18n/index': { useI18n: () => ({ t: x => x }) },
    '../lib/sidebarShellContext': { resolveSidebarShellContext: () => context },
    '../store/sidebarShellStore': { useSidebarShellStore: { getState: () => state } },
  });
  const render = () => { cursor = 0; return useSidebarShell({}); };
  assert.equal(render().shellOpen, false); render().toggle(); assert.equal(render().shellOpen, true); assert.equal(opens, 1);
  render().collapse(); assert.equal(render().shellOpen, false); render().toggle(); assert.equal(opens, 1);
  context = { key: 'b' }; assert.equal(render().shellOpen, true); assert.equal(opens, 1);
  render().toggle(); assert.equal(render().shellOpen, false); render().toggle(); assert.equal(opens, 2);
});
