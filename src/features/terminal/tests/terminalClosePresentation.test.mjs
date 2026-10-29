import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const controller = readFileSync(new URL('../hooks/useTerminalTabsController.tsx', import.meta.url), 'utf8');
const source = controller.slice(controller.indexOf('  const handleCloseSessions = useCallback('), controller.indexOf('  const otherTerminalIds =', controller.indexOf('  const handleCloseSessions = useCallback(')));
function fixture() {
  const calls = [], counts = [];
  const context = {
    useCallback: fn => fn, sessions: [{ id: 'pty' }, { id: 'ssh', kind: 'pty', projectId: 'p', environmentType: 'ssh' }, { id: 'editor', kind: 'file-editor' }],
    closeSessionsWithDirtyGuard: (...args) => calls.push(args),
    shouldConfirmTerminalTabClose: count => { counts.push(count); return false; },
    armCloseConfirmOutsideGuard() {}, findCloseConfirmAnchor() {}, resolveCloseConfirmAnchor() {}, setCloseConfirm() {},
  };
  vm.runInNewContext(ts.transpileModule(source + '\nglobalThis.close = handleCloseSessions;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  return { close: context.close, calls, counts };
}
test('tab close uses presentation hide for ordinary and SSH PTYs', () => {
  const f = fixture(); f.close(['pty']); f.close(['ssh']);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(args => args[2] === false));
  assert.deepEqual(f.counts, [0, 0]);
});
test('explicit destructive close still requests destruction and confirmation', () => {
  const f = fixture(); f.close(['ssh'], undefined, [], true);
  assert.equal(f.calls[0][2], true); assert.deepEqual(f.counts, [1]);
});
test('editor retains the existing dirty guard and no PTY confirmation', () => {
  const f = fixture(); f.close(['editor']);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0][0], 'editor');
  assert.equal(f.calls[0][2], false); assert.deepEqual(f.counts, [0]);
});
test('navigation close does not force destructive mode', () => {
  const view = readFileSync(new URL('../components/TerminalTabsView.tsx', import.meta.url), 'utf8');
  const callback = view.match(/onCloseSession=\{\(id\) => \{([\s\S]*?)\}\}/)?.[1];
  assert.match(callback, /handleCloseSessions\(\[id\]\)/);
  assert.doesNotMatch(callback, /true/);
});
