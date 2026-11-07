import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, ...globals, require: name => mocks[name] ?? load(resolve(dirname(path), `${name}.ts`), mocks, globals) });
  return exports;
}
const projectHelpers = load('src/features/terminal/api/terminalProject.ts', {
  '../../projects/api/worktreeMetadata': { getWorktreeDisplayName: w => w.name },
});
const scopeHelpers = load('src/features/terminal/api/terminalScope.ts', { './terminalProject': projectHelpers });
const { isOperableNavigationSession } = load('src/features/terminal/lib/terminalNavigationModel.ts', {
  '../api/terminalScope': scopeHelpers, '../api/terminalProject': projectHelpers,
});
const source = readFileSync('src/app/App.tsx', 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('const reconcileTerminalTargetScope')) effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect, 'execute the production App effect callback');
function harness({ enabled = true, scope = { kind: 'project', projectId: 'a' } } = {}) {
  const projects = [{ id: 'a', path: 'C:/a' }, { id: 'b', path: 'C:/b' }];
  const worktrees = [{ id: 'wb', project_id: 'b', path: 'C:/trees/b', status: 'active' }];
  const sessions = [{ id: 'old', projectId: 'a', cwd: 'C:/a' },
    { id: 'other', projectId: 'b', cwd: 'C:/b', tabHidden: true },
    { id: 'tree', cwd: 'C:/trees/b/src', tabHidden: true },
    { id: 'independent', cwd: 'D:/alone' },
    { id: 'dormant', projectId: 'b', cwd: 'C:/b', tabHidden: true },
    { id: 'editor', kind: 'file-editor' }, { id: 'background', transientBackground: true },
    { id: 'handoff', remoteHandoff: {} }];
  const state = { sessions, sessionStatuses: {} };
  let currentScope = scope, cleanup, flushes = 0, selected = 'old', activations = 0, restores = 0;
  let bottomShell = { id: 'aux', active: true };
  const listeners = [];
  const window = {
    addEventListener(type, callback, capture = false) { listeners.push({ type, callback, capture }); },
    removeEventListener(type, callback, capture = false) {
      const index = listeners.findIndex(x => x.type === type && x.callback === callback && x.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const globals = { window, terminalScope: currentScope, ...projectHelpers, isOperableNavigationSession,
    ALL_TERMINALS_SCOPE: scopeHelpers.ALL_TERMINALS_SCOPE,
    TERMINAL_RESOURCE_TARGET_EVENT: 'resource', TERMINAL_SESSION_TARGET_EVENT: 'session',
    useTerminalStore: { getState: () => state }, useSettingsStore: { getState: () => ({ projectScopedTerminalViewEnabled: enabled }) },
    useProjectStore: { getState: () => ({ projects }) }, useWorktreeStore: { getState: () => ({ worktrees }) },
    setTerminalScope(next) { currentScope = next; }, flushSync(fn) { flushes++; fn(); },
  };
  // Register bubble first, like the child effect: capture must still run before it.
  const effects = [];
  const { useTerminalNavigationListeners } = load('src/features/terminal/hooks/useTerminalNavigationListeners.ts', {
    react: { useEffect: fn => effects.push(fn) }, '../../workspace/api/primarySpaceState': { showProjectSpace() {} },
    '../../history/index': { useHistoryStore: { getState: () => ({ closeHistory() {} }) } },
    '../state': { useTerminalStore: globals.useTerminalStore }, '../api/terminalNavigationEvents': { TERMINAL_SESSION_TARGET_EVENT: 'session' },
    '../lib/terminalResourceNavigation': { ...load('src/features/terminal/lib/terminalResourceNavigation.ts'), TERMINAL_RESOURCE_TARGET_EVENT: 'resource' },
  }, { window });
  useTerminalNavigationListeners({ setActive(id) {
    activations++;
    const target = state.sessions.find(s => s.id === id);
    assert.ok(scopeHelpers.sessionMatchesTerminalScope(target, currentScope, state.sessions, projects,
      new Map(projects.map(p => [p.id, p])), worktrees), 'target fits committed outer scope before activation');
    if (id === 'dormant') { restores++; selected = 'canonical-final'; } else selected = id;
  }, setActiveWorkspaceTab() {} });
  const removeBubble = effects[0]();
  function mount() {
    globals.terminalScope = currentScope;
    const code = ts.transpileModule(`const setup = ${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    cleanup = vm.runInNewContext(`(() => { ${code}\nreturn setup(); })()`, globals);
  }
  mount();
  return { state, send(type, sessionId) {
    let stopped = false;
    const event = { detail: { sessionId }, stopImmediatePropagation() { stopped = true; } };
    for (const listener of [...listeners].filter(x => x.type === type).sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if (!stopped) listener.callback(event);
    }
    cleanup(); mount();
  }, snapshot: () => ({ scope: JSON.parse(JSON.stringify(currentScope)), selected, activations, restores, flushes, bottomShell }),
  close() { cleanup(); removeBubble(); assert.equal(listeners.length, 0); } };
}
for (const type of ['resource', 'session']) {
  test(`${type}: cross-project, cwd worktree, independent and canonical dormant activation`, () => {
    const h = harness();
    const bottom = h.snapshot().bottomShell;
    for (const [id, scope] of [['other', { kind: 'project', projectId: 'b' }],
      ['tree', { kind: 'worktree', projectId: 'b', worktreeId: 'wb' }],
      ['independent', { kind: 'all' }], ['dormant', { kind: 'project', projectId: 'b' }]]) {
      h.send(type, id);
      assert.deepEqual(h.snapshot().scope, scope);
      assert.equal(h.snapshot().selected, id === 'dormant' ? 'canonical-final' : id);
      assert.equal(h.snapshot().bottomShell, bottom);
    }
    assert.equal(h.snapshot().activations, 4); assert.equal(h.snapshot().restores, 1);
    h.close();
  });
  test(`${type}: missing/deleted/inoperable/malformed targets are no-ops`, () => {
    const h = harness(); const before = h.snapshot();
    h.state.sessions = h.state.sessions.filter(s => s.id !== 'other');
    for (const id of ['missing', 'other', 'editor', 'background', 'handoff', undefined, 12]) h.send(type, id);
    assert.deepEqual(h.snapshot(), before); h.close();
  });
  test(`${type}: same scope and disabled filtering do not flush`, () => {
    const h = harness({ scope: { kind: 'project', projectId: 'b' } });
    h.send(type, 'other'); assert.equal(h.snapshot().flushes, 0); h.close();
    const global = harness({ enabled: false, scope: { kind: 'all' } });
    global.send(type, 'tree'); assert.equal(global.snapshot().flushes, 0); global.close();
  });
}
test('App scope effect does not duplicate canonical activation or reopen; startup load failure gate remains', () => {
  assert.doesNotMatch(effect, /setActive\(|reopen|restoreDormant/);
  assert.match(source, /Failed loading is not an empty snapshot/);
  const notification = source.slice(source.indexOf('const handleActivateHookNotificationTarget'), source.indexOf('useRemoteHandoffCoordinator(startupReady)'));
  assert.doesNotMatch(notification, /\.setActive\(/);
});
