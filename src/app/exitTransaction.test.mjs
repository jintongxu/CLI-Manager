import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, require = () => { throw new Error('Unexpected import'); }) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require, setTimeout, clearTimeout, console });
  return exports;
}
const { createExitTransaction } = load('src/app/exitTransaction.ts');
test('actual App guard callbacks route discard/idle to native chain, minimize and ask never prepare', async () => {
  const app = fs.readFileSync('src/app/App.tsx', 'utf8');
  const start = app.indexOf('  const requestExitGuardedByRunningTasks = useCallback(');
  const end = app.indexOf('\n  const persistExitTaskBehaviorBeforeAction', start);
  const code = app.slice(start, end).replace('const requestExitGuardedByRunningTasks', 'exports.guard');
  const calls = [];
  let behavior = 'cleanup';
  const exports = {};
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, useCallback: fn => fn, appExit: { isActive: () => false },
    getExitRunningTaskIds: async () => ({ runningIds: ['pty'], daemonSessionsChecked: true }),
    logInfo: () => {}, exitTasksBehaviorRef: { current: 'ask' },
    useSettingsStore: { getState: () => ({ terminalSessionRestoreEnabled: true }) },
    resolveTerminalExitAction: () => behavior,
    runExitCleanup: async source => calls.push(['exit', source]),
    minimizeToTray: async () => calls.push(['minimize']),
    pendingExitSourceRef: {}, pendingExitDaemonSessionsCheckedRef: {},
    setRunningTasksCount: () => {}, focusMainWindow: async () => calls.push(['show']),
    setRunningTasksDialogOpen: () => calls.push(['ask']),
  });
  for (const source of ['window close', 'tray quit', 'close dialog']) {
    await exports.guard(source);
    assert.deepEqual(calls.pop(), ['exit', source]);
  }
  behavior = 'discard';
  await exports.guard('window close');
  assert.deepEqual(calls.pop(), ['exit', 'window close']);
  behavior = 'minimize';
  await exports.guard('window close');
  assert.deepEqual(calls.pop(), ['minimize']);
  behavior = 'ask';
  await exports.guard('tray quit');
  assert.deepEqual(calls, [['show'], ['ask']]);
  assert.ok(!app.includes('enterBackgroundTaskMode'));
  assert.ok(!app.includes('invoke("app_exit")'));
});

const receipt = (phase = 'prepared', extra = {}) => ({
  protocolVersion: 1, transactionId: 'native-tx', instanceId: 'owner', generation: 3,
  phase, canExit: phase === 'ready', metadataSaved: phase === 'ready', workerRunning: phase === 'stopping',
  resources: [], errors: [], daemon: { epoch: 'epoch', status: 'stopped' }, ...extra,
});
function harness(options = {}) {
  const calls = [];
  let latest;
  let native = receipt();
  const controller = createExitTransaction({
    invoke: async (command, args) => {
      calls.push([command, args]);
      if (options.invoke) {
        const result = await options.invoke(command, args);
        if (result !== undefined) return result;
      }
      if (command === 'app_exit_prepare') return native;
      if (command === 'app_exit_cleanup') return (native = receipt('stopping'));
      if (command === 'app_exit_status') return (native = receipt('ready'));
      return null;
    },
    pause: async () => calls.push(['pause']),
    save: async () => { calls.push(['save']); await options.save?.(); },
    resume: () => calls.push(['resume']),
    show: async () => calls.push(['show']),
    changed: view => { latest = view; },
    wait: async () => {},
  });
  return { controller, calls, view: () => latest };
}
test('real transaction callbacks: prepare, pause, awaited save, cleanup, status, commit', async () => {
  let release;
  const h = harness({ save: () => new Promise(resolve => { release = resolve; }) });
  const running = h.controller.run('tray');
  while (!release) await Promise.resolve();
  await h.controller.run('window');
  assert.equal(h.calls.filter(([name]) => name === 'app_exit_prepare').length, 1);
  assert.equal(h.calls.some(([name]) => name === 'app_exit_cleanup'), false);
  release();
  await running;
  assert.deepEqual(h.calls.map(([name]) => name), [
    'show', 'app_exit_prepare', 'pause', 'save', 'app_exit_cleanup', 'app_exit_status', 'app_exit_commit',
  ]);
  assert.equal(h.calls.find(([name]) => name === 'app_exit_cleanup')[1].metadataSaved, true);
});
test('metadata save failure aborts without cleanup or commit and restores writes', async () => {
  const h = harness({ save: async () => { throw new Error('disk full'); } });
  await h.controller.run();
  assert.equal(h.view().phase, 'blocked');
  assert.match(h.view().error, /disk full/);
  assert.ok(h.calls.some(([name]) => name === 'app_exit_abort'));
  assert.ok(h.calls.some(([name]) => name === 'resume'));
  assert.ok(!h.calls.some(([name]) => ['app_exit_cleanup', 'app_exit_commit'].includes(name)));
});
test('resource close failure stays visible, retry uses same transaction without resaving', async () => {
  let fail = true;
  const blocked = receipt('blocked', { metadataSaved: true, errors: [{ resourceId: 'pty', code: 'close_failed' }] });
  const h = harness({ invoke: async command => {
    if (command === 'app_exit_status' && fail) return blocked;
    if (command === 'app_exit_cleanup') {
      if (fail) return blocked;
      return receipt('ready');
    }
  } });
  await h.controller.run();
  assert.equal(h.view().receipt.errors[0].resourceId, 'pty');
  assert.equal(h.calls.some(([name]) => name === 'app_exit_commit'), false);
  fail = false;
  await h.controller.retry();
  assert.equal(h.calls.filter(([name]) => name === 'save').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'app_exit_prepare').length, 1);
  assert.equal(h.calls.at(-1)[0], 'app_exit_commit');
  for (const [name, args] of h.calls) if (name.startsWith('app_exit_') && name !== 'app_exit_prepare') {
    assert.equal(args.transactionId, 'native-tx');
  }
});
test('stale receipt cannot commit even when it claims ready', async () => {
  const h = harness({ invoke: async command => command === 'app_exit_status'
    ? receipt('ready', { transactionId: 'old-tx', generation: 2 }) : undefined });
  await h.controller.run();
  assert.match(h.view().error, /stale/);
  assert.equal(h.calls.some(([name]) => name === 'app_exit_commit'), false);
});
test('retained timeout worker is not duplicated and resume failure preserves barrier', async () => {
  const h = harness({ invoke: async command => {
    if (command === 'app_exit_status') return receipt('blocked', { workerRunning: true, metadataSaved: true });
    if (command === 'app_exit_resume') throw new Error('exit_worker_running');
  } });
  await h.controller.run();
  await h.controller.retry();
  await h.controller.resume();
  assert.equal(h.calls.filter(([name]) => name === 'app_exit_cleanup').length, 1);
  assert.equal(h.calls.some(([name]) => name === 'resume'), false);
  assert.equal(h.calls.some(([name]) => name === 'app_exit_commit'), false);
});
test('session persistence fence drains prior writes and suppresses exited autosaves', async () => {
  const barrier = load('src/features/terminal/api/sessionPersistenceBarrier.ts');
  const calls = [];
  const writing = barrier.queueSessionPersistence(async () => calls.push('before'));
  await barrier.pauseSessionPersistence();
  await writing;
  await barrier.queueSessionPersistence(async () => calls.push('process-exited-empty'));
  assert.deepEqual(calls, ['before']);
  barrier.resumeSessionPersistence();
  await barrier.queueSessionPersistence(async () => calls.push('after'));
  assert.deepEqual(calls, ['before', 'after']);
});

test('actual sessionStore explicit save is durable and close-event writes cannot wipe restore data', async () => {
  const barrier = load('src/features/terminal/api/sessionPersistenceBarrier.ts');
  const disk = new Map();
  let saves = 0;
  let state;
  const mockStore = { set: async (key, value) => disk.set(key, value), save: async () => { saves++; } };
  const { useSessionStore, saveRestorableExitSnapshot } = load('src/features/terminal/api/sessionStore.ts', name => {
    if (name === 'zustand') return { create: init => {
      state = init();
      return { getState: () => state, setState: patch => { state = { ...state, ...patch }; } };
    } };
    if (name.includes('sessionPersistenceBarrier')) return barrier;
    if (name === '@tauri-apps/plugin-store') return { Store: { load: async () => mockStore } };
    if (name.includes('appPaths')) return { getCliManagerDataPaths: async () => ({ sessionsStorePath: 'mock' }) };
    if (name.includes('singleFlight')) return { singleFlight: fn => fn };
    if (name.includes('currentWorkModel')) return { sanitizeCurrentWorkPaneTree: tree => tree };
    if (name.includes('terminalWorkspan')) return { sanitizeTerminalWorkspans: spans => spans };
    throw new Error(name);
  });
  const sessions = [{ id: 'native-pty', cliSessionId: 'cli-native', terminalSnapshot: 'output' }];
  await useSessionStore.getState().saveSessions(sessions);
  await barrier.pauseSessionPersistence();
  await saveRestorableExitSnapshot({ sessions, splits: [], activeSessionId: 'native-pty', workspans: [],
    activeWorkspanId: null, currentWorkSessionIds: ['native-pty'], currentWorkActiveSessionId: 'native-pty',
    currentWorkPaneTree: null });
  const savesBefore = saves;
  await useSessionStore.getState().saveSessions([]);
  await useSessionStore.getState().saveCurrentWork([], null, []);
  await useSessionStore.getState().clear();
  assert.equal(disk.get('sessions')[0].cliSessionId, 'cli-native');
  assert.equal(disk.get('activeSessionId'), 'native-pty');
  assert.equal(disk.get('currentWorkSessionIds')[0], 'native-pty');
  assert.equal(saves, savesBefore);
});
test('owned daemon recovery uses actual scope callback and never adopts foreign or legacy sessions', async () => {
  const { listOwnedDaemonSessions } = load('src/features/terminal/api/ownedDaemonSessions.ts', name => {
    if (name.includes('PtyHostSocket')) return { ptyHostSocket: { sessionScopes: async () => ({ a: 'owned', b: 'foreign', c: 'legacy' }) } };
    if (name.includes('core')) return { invoke: async () => ['a', 'b', 'c', 'd'].map(sessionId => ({ sessionId })) };
    throw new Error(name);
  });
  assert.deepEqual(Array.from(await listOwnedDaemonSessions(), session => session.sessionId), ['a']);
});
