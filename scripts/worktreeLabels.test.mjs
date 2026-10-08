import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
function load(file, deps = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, console, setTimeout, crypto: { randomUUID }, require(name) {
    if (name in deps) return deps[name];
    if (name.endsWith('/worktreeCreationRecovery')) return load('src/features/projects/api/worktreeCreationRecovery.ts', {});
    throw Error('unexpected dependency ' + name);
  } });
  return exports;
}
const labels = load('src/features/projects/api/worktreeLabels.ts');
test('canonical aliases count Unicode points, preserve full tokens and reserve all W digits', () => {
  assert.equal(labels.normalizeWorktreeShortLabel('  e\u0301  '), 'é');
  assert.equal(labels.normalizeWorktreeShortLabel('😀'.repeat(12)), '😀'.repeat(12));
  assert.equal(labels.normalizeWorktreeShortLabel('   '), '');
  for (const input of ['W1', 'w000', 'W2147483648', 'W100']) assert.throws(() => labels.normalizeWorktreeShortLabel(input), /reserved/);
  assert.throws(() => labels.normalizeWorktreeShortLabel('😀'.repeat(13)), /too_long/);
  for (const input of ['x\n', '\tx', '\u0000', 'x\u0085', '\u202ex', '\u2066x', '\u061cx', '\u2028']) assert.throws(() => labels.normalizeWorktreeShortLabel(input), /invalid/);
  assert.equal(labels.getWorktreeShortLabel({ short_label: '完整的别名', label_ordinal: 7 }), '完整的别名');
  assert.equal(labels.getWorktreeShortLabel({ short_label: '', label_ordinal: 7 }), 'W7');
  for (const row of [null, {}, { label_ordinal: 0 }, { label_ordinal: 1.5 }, { label_ordinal: 2147483648 }]) assert.equal(labels.getWorktreeShortLabel(row), '');
  assert.equal(labels.worktreeShortLabelComparisonKey('FooÄ'), 'fooÄ');
});
function harness() {
  let state, fail = '', gitGate;
  const rows = [], calls = [], statements = [];
  const project = { id: 'p', path: 'D:/repo', worktree_root: '' };
  const db = {
    async select(sql, args) {
      if (sql.startsWith('SELECT id')) return rows.filter(row => row.project_id === args[0] && labels.worktreeShortLabelComparisonKey(row.short_label) === labels.worktreeShortLabelComparisonKey(args[1]) && row.id !== args[2]);
      if (fail === 'readback') throw Error('read failed');
      return rows.filter(row => row.id === args[0]);
    },
    async execute(sql, args) {
      statements.push([sql, args]);
      if (fail === 'sql') throw Error('UNIQUE constraint failed: worktrees.project_id, worktrees.short_label');
      if (sql.startsWith('INSERT')) {
        const keys = ['id','project_id','name','display_name','description','branch','path','base_branch','deps_prompt_dismissed','provider_overrides','status','created_at','updated_at','short_label'];
        rows.push({ ...Object.fromEntries(keys.map((key, i) => [key, args[i]])), label_ordinal: 17 });
      }
    },
  };
  const api = load('src/features/projects/api/worktreeStore.ts', {
    './worktreeLabels': labels,
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push(command); if (gitGate) await gitGate();
      return { name: args.req.taskName, path: 'D:/created', branch: 'wt/fixed', baseBranch: 'main' };
    } },
    zustand: { create: init => { state = init(update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; }, () => state); return { getState: () => state }; } },
    '../../../shared/platform/db': { getDb: async () => db },
    '../../../shared/platform/logger': { logWarn() {} },
    '../../providers/api/providerSwitching': {}, './projectCapabilities': { projectSupportsCapability: () => true },
    './projectStore': { useProjectStore: { getState: () => ({ fetchAll: async () => { if (fail === 'refresh') throw Error('refresh failed'); } }) } },
    './worktreeFinish': {}, './worktreeForceDelete': {}, '../../../shared/lib/worktreeLaunchAdmission': {}, '../../terminal/state': {},
  });
  return { get store() { return api.useWorktreeStore.getState(); }, rows, calls, statements, project,
    fail(value) { fail = value; }, gate(fn) { gitGate = fn; },
    create(shortLabel = '') { return this.store.createWorktreeForProject(project, { taskName: 'fixed', displayName: '显示名', shortLabel }); },
  };
}
test('Store creates canonical alias, reads trigger ordinal and edits without changing identity or ordinal', async () => {
  const h = harness(), row = await h.create(' e\u0301 ');
  assert.equal(row.short_label, 'é'); assert.equal(row.label_ordinal, 17);
  assert.equal(h.store.worktrees[0], row);
  await h.store.updateWorktreeMetadata(row.id, 'New', 'Description');
  assert.equal(h.store.worktrees[0].short_label, 'é');
  assert.doesNotMatch(h.statements.at(-1)[0], /short_label|label_ordinal/);
  await h.store.updateWorktreeMetadata(row.id, 'New', 'Description', '');
  assert.equal(labels.getWorktreeShortLabel(h.store.worktrees[0]), 'W17');
  assert.equal(h.store.worktrees[0].name, 'fixed'); assert.equal(h.store.worktrees[0].path, 'D:/created');
});
test('invalid and duplicate aliases fail before Git; current-row edit allowed; ASCII NOCASE matches DB', async () => {
  const h = harness();
  await assert.rejects(h.create('W100'), /reserved/); assert.equal(h.calls.length, 0);
  const row = await h.create('Build');
  await assert.rejects(h.create('build'), /worktree_short_label_conflict/); assert.equal(h.calls.length, 1);
  await h.store.updateWorktreeMetadata(row.id, 'New', '', 'BUILD');
  h.rows.push({ id: 'other', project_id: 'p', short_label: 'Taken' });
  await assert.rejects(h.store.updateWorktreeMetadata(row.id, 'New', '', 'taken'), /conflict/);
});
test('Git-success SQL/readback/refresh failures retain objects and expose distinct persisted-state errors', async () => {
  for (const [failure, code, persisted, local] of [
    ['sql', 'worktree_record_save_failed', 0, 0],
    ['readback', 'worktree_record_readback_failed', 1, 0],
    ['refresh', 'worktree_record_refresh_failed', 1, 1],
  ]) {
    const h = harness(); h.fail(failure);
    await assert.rejects(h.create(), new RegExp(code + '.*D:/created'));
    assert.deepEqual(h.calls, ['git_worktree_create']);
    assert.equal(h.rows.length, persisted); assert.equal(h.store.worktrees.length, local);
    const { WorktreeCreationAttempts } = load('src/features/projects/api/worktreeCreationRecovery.ts');
    const attempts = new WorktreeCreationAttempts();
    const guarded = harness(); guarded.fail(failure);
    await assert.rejects(attempts.run('form', () => guarded.create()), new RegExp(code));
    guarded.fail('');
    await assert.rejects(attempts.run('form', () => guarded.create('changed')), new RegExp(code));
    assert.equal(guarded.calls.length, 1);

  }
});
test('metadata refresh failure reports a saved edit, SQL failure never changes local metadata', async () => {
  const h = harness(), row = await h.create('First');
  h.fail('sql');
  await assert.rejects(h.store.updateWorktreeMetadata(row.id, 'Changed', '', 'Second'), /worktree_short_label_conflict/);
  assert.equal(h.store.worktrees[0].short_label, 'First');
  h.fail('refresh');
  await assert.rejects(h.store.updateWorktreeMetadata(row.id, 'Changed', '', 'Second'), /worktree_metadata_refresh_failed/);
  assert.equal(h.store.worktrees[0].short_label, 'Second');
});
test('race after preflight remains a DB conflict wrapped with created path, never rollback Git', async () => {
  const h = harness(); h.gate(() => h.fail('sql'));
  await assert.rejects(h.create('Alias'), /worktree_record_save_failed:.*D:\/created;.*worktree_short_label_conflict/);
  assert.deepEqual(h.calls, ['git_worktree_create']);
});
test('project search matches full alias and immutable default even while alias is selected', () => {
  // Load actual buildTree with inert dependencies: only tree building executes here.
  const source = readFileSync('src/features/projects/api/projectStore.ts', 'utf8');
  const code = ts.transpileModule(source + '\nexport { buildTree };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const settings = { useSettingsStore: { subscribe() {}, getState: () => ({ worktreeOrderByProject: {} }) } };
  vm.runInNewContext(code, { exports, require(name) {
    if (name === './worktreeLabels') return labels;
    if (name.includes('worktreeOrder')) return { orderProjectWorktrees: rows => rows };
    if (name.includes('settingsStore')) return settings;
    if (name === 'zustand') return { create: () => ({}) };
    return {};
  } });
  const projects = [{ id: 'p', name: 'Project', cli_tool: '', path: 'repo', group_name: '', group_id: null, sort_order: 0 }];
  const row = { id: 'w', project_id: 'p', name: 'internal', display_name: 'Task', branch: 'wt/internal', description: '', short_label: 'Alias', label_ordinal: 17 };
  assert.equal(exports.buildTree([], projects, 'alias', [row]).length, 1);
  assert.equal(exports.buildTree([], projects, 'w17', [row]).length, 1);
  assert.equal(exports.buildTree([], projects, 'w18', [row]).length, 0);
});
