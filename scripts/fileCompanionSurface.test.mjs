import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = path => readFileSync(path, 'utf8');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function fixture() {
  const values = [], refs = [], saves = [], focus = [];
  let cursor = 0, refCursor = 0;
  const project = { id: 'p', path: 'C:/root' };
  const companion = { sessionId: 'file-editor:p', project, open: true, mode: 'beside',
    collapse() { companion.open = false; }, setMode(mode) { companion.mode = mode; } };
  const session = { id: companion.sessionId, kind: 'file-editor', fileEditor: { project } };
  const settings = { fileCompanionPrimaryRatio: .55, update: async (key, value) => { saves.push([key, value]); settings[key] = value; } };
  const effects = [];
  const deps = {
    sonner: { toast: { error() {} } },
    react: { Suspense: 'Suspense', useEffect: fn => effects.push(fn), useRef: initial => {
      const i = refCursor++; return refs[i] ??= { current: initial };
    }, useState: initial => { const i = cursor++; values[i] ??= initial; return [values[i], next => { values[i] = next; }]; } },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../api/fileCompanionState': { useFileCompanionStore: () => companion },
    '../api/fileCompanionFocus': { setFileCompanionFocused: value => focus.push(value) },
    '../state': { useTerminalStore: select => select({ sessions: [session] }) },
    '../../files/api/fileExplorerStore': { useFileExplorerStore: select => select({ project }) },
    '../api/terminalProject': { isSameProjectFileContext: (a,b) => a?.id === b?.id && a?.path === b?.path },
    '../../../shared/preferences/settingsStore': { useSettingsStore: Object.assign(select => select(settings), { getState: () => settings }) },
    '../../../shared/preferences/fileCompanion': { clampFileCompanionRatio: n => Math.min(.85, Math.max(.15, n)) },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    './lazyTerminalPanels': { FileEditorPane: 'FileEditorPane' },
  };
  const exports = {};
  const code = ts.transpileModule(read('src/features/terminal/components/FileCompanionSurface.tsx'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  function render(props = {}) { cursor = refCursor = 0; effects.length = 0; return exports.FileCompanionSurface({ children: 'canonical-owner', hasTerminal: true, visible: true, background: '#000', ...props }); }
  const event = { pointerId: 1, button: 0, preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } };
  return { render, companion, saves, values, refs, focus, event };
}

test('single stable editor host keeps canonical content and collapses without discarding buffers', () => {
  const f = fixture(); let tree = f.render();
  assert.equal(nodes(tree).filter(n => n.type === 'FileEditorPane').length, 1);
  assert.equal(tree.props.children[0].props.children, 'canonical-owner');
  assert.equal(tree.props.children[0].props.style.flex, '0 0 55.00000000000001%');
  const editor = nodes(tree).find(n => n.type === 'FileEditorPane');
  assert.equal(editor.props.companion, true);
  nodes(tree).find(n => n.type === 'section').props.onFocusCapture();
  tree = f.render(); assert.equal(nodes(tree).find(n => n.type === 'FileEditorPane').props.isActive, true);
  editor.props.onClose(); tree = f.render();
  assert.equal(nodes(tree).filter(n => n.type === 'FileEditorPane').length, 1);
  assert.equal(nodes(tree).find(n => n.type === 'section').props.style.display, 'none');
  assert.equal(f.saves.length, 0);
});

test('current/full and file-alone reuse one host and never overwrite restored ratio', () => {
  const f = fixture(); f.companion.mode = 'current';
  let tree = f.render(); assert.equal(tree.props.children[0].props.style.display, 'none');
  assert.equal(nodes(tree).filter(n => n.props.role === 'separator').length, 0);
  f.companion.mode = 'beside'; tree = f.render({ hasTerminal: false });
  assert.equal(tree.props.children[0].props.style.display, 'none');
  assert.equal(nodes(tree).filter(n => n.type === 'FileEditorPane').length, 1);
  assert.equal(f.saves.length, 0);
});

test('divider drag commits only on release; cancellation and physical clamp never persist', () => {
  const f = fixture(); let tree = f.render();
  f.refs[0].current = { getBoundingClientRect: () => ({ left: 100, width: 1000 }) };
  let divider = nodes(tree).find(n => n.props.role === 'separator');
  divider.props.onPointerDown(f.event); divider.props.onPointerMove({ ...f.event, clientX: 800 });
  assert.equal(f.saves.length, 0); tree = f.render();
  divider = nodes(tree).find(n => n.props.role === 'separator'); divider.props.onPointerUp(f.event);
  assert.deepEqual(f.saves, [['fileCompanionPrimaryRatio', .7]]);
  tree = f.render(); divider = nodes(tree).find(n => n.props.role === 'separator');
  divider.props.onPointerDown(f.event); divider.props.onPointerMove({ ...f.event, clientX: 300 });
  divider.props.onPointerCancel(); assert.equal(f.saves.length, 1);
  f.values[2] = 300; tree = f.render(); // width clamp is not a saved logical ratio
  assert.equal(f.saves.length, 1);
});

test('divider supports arrow/home/end and Escape cancellation', () => {
  const f = fixture(); let tree = f.render(); let divider = nodes(tree).find(n => n.props.role === 'separator');
  divider.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  divider.props.onKeyDown({ key: 'Home', preventDefault() {} });
  divider.props.onKeyDown({ key: 'End', preventDefault() {} });
  divider.props.onKeyDown({ key: 'Escape', preventDefault() {} });
  assert.deepEqual(f.saves.map(x => x[1]), [.5700000000000001, .15, .85]);
});

test('identity ensure has no main activation, workspan/PTy creation, or buffer cleanup', () => {
  const source = read('src/features/terminal/store/terminalStore.ts');
  const action = source.slice(source.indexOf('    openFileEditorPane:'), source.indexOf('    openSyncedHistoryPane:'));
  assert.match(action, /sessions: existing/); assert.match(action, /\.show\(editorSessionId, project, mode\)/);
  assert.doesNotMatch(action, /setActive|createTerminalWorkspan|terminalProcessManager|clearWorkspace|buildWorkspanMirror/);
  const leaf = read('src/features/terminal/components/PaneLeafView.tsx');
  assert.doesNotMatch(leaf, /<FileEditorPane/);
  assert.match(read('src/features/terminal/lib/terminalPresentation.ts'), /session.kind !== "file-editor"/);
  const view = read('src/features/terminal/components/TerminalTabsView.tsx');
  assert.equal((view.match(/<FileCompanionSurface /g) ?? []).length, 1);
  assert.ok(view.indexOf('</FileCompanionSurface>') < view.indexOf('<BottomShellPanel'));
});

test('shared diff-source navigation fences leave-and-return and cleans subscriptions', () => {
  let project = { id: 'p', path: 'C:/one' }; const target = project;
  const listeners = new Set(); let cleanup;
  const refs = [];
  const exports = {};
  const code = ts.transpileModule(read('src/features/files/api/fileNavigationRequest.ts'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { useRef: initial => { const ref = { current: initial }; refs.push(ref); return ref; }, useEffect: fn => { cleanup = fn(); } };
    if (name.endsWith('/fileExplorerStore')) return { useFileExplorerStore: {
      getState: () => ({ project }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    } };
    if (name.endsWith('/terminalProject')) return { isSameProjectFileContext: (a,b) => a?.id === b?.id && a?.path === b?.path };
    throw Error(name);
  } });
  const begin = exports.useFileNavigationRequest(); const first = begin(target); assert.equal(first.current(), true);
  project = { ...project, path: 'C:/other' }; for (const fn of listeners) fn({ project });
  project = target; for (const fn of listeners) fn({ project }); assert.equal(first.current(), false);
  const second = begin(target); assert.equal(listeners.size, 1); assert.equal(second.current(), true);
  cleanup(); assert.equal(listeners.size, 0); assert.equal(second.current(), false);
});
