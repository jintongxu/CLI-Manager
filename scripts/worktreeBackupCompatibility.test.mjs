import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
function load(path, deps = {}, suffix = '') {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8') + suffix, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console, TextEncoder, require: name => deps[name] ?? {} });
  return exports;
}
const labels = load('src/features/projects/api/worktreeLabels.ts');
const db = load('src/shared/platform/db.ts');
const invocations = [];
const api = load('src/features/sync/api/syncStore.ts', {
  '@tauri-apps/api/core': { invoke: async (command) => { invocations.push(command); throw Error('transaction rolled back'); } },
  zustand: { create: () => ({}) },
  '../../../shared/platform/db': db,
  '../../projects/api/worktreeLabels': labels,
  '../../../shared/platform/shell': { getOsPlatform: async () => 'windows', defaultShellForOs: () => 'powershell', normalizeShellForOs: value => value || 'powershell' },
  '../../projects/api/nodeAppearance': { normalizeNodeIcon: () => '', normalizeNodeAccentToken: () => '' },
  '../../remote/api/sshToolIntegration': { validateSshToolConfigRoot: () => '' },
}, '\nexport { buildWorkspaceRestoreStatements, collectBackupData, applySnapshot };');
const project = (id = 'p', high = undefined) => ({ id, name: id, path: '/repo', worktree_label_high_water: high });
const tree = (id, ordinal, alias = '') => ({ id, project_id: 'p', name: id, branch: id, path: '/'+id, created_at: '1', label_ordinal: ordinal, short_label: alias });
const workspace = (projects, worktrees) => ({ projects, worktrees, groups: [], commandTemplates: [] });
function rows(statements, table) {
  return Array.from(statements).filter(s => s.sql.startsWith('INSERT INTO '+table+' ')).flatMap(s => {
    const columns = s.sql.match(/\(([^)]+)\)/)[1].split(',');
    return Array.from({ length: s.values.length / columns.length }, (_, n) => Object.fromEntries(columns.map((c, i) => [c, s.values[n * columns.length + i]])));
  });
}
test('new backup explicitly selects label metadata including empty project highwater', () => {
  const source = readFileSync('src/features/sync/api/syncStore.ts', 'utf8');
  assert.match(source, /updated_at, worktree_label_high_water FROM projects/);
  assert.match(source, /updated_at, short_label, label_ordinal FROM worktrees/);
});
test('mixed restore canonicalizes aliases and orders explicit ordinals before deterministic legacy rows', async () => {
  const statements = await api.buildWorkspaceRestoreStatements(workspace([project('p', 20), project('empty', 40)], [tree('z'), tree('a'), tree('explicit', 5, ' e\u0301 ')]));
  assert.deepEqual(rows(statements, 'projects').map(p => p.worktree_label_high_water), [20, 40]);
  assert.deepEqual(rows(statements, 'worktrees').map(w => [w.id, w.label_ordinal, w.short_label]), [['explicit', 5, 'é'], ['a', null, ''], ['z', null, '']]);
  assert.ok(statements.every(s => !s.sql.includes('OR REPLACE')));
});
test('invalid labels or numbers reject entire statement build, including orphan input', async () => {
  for (const short_label of ['W1', 'x\n', '\u202ex', 'a'.repeat(13), null, 42]) {
    await assert.rejects(api.buildWorkspaceRestoreStatements(workspace([project()], [{ ...tree('bad'), project_id: 'orphan', short_label }])), /worktree_short_label/);
  }
  for (const n of [-1, 0, 1.5, '2', 2147483648]) await assert.rejects(api.buildWorkspaceRestoreStatements(workspace([project()], [tree('bad', n)])), /number_invalid/);
  for (const n of [-1, 1.5, '2', 2147483648]) await assert.rejects(api.buildWorkspaceRestoreStatements(workspace([project('p', n)], [])), /number_invalid/);
});
test('actual generated SQL restores with migration 50 and rolls back conflicts in real temporary SQLite', async () => {
  const mixed = await api.buildWorkspaceRestoreStatements(workspace([project('p', 20), project('empty', 40)], [tree('z'), tree('a'), tree('explicit', 5, ' e\u0301 ')]));
  const legacy = await api.buildWorkspaceRestoreStatements(workspace([project()], [tree('z'), tree('a')]));
  const conflict = await api.buildWorkspaceRestoreStatements(workspace([project()], [tree('one', 1, 'Case'), tree('two', 2, 'case')]));
  const python = `import json,sqlite3,sys,tempfile,pathlib
payload=json.load(sys.stdin)
with tempfile.TemporaryDirectory() as tmp:
 c=sqlite3.connect(str(pathlib.Path(tmp)/'restore.db'))
 # Derive pre-50 fixture columns from actual generated restore SQL.
 for table in ['projects','worktrees']:
  s=next(s for s in payload['mixed'] if s['sql'].startswith('INSERT INTO '+table+' '))
  cols=s['sql'].split('(',1)[1].split(')',1)[0].split(',')
  cols=[x for x in cols if x not in ['short_label','label_ordinal','worktree_label_high_water']]
  c.execute('CREATE TABLE '+table+' ('+','.join(x+(' TEXT PRIMARY KEY' if x=='id' else ' TEXT') for x in cols)+')')
 c.executescript('CREATE TABLE groups(id TEXT); CREATE TABLE command_templates(id TEXT);')
 c.executescript(pathlib.Path('src-tauri/src/app/migrations/worktree_short_labels.sql').read_text())
 def restore(statements):
  c.execute('BEGIN IMMEDIATE')
  try:
   for s in statements:c.execute(s['sql'],{str(i+1):v for i,v in enumerate(s['values'])})
   c.commit()
  except:
   c.rollback()
   raise
 restore(payload['mixed'])
 assert c.execute('SELECT id,label_ordinal,short_label FROM worktrees ORDER BY id').fetchall()==[('a',21,''),('explicit',5,'é'),('z',22,'')]
 assert c.execute("SELECT worktree_label_high_water FROM projects WHERE id='empty'").fetchone()==(40,)
 before=c.execute('SELECT * FROM worktrees ORDER BY id').fetchall()
 try:restore(payload['conflict']);raise AssertionError('conflict accepted')
 except sqlite3.IntegrityError:pass
 assert c.execute('SELECT * FROM worktrees ORDER BY id').fetchall()==before
 restore(payload['legacy'])
 assert c.execute('SELECT id,label_ordinal FROM worktrees ORDER BY id').fetchall()==[('a',1),('z',2)]
 c.close()
 print('real SQLite restore: mixed, empty highwater, conflict rollback, legacy passed')
`;
  const result = spawnSync('python', ['-X', 'utf8', '-c', python], { input: JSON.stringify({ mixed, legacy, conflict }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('invalid or conflicted restore does not mark application committed or replay safety state', async () => {
  let applied = false;
  const snapshot = worktrees => ({ version: 3, data: { workspace: workspace([project()], worktrees) } });
  await assert.rejects(api.applySnapshot(snapshot([tree('bad', 1, 'W1')]), ['workspace'], () => { applied = true; }), /reserved/);
  assert.equal(invocations.length, 0);
  await assert.rejects(api.applySnapshot(snapshot([tree('valid', 1)]), ['workspace'], () => { applied = true; }), /transaction rolled back/);
  assert.deepEqual(invocations, ['backup_restore_database']);
  assert.equal(applied, false);
});
