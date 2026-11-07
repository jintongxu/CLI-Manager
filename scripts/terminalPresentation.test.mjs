import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, mocks = {}) {
  const filename = resolve(path); const exports = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => mocks[name] ?? load(resolve(dirname(filename), `${name}.ts`), mocks) });
  return exports;
}
const react = { useMemo: (fn) => fn() };
const { useTerminalPresentation: present } = load('src/features/terminal/hooks/useTerminalPresentation.ts', { react });
const { buildTerminalNavigationModel: navigate } = load('src/features/terminal/lib/terminalNavigationModel.ts');
const { terminalPresentationAllowedIds: allowed } = load('src/features/terminal/lib/terminalPresentation.ts');
const { sessionMatchesTerminalScope: matches, collectProjectIdsForGroup } = load('src/features/terminal/api/terminalScope.ts');
const { collectPaneLeaves } = load('src/features/terminal/api/terminalPaneTree.ts');
const ids = (set) => Array.from(set).sort();
const leaf = (id, sessionIds, activeSessionId = sessionIds[0]) => ({ type: 'leaf', id, sessionIds, activeSessionId });
const split = (first, second) => ({ type: 'split', id: 'branch', direction: 'horizontal', ratio: .37, first, second });
const span = (id, tree) => ({ id, paneTree: tree, activePaneId: collectPaneLeaves(tree)[0].id, activeSessionId: collectPaneLeaves(tree)[0].activeSessionId });
const projects = [{ id: 'orchard', path: 'C:/orchard', group_id: 'child' }, { id: 'lagoon', path: 'D:/lagoon', group_id: 'elsewhere' }];
const groups = [{ id: 'family' }, { id: 'child', parent_id: 'family' }];
const worktrees = [{ id: 'sprout', project_id: 'orchard', path: 'C:/sprout' }];
const scopes = [{ kind: 'all' }, { kind: 'group', groupId: 'family' }, { kind: 'project', projectId: 'orchard' }, { kind: 'worktree', projectId: 'orchard', worktreeId: 'sprout' }];
for (const environmentType of ['local', 'wsl', 'ssh']) for (const scope of scopes) for (const geometry of ['single', 'multi', 'split']) {
  test(`${scope.kind}/${environmentType}/${geometry}: canonical navigation/content/focus boundary`, () => {
    const sessions = [
      { id: 'closing', title: 'any terminal', projectId: 'orchard', worktreeId: 'sprout', environmentType: 'local', tabHidden: true },
      { id: 'ordinary', title: 'remaining', projectId: 'orchard', worktreeId: 'sprout', environmentType },
      { id: 'member', title: 'existing output', projectId: 'orchard', worktreeId: 'sprout', environmentType: 'ssh', connectionState: 'disconnected' },
      { id: 'outside', title: 'outside scope', projectId: 'lagoon', environmentType: 'ssh' },
      { id: 'hidden-member', title: 'hidden', projectId: 'orchard', worktreeId: 'sprout', tabHidden: true },
    ];
    const scoped = scope.kind === 'all' ? null : new Set(sessions.filter((s) => matches(s, scope, sessions, projects, new Map(projects.map((p) => [p.id, p])), worktrees, collectProjectIdsForGroup(groups, projects, 'family'))).map((s) => s.id));
    const tree = geometry === 'split' ? split(leaf('one', ['closing', 'member'], 'member'), leaf('two', ['ordinary', 'outside', 'hidden-member'])) : leaf('one', sessions.map((s) => s.id), 'member');
    const backing = geometry === 'multi' ? sessions.map((s) => span(`span-${s.id}`, leaf(`pane-${s.id}`, [s.id]))) : [span('span', tree)];
    const before = JSON.stringify({ sessions, backing });
    const result = present(backing, sessions, scoped, backing[0].id, 'member', 'two');
    const expected = scope.kind === 'all' ? ['member', 'ordinary', 'outside'] : ['member', 'ordinary'];
    assert.deepEqual(ids(result.visibleSessionIds), expected);
    const nav = navigate({ sessions, projects, groups, worktrees, scope, sessionStatuses: { member: 'exited' }, currentSessionId: 'member' }, { pinnedIds: [], recentIds: [] });
    assert.deepEqual(ids(allowed(sessions, new Set(nav.entries.map((e) => e.id)))), expected);
    assert.ok(expected.includes(result.effectiveActiveSessionId));
    assert.equal(result.mountedWorkspanLayouts.length, backing.length);
    result.mountedWorkspanLayouts.forEach((layout, i) => assert.equal(layout.paneTree, backing[i].paneTree));
    // Last allowed member disappears: global active ID may remain disallowed, presentation must be empty.
    const hidden = sessions.map((s) => expected.includes(s.id) ? { ...s, tabHidden: true } : s);
    const empty = present(backing, hidden, scoped, backing[0].id, 'member', null);
    assert.equal(empty.visibleSessions.length, 0);
    assert.equal(empty.effectiveActiveSessionId, null);
    assert.equal(empty.visibleWorkspanLayouts.length, 0);
    // Scope changes geometry/focus only, never canonical owner identity or split ratios.
    const unscoped = present(backing, sessions, null, backing[0].id, 'member', null);
    assert.deepEqual(ids(unscoped.visibleSessionIds), ['member', 'ordinary', 'outside']);
    for (const layout of result.mountedWorkspanLayouts) {
      assert.equal(layout.workspan, backing.find((owner) => owner.id === layout.workspan.id));
      assert.ok([...layout.closeSessionIds].every((id) => result.visibleSessionIds.has(id)));
    }
    if (geometry === 'split') {
      assert.equal(result.renderPaneTree.type, 'split');
      assert.equal(result.renderPaneTree.ratio, .37);
      assert.equal(result.activeFullscreenPaneId, 'two');
    }
    assert.equal(JSON.stringify({ sessions, backing }), before);
  });
}

test('one navigation collection reaches sessions across canonical workspans without flattening geometry', () => {
  const sessions = ['a', 'b', 'c'].map(id => ({ id, title: id, projectId: 'orchard' }));
  const tree = split(leaf('one', ['a']), leaf('two', ['b']));
  const backing = [span('split-span', tree), span('other-span', leaf('three', ['c']))];
  const navigation = navigate({ sessions, projects, groups, worktrees, scope: { kind: 'all' },
    sessionStatuses: {}, currentSessionId: 'a' }, { pinnedIds: [], recentIds: [] });
  assert.deepEqual(Array.from(navigation.entries, entry => entry.id), ['a', 'b', 'c']);
  for (const entry of navigation.entries) {
    const owner = backing.find(layout => collectPaneLeaves(layout.paneTree).some(pane => pane.sessionIds.includes(entry.id)));
    const result = present(backing, sessions, null, owner.id, entry.id, null);
    assert.equal(result.effectiveActiveSessionId, entry.id);
    assert.equal(result.effectiveActiveWorkspanId, owner.id);
    assert.equal(result.mountedWorkspanLayouts[0].paneTree, tree);
    assert.equal(result.mountedWorkspanLayouts[0].paneTree.ratio, .37);
  }
});
