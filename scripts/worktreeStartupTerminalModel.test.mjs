import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute real pure models, excluding UI/native imports and re-exports only.
function load(path, dependencies = {}) {
  const text = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node)
    && !(ts.isExportDeclaration(node) && node.moduleSpecifier)).map(node => node.getText(source)).join('\n');
  const exports = {};
  const code = ts.transpileModule(body, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, ...dependencies }, { filename: path });
  return exports;
}
const finish = load('src/features/projects/api/worktreeFinish.ts');
const metadata = load('src/features/projects/api/worktreeMetadata.ts');
const identity = load('src/features/terminal/api/terminalProject.ts', metadata);
const membership = load('src/features/terminal/api/terminalProjectTabsModel.ts', identity);
const tabs = load('src/features/terminal/lib/terminalTabsModel.ts', metadata);
const models = load('src/features/terminal/lib/workspanTabModel.ts', { ...tabs, ...membership, inferVendor: () => null });
const project = { id: 'p1', name: 'Project', path: 'D:/main', shell: 'powershell', cli_tool: '' };
const wt = { id: 'w1', project_id: project.id, name: 'one', display_name: 'Task One', branch: 'wt/one', path: 'D:/tasks/one' };
const labels = { unboundProject: 'Unbound', missingWorktree: 'Missing', defaultShell: 'Shell' };
const state = (patch = {}) => ({ checkoutValid: true, merged: true, outcome: 'merged', sourceOid: 'base',
  cleanupReady: false, cleanupPending: false, blocker: 'finish_dirty_checkout', unknown: false,
  done: false, stashReference: null, mergeResult: null, ...patch });

test('reconciled active versus true pending keeps terminal identity/cwd and active-only label/group gate', () => {
  const sessions = [{ id: 'hidden', projectId: project.id, worktreeId: wt.id, cwd: wt.path, cliSessionId: 'cli-1', title: 'Hidden', hidden: true },
    { id: 'root', projectId: project.id, cwd: project.path, cliSessionId: 'cli-root', title: 'Root' }];
  const before = JSON.stringify(sessions);
  const projects = new Map([[project.id, project]]);
  const workspan = { id: 'mixed', activeSessionId: 'hidden', paneTree: { type: 'split', id: 'split', direction: 'horizontal', ratio: 0.5,
    first: { type: 'leaf', id: 'a', sessionIds: ['root'], activeSessionId: 'root' },
    second: { type: 'leaf', id: 'b', sessionIds: ['hidden'], activeSessionId: 'hidden' },
  } };
  const layout = { workspan, sessionIds: ['root', 'hidden'], closeSessionIds: ['root', 'hidden'] };
  for (const [authority, expectedKind] of [[state(), 'worktree'], [state({ cleanupPending: true }), 'missing-worktree'],
    [state({ checkoutValid: false, cleanupPending: true, done: true }), 'missing-worktree'],
    [state({ checkoutValid: false, merged: false, outcome: null, unknown: true, blocker: null }), 'missing-worktree']]) {
    const record = { ...wt, status: finish.finishStatus(authority) };
    const context = tabs.buildTerminalTabContext(sessions[0], project, record, labels, [record]);
    const member = membership.resolveTerminalProjectMembership(sessions[0], sessions, projects, [record], labels);
    assert.equal(context.unresolvedWorktree, expectedKind !== 'worktree');
    assert.equal(context.worktreeFull, expectedKind === 'worktree' ? 'Task One' : undefined);
    assert.equal(member.worktreeKind, expectedKind);
    assert.equal(member.worktreeId, wt.id); assert.equal(member.sessionId, 'hidden');
    assert.equal(member.worktreePath, expectedKind === 'worktree' ? wt.path : null);
    const result = models.buildWorkspanTabModels([layout], sessions, projects, {}, key => key, [record], labels);
    assert.equal(result[0].projectMemberships[0].members.find(item => item.sessionId === 'hidden').worktreeKind, expectedKind);
    assert.strictEqual(result[0].workspan, workspan);
    assert.strictEqual(result[0].sessionIds, layout.sessionIds);
    assert.strictEqual(result[0].closeSessionIds, layout.closeSessionIds);
    assert.equal(JSON.stringify(sessions), before);
  }
});

// Reuse the existing native-mocked real TerminalStore fixture without editing
// the pre-existing dirty lifecycle test file or executing its unrelated cases.
function restoreFixture() {
  const url = new URL('../src/features/terminal/tests/terminalTabLifecycle.test.mjs', import.meta.url);
  const text = readFileSync(url, 'utf8').split('test("ordinary close hides')[0];
  const source = ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n')
    .replaceAll('import.meta.url', JSON.stringify(url.href));
  const context = { readFileSync, runInNewContext: vm.runInNewContext, ts, URL, assert };
  vm.runInNewContext(body + '\nthis.restoreTestFixture = fixture; this.restoreTestSpan = span;', context);
  return { fixture: context.restoreTestFixture, span: context.restoreTestSpan };
}
test('actual daemon attach and snapshot recreate preserve project/worktree/cwd/CLI identity and hidden state', async () => {
  const { fixture, span } = restoreFixture();
  for (const daemon of [false, true]) for (const worktreeId of [undefined, wt.id]) for (const tabHidden of [false, true]) {
    const original = { id: 'saved', title: 'Saved', projectId: project.id, worktreeId,
      cwd: worktreeId ? wt.path : project.path, cliSessionId: 'cli-saved', tabHidden,
      isAgentSession: false, startupCmd: '', shell: 'powershell', environmentType: 'local' };
    const f = fixture([original], [span('w', 'pane', original.id)], daemon ? [{ sessionId: original.id, alive: true }] : [],
      [project], [{ ...wt, status: 'active' }]);
    await f.api.getState().restoreSessions(new Map([[project.id, project]]), {});
    const restored = f.api.getState().sessions[0];
    assert.equal(restored.id, daemon ? original.id : 'recreated');
    for (const key of ['projectId', 'worktreeId', 'cwd', 'cliSessionId', 'tabHidden']) {
      assert.equal(restored[key], original[key], `${key} survives ${daemon ? 'attach' : 'recreate'}`);
    }
    assert.equal(f.calls.some(([kind]) => kind === 'close'), false);
    assert.equal(f.calls.some(([kind]) => kind === 'create'), !daemon);
  }
});
