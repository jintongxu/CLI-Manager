import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, deps = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: id => deps[id] ?? {}, ...globals });
  return exports;
}
const focusPath = 'src/features/terminal/api/fileCompanionFocus.ts';

test('companion focus tracks DOM and logical editor ownership through resize/native blur', () => {
  const document = { activeElement: null };
  const { isFileCompanionFocused: focused, setFileCompanionFocused: set } = load(focusPath, {}, { document });
  assert.equal(focused(), false);
  document.activeElement = { closest: selector => selector === '[data-file-companion]' ? {} : null };
  assert.equal(focused(), true);
  set(true);
  document.activeElement = { closest: () => null };
  assert.equal(focused(), true, 'body focus during divider resize retains editor ownership');
  set(false);
  assert.equal(focused(), false, 'main pointer or collapse releases ownership');
  assert.equal(load(focusPath).isFileCompanionFocused(), false, 'safe without a document');
});

test('every controller focus path passes the companion ownership guard', () => {
  const source = readFileSync('src/features/terminal/hooks/useXTermController.ts', 'utf8');
  const body = source.match(/const focusTerminalWithCodexCursorPolicy = \(terminal: Terminal\) => \{([\s\S]*?)\n  \};/)[1];
  let owned = true; let focusCalls = 0;
  const focus = vm.runInNewContext(`(terminal) => {${body}}`, {
    isFileCompanionFocused: () => owned, shouldHideCodexCursor: () => false,
  });
  const terminal = { focus: () => focusCalls++ };
  focus(terminal); assert.equal(focusCalls, 0);
  owned = false; focus(terminal); assert.equal(focusCalls, 1);
  assert.equal((source.match(/\bterminal\.focus\(/g) ?? []).length, 1, 'no unguarded direct focus sites');
});

test('capture Ctrl+W from companion closes file only, even with Pi globally active', () => {
  const listeners = new Map(); const actions = [];
  const settings = { keyboardShortcuts: { closeTerminal: 'Ctrl+W', commandPalette: 'Ctrl+K',
    toggleTerminalFullscreen: '', toggleSidebar: '', sessionHistory: '', copyAi: '', nextTab: '', prevTab: '', newTerminal: '' }, viewMode: 'full' };
  const terminal = { activeSessionId: 'pi', sessions: [{ id: 'pi' }] };
  const { useKeyboardShortcuts } = load('src/features/workspace/api/useKeyboardShortcuts.ts', {
    react: { useRef: current => ({ current }), useEffect: fn => fn() },
    '../../../shared/preferences/settingsStore': { useSettingsStore: select => select(settings) },
    '../../terminal/state': { useTerminalStore: { getState: () => terminal } },
    '../../history/index': { useHistoryStore: { getState: () => ({ isOpen: false }) } },
    './CommandPalette': { useCommandPaletteStore: { getState: () => ({ toggle: () => actions.push('palette') }) } },
    '../../terminal/api/terminalCloseConfirm': { TERMINAL_TAB_CLOSE_REQUEST_EVENT: 'close-pi' },
  }, { window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener() {},
    dispatchEvent: event => actions.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } } });
  useKeyboardShortcuts();
  function key(key, companion, tagName = 'TEXTAREA') {
    let prevented = false;
    listeners.get('keydown')({ key, ctrlKey: true,
      target: { tagName, closest: selector => companion && selector === '[data-file-companion]' ? {} : null },
      preventDefault: () => { prevented = true; } });
    return prevented;
  }
  for (const tag of ['TEXTAREA', 'BUTTON', 'DIV']) assert.equal(key('w', true, tag), true);
  assert.deepEqual(actions.splice(0), Array(3).fill('file-companion-close-file'));
  assert.equal(key('s', true), false, 'save eligibility remains owned by editor host');
  assert.equal(key('k', true), true); assert.deepEqual(actions.splice(0), ['palette']);
  assert.equal(key('w', false), true); assert.deepEqual(actions, ['close-pi']);
  assert.equal(terminal.activeSessionId, 'pi');
});

test('portal editor dialog isolates capture shortcuts before global and main-session actions', () => {
  const listeners = new Map(); const actions = [];
  const settings = { keyboardShortcuts: { closeTerminal: 'Ctrl+Shift+X', commandPalette: 'Ctrl+K',
    toggleTerminalFullscreen: 'Ctrl+Enter', toggleSidebar: 'Ctrl+B', sessionHistory: 'Ctrl+H',
    copyAi: 'Ctrl+I', nextTab: 'Ctrl+Tab', prevTab: 'Ctrl+Shift+Tab', newTerminal: 'Ctrl+T' }, viewMode: 'full' };
  const terminal = { activeSessionId: 'pi', sessions: [{ id: 'pi' }, { id: 'other' }],
    getNextSessionIdForShortcut: () => { actions.push('next-session'); return 'other'; },
    setActive: () => actions.push('activate'), createSession: () => actions.push('create') };
  const { useKeyboardShortcuts } = load('src/features/workspace/api/useKeyboardShortcuts.ts', {
    react: { useRef: current => ({ current }), useEffect: fn => fn() },
    '../../../shared/preferences/settingsStore': { useSettingsStore: select => select(settings) },
    '../../terminal/state': { useTerminalStore: { getState: () => { actions.push('terminal-state'); return terminal; } } },
    '../../history/index': { useHistoryStore: { getState: () => { actions.push('history-state'); return {
      isOpen: true, openHistory: () => actions.push('history'),
      triggerGlobalSearchFocus: () => actions.push('global-search'), triggerSessionSearchFocus: () => actions.push('session-search'),
    }; } } },
    '../../files/api/fileExplorerStore': { useFileExplorerStore: { getState: () => { actions.push('files-state'); return {}; } } },
    './CommandPalette': { useCommandPaletteStore: { getState: () => ({ toggle: () => actions.push('palette') }) } },
    '../../terminal/api/chatPanelCommands': { dispatchChatPanelToggle: () => actions.push('chat') },
    '../../terminal/api/terminalCloseConfirm': { TERMINAL_TAB_CLOSE_REQUEST_EVENT: 'close-pi' },
  }, { window: { addEventListener: (type, fn, capture) => listeners.set(type, { fn, capture }), removeEventListener() {},
    dispatchEvent: event => actions.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } } });
  useKeyboardShortcuts({ onToggleSidebar: () => actions.push('sidebar'),
    onToggleTerminalFullscreen: () => actions.push('fullscreen') });
  const { fn: keydown, capture } = listeners.get('keydown');
  assert.equal(capture, true, 'exercise the actual registered capture callback');
  function key(key, { ctrlKey = true, shiftKey = false, altKey = false, tagName = 'BUTTON', dialog = true } = {}) {
    const result = { prevented: false, stopped: false };
    keydown({ key, ctrlKey, shiftKey, altKey, metaKey: false,
      // A portal target has neither companion nor editor-pane ancestry.
      target: { tagName, closest: selector => dialog && selector === '[data-file-editor-dialog]' ? {} : null },
      preventDefault: () => { result.prevented = true; }, stopPropagation: () => { result.stopped = true; } });
    return result;
  }
  for (const tagName of ['BUTTON', 'DIV', 'TEXTAREA']) {
    assert.deepEqual(key('w', { tagName }), { prevented: true, stopped: true });
    assert.deepEqual(key('x', { tagName, shiftKey: true }), { prevented: true, stopped: true });
  }
  for (const [name, options] of [
    ['s', {}], ['k', {}], ['Enter', {}], ['b', {}], ['h', {}], ['f', {}], ['i', {}],
    ['Tab', {}], ['Tab', { shiftKey: true }], ['t', {}], ['c', { ctrlKey: false, altKey: true }],
    ['Escape', { ctrlKey: false }], ['Enter', { ctrlKey: false }], ['Tab', { ctrlKey: false }],
  ]) {
    assert.deepEqual(key(name, options), { prevented: false, stopped: false },
      `${name} stays available to dialog/editor handlers without triggering workspace actions`);
  }
  assert.deepEqual(actions, [], 'no file close, main close, save, navigation, or global action behind dialog');
  assert.equal(terminal.activeSessionId, 'pi');
  assert.deepEqual(key('k', { dialog: false }), { prevented: true, stopped: false });
  assert.deepEqual(actions.splice(0), ['palette'], 'non-dialog global shortcut behavior is unchanged');
  assert.deepEqual(key('x', { dialog: false, shiftKey: true }), { prevented: true, stopped: false });
  assert.deepEqual(actions, ['terminal-state', 'close-pi'], 'configured close still reaches main outside dialog');
});

test('workspace switches present/collapse companion without activating an editor session', () => {
  const actions = []; const project = { id: 'project', path: '/project', name: 'project' };
  const companion = { open: false, mode: 'beside', collapse: () => actions.push('collapse') };
  const hook = load('src/features/terminal/hooks/useTerminalWorkspaceMode.ts', {
    react: { useState: value => [value, () => {}], useEffect: () => {}, useCallback: fn => fn },
    '../../files/api/fileExplorerStore': { useFileExplorerStore: { getState: () => ({ project }) } },
    '../api/fileCompanionState': { useFileCompanionStore: Object.assign(select => select(companion), { getState: () => companion }) },
    '../api/fileCompanionFocus': { setFileCompanionFocused: value => actions.push(['focus', value]) },
    '../state': { useTerminalStore: { getState: () => ({ openFileEditorPane: (...args) => actions.push(args) }) } },
  }).useTerminalWorkspaceMode;
  const options = { activeSessionId: 'pi', sessions: [{ id: 'pi', projectId: project.id }],
    historyOpen: false, closeHistory: () => actions.push('closeHistory'), setActive: () => assert.fail('must not change Pi selection') };
  const mode = hook(options);
  mode.switchToEditorWorkspace();
  assert.equal(actions[1][0], project); assert.equal(actions[1][1], 'current');
  actions.length = 0; mode.switchToTerminalWorkspace();
  assert.deepEqual(actions, ['closeHistory', 'collapse', ['focus', false]]);
  companion.open = true; companion.mode = 'current';
  assert.equal(hook(options).editorActive, true);
  companion.mode = 'beside'; assert.equal(hook(options).editorActive, false);
});
