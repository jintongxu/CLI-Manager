import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const root = '../src/features/terminal/';
function load(path, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; } });
  return exports;
}
function create(init) {
  let state;
  const api = { getState: () => state, setState: partial => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }; } };
  state = init(api.setState, api.getState);
  return api;
}
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const context = key => ({ key, projectId: key, cwd: 'D:/' + key, environmentType: 'local', envVars: { A: 'B' } });
function fixture(patch = {}) {
  const calls = [], terminal = { sessions: [{ id: 'main' }], activeSessionId: 'main', workspans: [{ id: 'main' }],
    createSession: async (...args) => { calls.push(args); const id = 'shell-' + args[0]; terminal.sessions.push({ id }); return id; },
    closeSession: async (id, strict) => { calls.push([id, strict]); terminal.sessions = terminal.sessions.filter(s => s.id !== id); }, ...patch };
  const module = load(root + 'store/sidebarShellStore.ts', { zustand: { create }, './terminalStore': { useTerminalStore: { getState: () => terminal } } });
  return { store: module.createSidebarShellStore(() => terminal), terminal, calls };
}
test('explicit open is single-flight, managed ordinary transient launch preserves main ownership', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0);
  const first = f.store.getState().open(context('p'));
  assert.equal(first, f.store.getState().open(context('p')));
  assert.equal(await first, 'shell-p');
  const args = f.calls[0]; assert.equal(args[3], ''); assert.deepEqual(JSON.parse(JSON.stringify(args[12])), { transientBackground: true });
  assert.equal(args[6], undefined); assert.equal(args[9], undefined); assert.equal(args[10], undefined);
  assert.equal(f.terminal.activeSessionId, 'main'); assert.deepEqual(f.terminal.workspans, [{ id: 'main' }]);
  await f.store.getState().open(context('p')); assert.equal(f.calls.length, 1);
});
test('late success stays owned by old context across switch; capture cannot be mutated', async () => {
  const g = gate(), f = fixture({ createSession: async () => g.promise }); const old = context('old');
  const first = f.store.getState().open(old); old.envVars.A = 'changed';
  assert.equal(f.store.getState().owners.old.context.envVars.A, 'B');
  assert.equal(f.store.getState().owners.new, undefined); // merely selecting another context creates nothing
  g.resolve('late'); await first;
  assert.equal(f.store.getState().owners.old.sessionId, 'late');
  assert.equal(f.store.getState().owners.new, undefined);
});
test('close serializes pending creation, deduplicates and strictly awaits ACK', async () => {
  const createGate = gate(), closeGate = gate(); let closeCalls = 0;
  const f = fixture({ createSession: async () => { await createGate.promise; f.terminal.sessions.push({ id: 'new' }); return 'new'; },
    closeSession: async (id, strict) => { assert.equal(strict, true); closeCalls++; await closeGate.promise; f.terminal.sessions = f.terminal.sessions.filter(s => s.id !== id); } });
  const opening = f.store.getState().open(context('p')), closing = f.store.getState().close('p');
  assert.equal(closing, f.store.getState().close('p')); await Promise.resolve(); assert.equal(closeCalls, 0);
  createGate.resolve(); await opening; await Promise.resolve();
  assert.equal(f.store.getState().owners.p.sessionId, 'new'); closeGate.resolve(); await closing;
  assert.equal(closeCalls, 1); assert.equal(f.store.getState().owners.p, undefined);
});
test('failed strict close retains owner for retry; resolved but unremoved sessions are not ACKs', async () => {
  const f = fixture(); await f.store.getState().open(context('p')); const realClose = f.terminal.closeSession;
  f.terminal.closeSession = async () => { throw Error('ACK failed'); };
  await assert.rejects(f.store.getState().close('p'), /ACK failed/);
  assert.equal(f.store.getState().owners.p.sessionId, 'shell-p'); assert.equal(f.store.getState().owners.p.phase, 'closeFailed');
  f.terminal.closeSession = async () => {};
  await assert.rejects(f.store.getState().close('p'), /close_unconfirmed/);
  f.terminal.closeSession = realClose; await f.store.getState().close('p'); assert.equal(f.store.getState().owners.p, undefined);
});
test('retained managed candidate survives creation error and can be closed', async () => {
  const f = fixture({ createSession: async () => { f.terminal.sessions.push({ id: 'retained', transientBackground: true }); throw Object.assign(Error('cleanup failed'), { sessionId: 'retained' }); } });
  await assert.rejects(f.store.getState().open(context('p')), /cleanup failed/);
  assert.equal(f.store.getState().owners.p.sessionId, 'retained');
  await f.store.getState().close('p'); assert.equal(f.store.getState().owners.p, undefined);
});

function managedFixture(invoke, failAttach = false) {
  const manager = load(root + 'api/TerminalProcessManager.ts', {
    '@tauri-apps/api/core': { invoke }, '../../../shared/lib/terminalQueryPolicy': { createTerminalQuerySession() {} },
    '../transport/PtyHostSocket': { ptyHostSocket: { create: async () => { throw Error('unexpected transport'); } } },
    '../../../shared/platform/resourceDiagnosticsLog': {}, './terminalWriteGate': { TerminalWriteGate: class {} },
  }).terminalProcessManager;
  if (failAttach) {
    manager.create = async () => 'retained-real';
    manager.subscribeStatus = async () => { throw Error('attach failed'); };
    manager.close = async () => { throw Error('cleanup ACK failed'); };
  }
  const candidate = load(root + 'store/terminalSessionCandidate.ts', {
    '../api/TerminalProcessManager': { terminalProcessManager: manager },
    '../api/terminalWorkspan': load(root + 'api/terminalWorkspan.ts', {
      './terminalPaneTree': load(root + 'api/terminalPaneTree.ts'),
    }),
    '../lib/terminalLaunch': { releaseProviderSnapshot() {}, releaseProjectExtensionSnapshot() {} },
  });
  const creation = load(root + 'store/terminalSessionCreation.ts', {
    sonner: { toast: { error() {} } }, '../../../shared/platform/logger': { logError() {}, recordCrashActivity() {} },
    '../../../shared/preferences/settingsStore': {}, '../api/sessionStore': {},
    '../../../shared/platform/shell': { getOsPlatform: async () => 'windows' },
    '../../projects/api/projectStore': { useProjectStore: { getState: () => ({ worktrees: [] }) } },
    '../../../shared/i18n/index': { translateCurrent: String }, '../api/TerminalProcessManager': { terminalProcessManager: manager },
    '../api/terminalPaneTree': {}, '../api/terminalWorkspan': {}, '../lib/terminalStoreLayout': {},
    '../lib/terminalLaunch': { getProjectAgentTerminalMetadata: () => ({}), resolvePtyLaunch: async () => ({ invokeArgs: {}, shell: 'pwsh' }), releaseProviderSnapshot() {}, releaseProjectExtensionSnapshot() {} },
    '../lib/terminalStatus': { formatTerminalCreateError: String, summarizeStartupCmd: String },
    '../../../shared/lib/worktreeLaunchAdmission': { reserveWorktreeLaunch: () => () => {} },
    '../lib/terminalSessionNaming': {}, '../lib/worktreeSessionAdmission': { createWorktreeSessionAdmission: () => ({ finish() {} }) },
    '../lib/terminalSshNaming': {}, './terminalSessionCandidate': candidate,
  });
  let terminal = { sessions: [{ id: 'main' }], workspans: [], sessionStatuses: {}, statusListeners: {}, closeSession: async () => {} };
  terminal.createSession = creation.createTerminalSessionCreation(partial => Object.assign(terminal, typeof partial === 'function' ? partial(terminal) : partial), () => terminal).createSession;
  const f = fixture(terminal);
  terminal = f.terminal;
  return f;
}
test('exit admission rejection flows through actual createSession and actual manager, not sidebar IPC', async () => {
  const g = gate(), commands = [];
  const f = managedFixture(async command => { commands.push(command); await g.promise; throw Error('exit_in_progress'); });
  const opening = f.store.getState().open(context('p')); await Promise.resolve(); await Promise.resolve();
  const closing = f.store.getState().close('p'); g.resolve();
  await assert.rejects(opening, /exit_in_progress/); await closing;
  assert.deepEqual(commands, ['pty_prepare_create']); assert.equal(f.store.getState().owners.p, undefined);
});

test('production retention transfers failed transient launch to ordinary recovery pane only', async () => {
  const f = managedFixture(async () => {}, true);
  await assert.rejects(f.store.getState().open(context('p')), /terminal_recovery_cleanup_failed/);
  const retained = f.terminal.sessions.find(s => s.id === 'retained-real');
  assert.equal(retained.transientBackground, undefined); assert.equal(retained.tabHidden, false);
  assert.equal(f.terminal.workspans.length, 1);
  assert.equal(f.terminal.workspans[0].paneTree.sessionIds[0], retained.id);
  const owner = f.store.getState().owners.p;
  assert.equal(owner.phase, 'createFailed'); assert.ok(owner.error);
  assert.equal(owner.sessionId, undefined); // Host cannot mount another parser.
  await f.store.getState().close('p'); // dismiss failure without closing recovery
  assert.ok(f.terminal.sessions.includes(retained));
});
test('WSL distro reaches managed createSession through cwd, not a nonexistent option', async () => {
  const f = fixture();
  const cwd = String.raw`\wsl.localhost\Ubuntu Test\mnt\d\my project`;
  await f.store.getState().open({ ...context('p'), cwd, shell: 'wsl', environmentType: 'wsl', wslDistroName: 'Ubuntu Test' });
  assert.equal(f.calls[0][1], cwd); assert.equal(f.calls[0][5], 'wsl');
  assert.equal(f.calls[0].length, 13);
});

for (const [environmentType, shell, sshHostId, expected] of [
  ['local', 'pwsh', undefined, '1'],
  ['wsl', 'wsl', undefined, undefined],
  ['ssh', 'pwsh', 'host', undefined],
  ['local', 'bash', undefined, undefined],
]) {
  test(`clean pwsh policy is scoped to local sidebar creation: ${environmentType}/${shell}`, async () => {
    const f = fixture();
    const input = { ...context('p'), environmentType, shell, sshHostId,
      envVars: { A: 'B', CLI_MANAGER_SIDEBAR_CLEAN_PWSH: '0' } };
    await f.store.getState().open(input);
    assert.equal(f.calls[0][4].CLI_MANAGER_SIDEBAR_CLEAN_PWSH, expected);
    assert.equal(f.calls[0][4].A, 'B');
    assert.equal(f.calls[0][3], '');
    assert.equal(input.envVars.CLI_MANAGER_SIDEBAR_CLEAN_PWSH, '0');
  });
}

test('actual launch resolver retains clean marker with monitoring and cannot turn empty command into agent CLI', async () => {
  const commands = [], extensionCalls = [];
  const module = load(root + 'lib/terminalLaunch.ts', {
    '@tauri-apps/api/core': { invoke: async command => { commands.push(command); return { status: 'missing' }; } },
    '../../agents/api/agentTerminal': {}, '../../../shared/platform/logger': {},
    '../../projects/api/projectStartupCommand': { resolveProjectStartupCommand: () => 'codex', withCodexConfigOverrides: value => value },
    '../../../shared/lib/terminalThemes': { getTerminalTheme: () => ({ foreground: '#ffffff', background: '#000000' }) },
    '../../../shared/lib/terminalColor': { normalizeHexColor: value => value },
    '../../../shared/preferences/settingsStore': { useSettingsStore: { getState: () => ({ shellRuntimeMonitoringEnabled: true }) } },
    '../../../shared/platform/shell': { normalizeShellForOs: value => value, normalizeShellKey: value => value },
    '../../providers/api/providerSwitching': { getProviderSwitchAppType: () => 'codex' },
    '../../projects/api/projectStore': { useProjectStore: { getState: () => ({ projects: [{ id: 'p', cli: 'codex' }] }) } },
    '../../remote/api/sshHostStore': {}, '../../remote/api/sshAgentIntegrationStore': {}, '../../remote/api/ssh': {},
    '../../remote/api/sshToolIntegration': {}, '../../remote/api/sshClientIdentity': {},
    '../../history/api/resumeCliArgs': {}, '../../history/api/historyResumeCommand': {}, '../api/TerminalProcessManager': {},
    './terminalStatus': { SHELL_RUNTIME_MONITORING_ENV: 'CLI_MANAGER_SHELL_RUNTIME_MONITORING' },
    '../../extensions/api/projectPolicy': { prepareProjectExtensionLaunch: async options => {
      extensionCalls.push(options); return { snapshotId: null, codexConfigOverrides: ['x=y'], warnings: [] };
    } },
  });
  const launch = await module.resolvePtyLaunch({ projectId: 'p', cwd: 'D:/p', startupCmd: '', shell: 'pwsh',
    envVars: { CLI_MANAGER_SIDEBAR_CLEAN_PWSH: '1', A: 'B' } }, 'windows');
  assert.equal(launch.invokeArgs.envVars.CLI_MANAGER_SIDEBAR_CLEAN_PWSH, '1');
  assert.equal(launch.invokeArgs.envVars.CLI_MANAGER_SHELL_RUNTIME_MONITORING, '1');
  assert.equal(launch.startupCmd, undefined);
  assert.equal(launch.providerSnapshot, null);
  assert.equal(launch.invokeArgs.sshLaunch, null);
  assert.equal(extensionCalls.length, 1); // Existing extension preparation does not inject a command.
  assert.deepEqual(commands, ['opencode_hook_status']);
});
