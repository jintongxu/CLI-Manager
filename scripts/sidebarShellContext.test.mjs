import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/features/' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; } });
  return exports;
}
const wslPaths = load('../shared/lib/wslPaths.ts');
const group = load('projects/api/groupPath.ts');
const project = load('terminal/api/terminalProject.ts', { '../../projects/api/worktreeMetadata': {} });
const { resolveSidebarShellContext: resolve } = load('terminal/lib/sidebarShellContext.ts', {
  '../../projects/api/groupPath': group, '../../providers/api/providerSwitching': { parseProjectEnvVars: p => p.env_vars ? JSON.parse(p.env_vars) : undefined },
  '../api/terminalProject': project, '../../../shared/lib/wslPaths': wslPaths,
});
const p = { id: 'p', path: 'D:/repo', path_mode: 'custom', shell: 'pwsh', environment_type: 'local', env_vars: '{"P":"value"}' };
const w = { id: 'w', project_id: 'p', path: 'D:/worktree', status: 'active' };
const base = overrides => ({ sessions: [], projects: [p], worktrees: [w], groups: [], ...overrides });
test('active project/worktree wins explicit scope; uses root not live cwd or resume', () => {
  const input = base({ activeSession: { id: 'main', projectId: 'p', worktreeId: 'w', cwd: 'D:/worktree/subdir', startupCmd: 'pi --resume secret', cliSessionId: 'secret', envVars: { A: 'B' } }, scope: { projectId: 'other' } });
  const context = resolve(input); assert.equal(context.cwd, w.path); assert.equal(context.worktreeId, 'w');
  assert.equal(context.startupCmd, undefined); assert.equal(context.cliSessionId, undefined);
  input.activeSession.envVars.A = 'changed'; assert.equal(context.envVars.A, 'B');
  assert.equal(resolve(base({ activeSession: { id: 'different', projectId: 'p', worktreeId: 'w', envVars: { A: 'B' } } })).key, context.key);
});
test('local sidebar always uses PowerShell 7 rather than project or main CLI shell', () => {
  const context = resolve(base({ projects: [{ ...p, shell: 'cmd' }], activeSession: { id: 'main', projectId: 'p', shell: 'powershell' } }));
  assert.equal(context.shell, 'pwsh');
  assert.equal(context.cwd, p.path);
});
test('anonymous Pi never guesses cwd/project; explicit fallback resolves group root', () => {
  const activeSession = { id: 'anon', kind: 'ephemeral-pi', cwd: 'D:/repo', projectId: 'p', envVars: { WRONG: 'yes' } };
  assert.equal(resolve(base({ activeSession })), null);
  const context = resolve(base({ activeSession, scope: { projectId: 'p' }, projects: [{ ...p, path_mode: 'inherit', group_id: 'g' }], groups: [{ id: 'g', bound_path: 'D:/bound' }] }));
  assert.equal(context.cwd, 'D:/bound'); assert.equal(context.envVars.WRONG, undefined);
});
test('deleted, inactive, creating or mismatched worktree is rejected; no fallback to project', () => {
  for (const worktrees of [[], [{ ...w, status: 'deleted' }], [{ ...w, creation_pending: true }], [{ ...w, project_id: 'other' }]]) {
    assert.throws(() => resolve(base({ activeSession: { id: 'main', projectId: 'p', worktreeId: 'w' }, worktrees })), /worktree_missing/);
  }
  assert.throws(() => resolve(base({ scope: { projectId: 'p', worktreeId: 'gone' } })), /worktree_missing/);
});
test('WSL captures distro and POSIX root; missing distro rejects instead of guessing', () => {
  const input = base({ projects: [{ ...p, path: '/home/me/repo', environment_type: 'wsl', shell: 'wsl' }], activeSession: { id: 'main', projectId: 'p', wslDistroName: 'Ubuntu', environmentType: 'wsl' } });
  const context = resolve(input); assert.equal(context.cwd, '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'); assert.equal(context.shell, 'wsl');
  assert.throws(() => resolve({ ...input, activeSession: { id: 'main', projectId: 'p' } }), /wsl_environment_missing/);
  assert.notEqual(context.key, resolve({ ...input, activeSession: { ...input.activeSession, wslDistroName: 'Debian' } }).key);
});
test('SSH captures project remote root/host, not arbitrary cd; remote key remains case sensitive', () => {
  const input = base({ projects: [{ ...p, environment_type: 'ssh', remote_path: '/Srv/Repo', ssh_host_id: 'host' }], activeSession: { id: 'main', projectId: 'p', environmentType: 'ssh', remotePath: '/tmp' } });
  const context = resolve(input); assert.equal(context.cwd, '/Srv/Repo'); assert.equal(context.sshHostId, 'host');
  assert.notEqual(context.key, resolve({ ...input, projects: [{ ...input.projects[0], remote_path: '/srv/repo' }] }).key);
  assert.throws(() => resolve({ ...input, activeSession: { ...input.activeSession, worktreeId: 'w' } }), /ssh_worktree_unsupported/);
});
test('subagent uses parent environment; Windows keys canonicalize slash/case', () => {
  const main = { id: 'main', projectId: 'p' }, sub = { id: 'sub', kind: 'subagent-transcript', subagent: { parentSessionId: 'main' } };
  assert.equal(resolve(base({ activeSession: sub, sessions: [main] })).key, resolve(base({ activeSession: main })).key);
  assert.equal(resolve(base({ scope: { projectId: 'p' } })).key,
    resolve(base({ scope: { projectId: 'p' }, projects: [{ ...p, path: 'd:\\REPO\\' }] })).key);
});

test('project-bound live cwd never changes worktree ownership; explicit fallback still works', () => {
  const activeSession = { id: 'main', projectId: 'p', cwd: p.path };
  const original = resolve(base({ activeSession }));
  for (const cwd of ['D:/worktree/subdir', 'D:/other-worktree']) {
    const context = resolve(base({ activeSession: { ...activeSession, cwd },
      worktrees: [w, { ...w, id: 'other', project_id: 'other', path: 'D:/other-worktree' }],
      scope: { projectId: 'p', worktreeId: 'w' } }));
    assert.equal(context.key, original.key); assert.equal(context.cwd, p.path);
    assert.equal(context.worktreeId, undefined);
  }
  const fallback = resolve(base({ scope: { projectId: 'p', worktreeId: 'w' } }));
  assert.equal(fallback.worktreeId, 'w'); assert.equal(fallback.cwd, w.path);
});
test('WSL mounted drive roots preserve known distro using shared UNC normalization', () => {
  for (const path of ['D:/my project', String.raw`D:\my project`]) {
    const input = base({ projects: [{ ...p, path, shell: 'wsl', environment_type: 'wsl' }],
      activeSession: { id: 'main', projectId: 'p', environmentType: 'wsl', wslDistroName: 'Ubuntu Test' } });
    const context = resolve(input);
    assert.equal(context.cwd, wslPaths.toWslUnc('Ubuntu Test', '/mnt/d/my project'));
    assert.equal(wslPaths.parseWslPath(context.cwd).distro, 'Ubuntu Test');
    assert.notEqual(context.key, resolve({ ...input, activeSession: { ...input.activeSession, wslDistroName: 'Debian' } }).key);
    assert.throws(() => resolve({ ...input, activeSession: { id: 'main', projectId: 'p' } }), /wsl_environment_missing/);
  }
});
