import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fixture, deferred, tick } from './chatHarness.mjs';

function exitHarness(options = {}) {
  const chat = fixture(1), calls = [], barrier = deferred();
  let view, refs = [], native = receipt('prepared');
  const lifecycle = {
    suspendChatEditing: () => { calls.push('suspend'); chat.controller.suspend(); },
    flushChatPersistence: async () => { calls.push('chat-flush'); await chat.controller.flush(); },
    resumeChatEditing: () => { calls.push('chat-resume'); chat.controller.resume(); },
  };
  const { createExitTransaction } = load('src/app/exitTransaction.ts');
  const { useAppExit } = load('src/app/useAppExit.ts', {
    react: { useRef: value => { const ref = { current: value }; refs.push(ref); return ref; }, useState: value => [value, next => { view = next; }] },
    '@tauri-apps/api/core': { invoke: async command => {
      calls.push(command);
      if (command === 'app_exit_prepare') {
        if (options.holdPrepare) await barrier.promise;
        // Native prepare must cancel/save the terminal revision before resolving.
        if (options.prepare) await options.prepare(chat);
        return native;
      }
      if (command === 'app_exit_cleanup') return (native = receipt('ready'));
      if (command === 'app_exit_status') return native;
      if (command === 'app_exit_abort' && options.failAbort) throw Error('abort_failed');
      return null;
    } },
    './exitTransaction': { createExitTransaction },
    '../features/chat/api/lifecycle': lifecycle,
    '../features/terminal/api/sessionPersistenceBarrier': {
      pauseSessionPersistence: async () => { calls.push('terminal-pause'); if (options.failPause) throw Error('pause_failed'); },
      resumeSessionPersistence: () => calls.push('terminal-resume'),
    },
    '../features/terminal/api/sessionSnapshotPersistence': { flushTerminalSnapshotsNow: async () => calls.push('terminal-flush') },
    '../features/terminal/api/sessionStore': {
      saveRestorableExitSnapshot: async () => calls.push('snapshot'), useSessionStore: { getState: () => ({}) },
    },
    '../features/terminal/state': { useTerminalStore: { getState: () => ({}) } },
  });
  const exit = useAppExit(async () => {}, async () => calls.push('backup'));
  return { chat, calls, exit, barrier, view: () => view };
}
function receipt(phase) {
  return { protocolVersion: 1, transactionId: 'tx', instanceId: 'owner', generation: 1,
    phase, workerRunning: false, canExit: phase === 'ready', metadataSaved: phase === 'ready',
    resources: [], errors: [], daemon: { status: 'absent', epoch: null } };
}

test('actual useAppExit awaits prepared native partial before suspend, draft flush and backup', async () => {
  const h = exitHarness({ holdPrepare: true, prepare: async chat => {
    const d = chat.rows.get('c1'); d.conversation.revision += 1;
  } });
  await h.chat.controller.start();
  h.chat.controller.setDraft('c1', 'keep draft');
  const exiting = h.exit.run('window close'); await tick();
  assert.deepEqual(h.calls, ['app_exit_prepare']);
  assert.equal(h.chat.controller.getSnapshot().suspended, false);
  h.barrier.resolve(); await exiting;
  assert.deepEqual(h.calls, ['app_exit_prepare', 'suspend', 'terminal-pause', 'chat-flush', 'terminal-flush', 'snapshot', 'backup', 'app_exit_cleanup', 'app_exit_commit']);
  assert.equal(h.chat.rows.get('c1').conversation.draft, 'keep draft');
  assert.equal(h.chat.calls.filter(c => c[0] === 'generate').length, 0);
  await h.exit.resume();
  assert.equal(h.chat.controller.getSnapshot().suspended, false);
  assert.equal(h.chat.calls.filter(c => c[0] === 'generate').length, 0);
});

test('chat storage failure blocks metadata/cleanup/commit, abort restores editor, explicit retry saves', async () => {
  const h = exitHarness(); await h.chat.controller.start();
  h.chat.controller.setDraft('c1', 'retained'); h.chat.failFlush(true);
  await h.exit.run('tray quit');
  assert.equal(h.view().phase, 'blocked');
  assert.ok(h.calls.includes('app_exit_abort'));
  assert.equal(h.chat.controller.getSnapshot().suspended, false);
  assert.equal(h.chat.controller.getSnapshot().drafts.c1, 'retained');
  assert.ok(!h.calls.includes('backup')); assert.ok(!h.calls.includes('app_exit_commit'));
  h.chat.failFlush(false);
  await h.exit.retry(); assert.ok(h.calls.includes('app_exit_commit'));
  assert.equal(h.chat.calls.filter(c => c[0] === 'generate').length, 0);
});

test('pause failure aborts; failed native abort retains editor barrier until explicit successful resume', async () => {
  const h = exitHarness({ failPause: true }); await h.chat.controller.start();
  await h.exit.run('window close');
  assert.ok(h.calls.includes('app_exit_abort')); assert.ok(h.calls.includes('chat-resume'));
  const blocked = exitHarness({ failAbort: true }); await blocked.chat.controller.start(); blocked.chat.failFlush(true);
  await blocked.exit.run('window close');
  assert.equal(blocked.chat.controller.getSnapshot().suspended, true);
  assert.ok(!blocked.calls.includes('app_exit_commit')); assert.ok(!blocked.calls.includes('chat-resume'));
});

test('tray hide is not exit authority: mounted chat remains running/editable', async () => {
  const h = exitHarness(); await h.chat.controller.start();
  h.chat.controller.setDraft('c1', 'question'); await h.chat.controller.generate('c1');
  // Hiding only changes visibility; no useAppExit.run invocation is authorized.
  const { hookHarness } = await import('./chatHarness.mjs');
  const ui = hookHarness(h.chat.controller); ui.render(false); ui.cleanup();
  assert.deepEqual(h.calls, []);
  assert.equal(h.chat.controller.getSnapshot().suspended, false);
  assert.deepEqual(Array.from(h.chat.controller.getSnapshot().running), ['c1']);
  assert.equal(h.chat.calls.some(c => c[0] === 'cancel'), false);
});
