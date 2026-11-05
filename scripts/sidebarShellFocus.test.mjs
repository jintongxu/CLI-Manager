import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: id => deps[id] ?? {}, ...globals });
  return exports;
}

test('capture-phase workspace boundary leaves shell keys to xterm, not main Pi; palette remains global', () => {
  const listeners = new Map(); const actions = [];
  const settings = { keyboardShortcuts: { commandPalette: 'Ctrl+K', closeTerminal: 'Ctrl+W',
    nextTab: 'Ctrl+Tab', prevTab: 'Ctrl+Shift+Tab', sessionHistory: 'Ctrl+H', toggleSidebar: 'Ctrl+B',
    toggleTerminalFullscreen: 'F11', newTerminal: 'Ctrl+T', copyAi: 'Ctrl+Shift+C' }, viewMode: 'full' };
  const state = { sessions: [{ id: 'main-pi' }, { id: 'other' }], activeSessionId: 'main-pi',
    setActive: id => actions.push(id), getNextSessionIdForShortcut: () => 'other' };
  const { useKeyboardShortcuts } = load('src/features/workspace/api/useKeyboardShortcuts.ts', {
    react: { useRef: current => ({ current }), useEffect: fn => fn() },
    '../../../shared/preferences/settingsStore': { useSettingsStore: select => select(settings) },
    './CommandPalette': { useCommandPaletteStore: { getState: () => ({ toggle: () => actions.push('palette') }) } },
    '../../terminal/state': { useTerminalStore: { getState: () => state } },
    '../../terminal/api/terminalCloseConfirm': { TERMINAL_TAB_CLOSE_REQUEST_EVENT: 'close-main' },
    '../../terminal/api/currentWorkEvents': { dispatchCurrentWorkAction: action => actions.push(action) },
    '../../terminal/api/chatPanelCommands': { dispatchChatPanelToggle: () => actions.push('chat') },
  }, { window: { addEventListener: (type, fn, capture) => { assert.equal(capture, true); listeners.set(type, fn); },
    removeEventListener() {}, dispatchEvent: event => actions.push(event) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
  useKeyboardShortcuts({ onToggleSidebar: () => actions.push('sidebar'), onToggleTerminalFullscreen: () => actions.push('fullscreen') });
  function key(key, shell, extra = {}) {
    let prevented = false;
    listeners.get('keydown')({ key, ctrlKey: true, target: { tagName: 'TEXTAREA',
      closest: selector => selector === '.xterm' || (shell && selector === '[data-sidebar-shell-surface]') ? {} : null },
    preventDefault: () => { prevented = true; }, ...extra });
    return prevented;
  }
  for (const [k, extra] of [['W', {}], ['Tab', {}], ['Tab', { shiftKey: true }], ['H', {}], ['B', {}],
    ['T', {}], ['W', { shiftKey: true }], ['ArrowRight', { shiftKey: true }], ['ArrowLeft', { shiftKey: true }],
    ['C', { ctrlKey: false, altKey: true }], ['F11', { ctrlKey: false }]]) {
    assert.equal(key(k, true, extra), false, `${k} must reach shell xterm unchanged`);
  }
  assert.equal(actions.length, 0);
  assert.equal(state.activeSessionId, 'main-pi');
  assert.equal(key('K', true), true);
  assert.deepEqual(actions.splice(0), ['palette']);
  assert.equal(key('W', false), true, 'main xterm keeps close shortcut');
  assert.equal(actions[0].type, 'close-main');
  assert.deepEqual(Array.from(actions[0].detail.sessionIds), ['main-pi']);
  actions.length = 0;
  assert.equal(key('Tab', false), true);
  assert.deepEqual(actions, ['other']);
});

test('host effects preserve logical shell focus through native blur but deactivate on internal changes', () => {
  const slots = []; let cursor = 0; let pending = []; const listeners = new Map(); const attrs = {};
  const surface = { setAttribute: (key, value) => { attrs[key] = value; }, contains: node => node?.inShell === true };
  const effect = (fn, deps) => {
    const i = cursor++; const previous = slots[i];
    if (!previous || deps.some((d, n) => d !== previous.deps[n])) {
      pending.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    }
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const { SidebarShellHost } = load('src/features/terminal/components/SidebarShellHost.tsx', {
    react: { useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useLayoutEffect: effect, useEffect: effect },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-dom': { createPortal: children => ({ children }) },
    '../../../shared/preferences/settingsStore': { useSettingsStore: () => ({}) },
    '../store/sidebarShellStore': { useSidebarShellStore: select => select({ owners: {
      a: { sessionId: 'shell', context: { key: 'a' } }, b: { sessionId: 'shell-b', context: { key: 'b' } },
    } }) }, './XTermTerminal': { XTermTerminal() {} },
  }, { document: { createElement: () => surface, addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type) },
    window: { addEventListener: type => { throw new Error(`unexpected native ${type} focus reset`); } } });
  const target = { appendChild() {} }; let props = { target, contextKey: 'a', visible: true };
  function render() { cursor = 0; const tree = SidebarShellHost(props); const effects = pending; pending = []; effects.forEach(fn => fn()); return tree.props.children[1]; }
  const active = () => render().children.find(child => child.props.children.props.isVisible)?.props.children.props.isActive;
  render(); assert.equal(active(), false);
  assert.ok('data-sidebar-shell-surface' in attrs);
  listeners.get('focusin')({ target: { inShell: true } }); assert.equal(active(), true);
  // Native blur/focus never flips isActive, so useXTermController never calls terminal.blur().
  assert.equal(listeners.has('blur'), false); assert.equal(active(), true);
  listeners.get('focusin')({ target: {} }); assert.equal(active(), false);
  for (const change of [{ visible: false }, { contextKey: 'b' }, { target: { appendChild() {} } }]) {
    listeners.get('focusin')({ target: { inShell: true } }); assert.equal(active(), true);
    props = { ...props, ...change }; render();
    assert.notEqual(active(), true, 'internal hide/context/slot change releases logical input');
    props = { target, contextKey: 'a', visible: true }; render(); assert.equal(active(), false);
  }
});
