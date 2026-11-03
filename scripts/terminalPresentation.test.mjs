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
const react = { useMemo: (fn) => fn(), useCallback: (fn) => fn,
  useState: () => [new Map([['cw-left', { target: 'left' }], ['cw-right', { target: 'right' }]]), () => {}] };
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
for (const environmentType of ['local', 'wsl', 'ssh']) for (const scope of scopes) for (const mode of [false, true]) for (const geometry of ['single', 'multi', 'split']) {
  test(`${scope.kind}/${mode ? 'CW' : 'ordinary'}/${environmentType}/${geometry}: shared navigation/content/focus/portal boundary`, () => {
    const sessions = [
      { id: 'closing', title: 'any terminal', projectId: 'orchard', worktreeId: 'sprout', environmentType: 'local', tabHidden: true },
      { id: 'ordinary', title: 'remaining', projectId: 'orchard', worktreeId: 'sprout', environmentType },
      { id: 'member', title: 'existing output', projectId: 'orchard', worktreeId: 'sprout', environmentType: 'ssh', connectionState: 'disconnected' },
      { id: 'outside', title: 'outside scope', projectId: 'lagoon', environmentType: 'ssh' },
      { id: 'hidden-member', title: 'hidden', projectId: 'orchard', worktreeId: 'sprout', tabHidden: true },
    ];
    const members = ['member', 'outside', 'hidden-member'];
    const scoped = scope.kind === 'all' ? null : new Set(sessions.filter((s) => matches(s, scope, sessions, projects, new Map(projects.map((p) => [p.id, p])), worktrees, collectProjectIdsForGroup(groups, projects, 'family'))).map((s) => s.id));
    const tree = geometry === 'split' ? split(leaf('one', ['closing', 'member'], 'member'), leaf('two', ['ordinary', 'outside', 'hidden-member'])) : leaf('one', sessions.map((s) => s.id), 'member');
    const backing = geometry === 'multi' ? sessions.map((s) => span(`span-${s.id}`, leaf(`pane-${s.id}`, [s.id]))) : [span('span', tree)];
    const cw = split(leaf('cw-left', ['hidden-member', 'member'], 'hidden-member'), leaf('cw-right', ['outside']));
    const before = JSON.stringify({ sessions, backing, cw });
    const result = present(backing, sessions, scoped, backing[0].id, 'member', 'two', members, mode, cw, 'outside');
    const expected = mode ? (scope.kind === 'all' ? ['member', 'outside'] : ['member']) : ['ordinary'];
    assert.deepEqual(ids(result.visibleSessionIds), expected);
    const nav = navigate({ sessions, projects, groups, worktrees, scope, sessionStatuses: { member: 'exited' }, currentSessionId: 'member', currentWorkSessionIds: members, currentWorkMode: mode }, { pinnedIds: [], recentIds: [] });
    assert.deepEqual(ids(allowed(sessions, new Set(nav.entries.map((e) => e.id)), members, mode)), expected);
    assert.ok(expected.includes(result.effectiveActiveSessionId));
    assert.equal(result.mountedWorkspanLayouts.length, backing.length);
    result.mountedWorkspanLayouts.forEach((layout, i) => assert.equal(layout.paneTree, backing[i].paneTree));
    if (mode) {
      assert.deepEqual(ids(result.currentWorkVisibleSessionIds), expected);
      assert.deepEqual(ids(result.currentWorkSessionPortalTargets.keys()), expected);
      assert.ok(expected.includes(result.currentWorkActiveSessionId));
    } else assert.equal(result.currentWorkSessionPortalTargets.size, 0);
    // Last allowed member disappears: global active ID may remain disallowed, presentation must be empty.
    const hidden = sessions.map((s) => expected.includes(s.id) ? { ...s, tabHidden: true } : s);
    const empty = present(backing, hidden, scoped, backing[0].id, 'member', null, members, mode, cw, 'outside');
    assert.equal(empty.visibleSessions.length, 0);
    assert.equal(empty.effectiveActiveSessionId, null);
    assert.equal(empty.visibleWorkspanLayouts.length, 0);
    assert.equal(empty.currentWorkSessionPortalTargets.size, 0);
    // Switching mode recomputes membership without changing backing state.
    const switched = present(backing, sessions, scoped, backing[0].id, 'member', null, members, !mode, cw, 'outside');
    assert.ok([...switched.visibleSessionIds].every((id) => !result.visibleSessionIds.has(id)));
    assert.equal(JSON.stringify({ sessions, backing, cw }), before);
  });
}
