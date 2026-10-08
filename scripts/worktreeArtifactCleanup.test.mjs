import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { load, finish, record, plan, confirmation, pending, cleanupHarness, dialogHarness, storeHarness, flush, deferred } from './worktreeFinishRecovery.test.mjs';
const admission = load('src/shared/lib/worktreeLaunchAdmission.ts');

test('original token validates and acquires admission before close; failed close always releases', async () => {
  const h = cleanupHarness();
  h.deps.closeSession = async () => { h.calls.push('closeFailed'); throw Error('locked'); };
  await assert.rejects(finish.finalizeFinish(h.deps, confirmation(['s1'])), /locked/);
  assert.equal(h.calls.join(','), 'inspect,validate,closeFailed,releasePlan');
  assert.equal(h.sessions.length, 1);
  const changed = cleanupHarness();
  changed.deps.validate = async () => plan({ token: 'replacement', admissionAcquired: true });
  await assert.rejects(finish.finalizeFinish(changed.deps, confirmation(['s1'])), /plan_changed/);
  assert.equal(changed.calls.join(','), 'inspect,releasePlan');
});
test('new arrivals during validation, close or release stop and release without cleanup', async () => {
  for (const stage of ['validate', 'closeSession', 'releaseSessions']) {
    const h = cleanupHarness(), original = h.deps[stage];
    h.deps[stage] = async (...args) => { const result = await original(...args); h.sessions.push('new'); return result; };
    await assert.rejects(finish.finalizeFinish(h.deps, confirmation(['s1'])), /sessions_changed/);
    assert.equal(h.calls.includes('cleanup'), false);
    assert.equal(h.calls.at(-1), 'releasePlan');
  }
});
test('successful confirmed IPC consumes token: no redundant release can prevent SQL finalization', async () => {
  const h = cleanupHarness();
  h.deps.releasePlan = async () => { throw Error('finish_plan_unknown'); };
  await finish.finalizeFinish(h.deps, confirmation(['s1']));
  assert.equal(h.calls.join(','), 'inspect,validate,close:s1,release,cleanup,sql,remove,ack,refresh');
});
test('actual store wires original token, does not use legacy cleanup and rejects missing authorization', async () => {
  const h = storeHarness(); h.setState(pending());
  await assert.rejects(h.store.finishCleanup(record, true, { plan: null, sessionIds: [] }), /confirmation_required/);
  assert.equal(h.calls.includes('git_worktree_finish_cleanup_confirmed'), false);
  await h.store.finishCleanup(record, true, confirmation([]));
  assert.ok(h.calls.indexOf('git_worktree_finish_cleanup_validate') < h.calls.indexOf('git_worktree_finish_cleanup_confirmed'));
  assert.equal(h.calls.includes('git_worktree_finish_cleanup'), false);
  assert.equal(h.calls.includes('git_worktree_finish_cleanup_release'), false);
});
test('actual dialog displays exact whole-root/candidate/session scope and unknown size before confirmation', async () => {
  const h = dialogHarness(); h.setState(pending({ cleanupReady: false, cleanupPlanRequired: true }));
  h.dependencies.planFinishCleanup = async () => plan({ sessionIds: ['daemon-other-window'], candidates: [{ path: record.path + '/target',
    kind: 'cargo_default_target', evidence: 'CACHEDIR.TAG', estimatedBytes: null, estimatedEntries: 14, deletesEntireDirectory: true }] });
  h.render(h.props); await flush(); h.render();
  h.button('worktree.finish.cleanup').props.onClick(); await flush(); h.render();
  const confirm = h.nodes('ConfirmDialog').find(node => node.props.open);
  assert.ok(confirm);
  for (const value of [record.path, '/target', 'CACHEDIR.TAG', 'unknownSize', 'wholeRoot', 'wholeDirectory', 'daemon-other-window']) assert.ok(confirm.props.message.includes(value), value);
  confirm.props.onClose(); await flush(); h.render();
  assert.equal(h.calls.includes('releasePlan'), true);
  assert.equal(h.calls.some(call => call.startsWith('cleanup:')), false);
});
test('preserved unknown paths/reasons cannot be confirmed; old-daemon guidance is actionable', async () => {
  const h = dialogHarness(); h.setState(pending());
  h.dependencies.planFinishCleanup = async () => plan({ blocker: 'finish_unknown_content_preserved', preserved: [{ path: record.path + '/personal.log', reason: 'unknown_ignored' }] });
  h.render(h.props); await flush(); h.render(); h.button('worktree.finish.cleanup').props.onClick(); await flush(); h.render();
  assert.equal(h.nodes('ConfirmDialog').some(node => node.props.open), false);
  assert.match(JSON.stringify(h.render()), /personal.log/);
  assert.match(JSON.stringify(h.render()), /unknown_ignored/);
  h.dependencies.planFinishCleanup = async () => { throw Error('finish_admission_feature_missing'); };
  h.render(); h.button('worktree.finish.cleanup').props.onClick(); await flush(); h.render();
  assert.match(JSON.stringify(h.render()), /plan.restart/);
  assert.equal(h.calls.some(call => call.startsWith('cleanup:')), false);
});
test('late plan for cancelled target is released, never displayed or executed', async () => {
  const h = dialogHarness(), wait = deferred(); h.setState(pending());
  h.dependencies.planFinishCleanup = () => wait.promise;
  h.render(h.props); await flush(); h.render(); h.button('worktree.finish.cleanup').props.onClick(); await flush();
  h.render({ ...h.props, open: false }); wait.resolve(plan()); await flush(); h.render();
  assert.equal(h.calls.includes('releasePlan'), true);
  assert.equal(h.nodes('ConfirmDialog').some(node => node.props.open), false);
});

// Extract the actual central Store property callback using the TypeScript AST.
// Execute its complete async body, not a rewritten copy of launch admission logic.
function launchHarness() {
  const file = 'src/features/terminal/store/terminalStore.ts';
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let callback;
  const visit = node => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'createSession') callback = node.initializer; ts.forEachChild(node, visit); };
  visit(source); assert.ok(callback);
  const code = ts.transpileModule('const launch = ' + callback.getText(source) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const wait = deferred(), calls = [], context = {
    ...admission, useProjectStore: { getState: () => ({ worktrees: [{ id: 'w1', status: 'active' }] }) },
    getOsPlatform: () => wait.promise, resolvePtyLaunch: async () => { calls.push('resolve'); throw Error('injected launch failure'); },
    formatTerminalCreateError: String, toast: { error() {} }, translateCurrent: String, logError() {},
    releaseProviderSnapshot() {}, releaseProjectExtensionSnapshot() {},
  };
  vm.createContext(context); vm.runInContext(code, context);
  return { launch: vm.runInContext('launch', context), wait, calls };
}
test('actual async central launch reserves before first await, nested cleanup blocked; failure releases', async () => {
  const h = launchHarness();
  const launch = h.launch('p1', record.path + '/subdir', 'Task', '', {}, 'pwsh', undefined, 'w1');
  assert.throws(() => admission.acquireWorktreeLaunchBarrier(record.path), /launch_in_progress/);
  const unrelated = admission.acquireWorktreeLaunchBarrier('D:/other'); unrelated();
  h.wait.resolve('windows'); await assert.rejects(launch, /injected launch failure/);
  const release = admission.acquireWorktreeLaunchBarrier(record.path);
  const next = launchHarness();
  await assert.rejects(next.launch('p1', record.path, 'Split', '', {}, 'pwsh', 'pane', 'w1'), /launch_blocked/);
  assert.equal(next.calls.length, 0); release();
});

function closeCallback(context) {
  const file = 'src/features/terminal/store/terminalStore.ts';
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let callback;
  const visit = node => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'closeSession') callback = node.initializer; ts.forEachChild(node, visit); };
  visit(source);
  vm.createContext(context);
  vm.runInContext(ts.transpileModule('const close = ' + callback.getText(source) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return vm.runInContext('close', context);
}
test('actual strict close awaits backend and retains local tab on failure, including daemon-only IDs', async () => {
  for (const sessions of [[{ id: 's1', kind: 'pty' }], []]) {
    const calls = [], wait = deferred();
    const close = closeCallback({ get: () => ({ sessions }), set: () => calls.push('set'),
      terminalProcessManager: { close: (id, strict) => { assert.equal(strict, true); calls.push(id); return wait.promise; } } });
    const result = close('s1', true);
    assert.equal(calls.join(','), 's1');
    wait.reject(Error('daemon close failed'));
    await assert.rejects(result, /daemon close failed/);
    assert.equal(calls.includes('set'), false);
  }
});
test('new bilingual keys are complete and warn about hand-placed files, provenance and external writer limits', () => {
  const zh = load('src/shared/i18n/messages/projects.zh-CN.ts').zh;
  const en = load('src/shared/i18n/messages/projects.en-US.ts').en;
  const keys = Object.keys(zh).filter(key => key.startsWith('worktree.finish.plan.'));
  assert.equal(keys.length, 25);
  assert.deepEqual(keys.sort(), Object.keys(en).filter(key => key.startsWith('worktree.finish.plan.')).sort());
  assert.match(en['worktree.finish.plan.wholeRoot'], /hand-placed/);
  assert.match(zh['worktree.finish.plan.wholeRoot'], /手工/);
  assert.match(en['worktree.finish.plan.scope'], /not an atomic lock/);
  assert.match(en['worktree.finish.plan.provenance'], /unavailable/);
});

test('primary validation/close errors survive release failure; sole release failure surfaces', async () => {
  for (const primary of ['finish_plan_changed', 'finish_plan_expired', 'daemon close failed']) {
    const h = cleanupHarness(), original = Error(primary), release = Error(primary.startsWith('finish_') ? 'worktree_admission_missing' : 'daemon disconnected');
    if (primary.startsWith('finish_')) h.deps.validate = async () => { throw original; };
    else h.deps.closeSession = async () => { throw original; };
    const warnings = []; h.deps.warn = error => warnings.push(error);
    h.deps.releasePlan = async () => { throw release; };
    await assert.rejects(finish.finalizeFinish(h.deps, confirmation(['s1'])), error => error === original);
    assert.deepEqual(warnings, [release]); assert.equal(h.calls.includes('sql'), false);
  }
  const h = cleanupHarness(pending({ done: true }));
  h.deps.releasePlan = async () => { throw Error('release alone failed'); };
  await assert.rejects(finish.finalizeFinish(h.deps, confirmation(['s1'])), /release alone failed/);
  assert.equal(h.calls.includes('sql'), false);
});
test('strict delayed close removes from current Store without losing new unrelated sessions or resurrecting tabs/layout', async () => {
  const wait = deferred(), calls = [], persistence = [];
  let state = { sessions: [{ id: 'closing' }, { id: 'removed' }], workspans: [{ id: 'old', sessionIds: ['closing', 'removed'] }],
    activeWorkspanId: 'old', hiddenBackgroundSessionIds: new Set(), daemonAttachPendingSessionIds: new Set(['closing']),
    sessionStatuses: {}, statusListeners: {}, tabNotifications: {}, tabStatuses: {}, tabStatusDetails: {}, ptyOutputActivityAt: {}, subagentTranscripts: {} };
  const close = closeCallback({ get: () => state, set: patch => { state = { ...state, ...patch }; calls.push('set'); },
    terminalProcessManager: { close: (id, strict) => { assert.equal(id, 'closing'); assert.equal(strict, true); return wait.promise; } },
    releaseProviderSnapshot() {}, releaseProjectExtensionSnapshot() {}, subagentCloseTimers: new Map(),
    stopSubagentTranscriptRetry() {}, clearPendingSubagentPanesForParent() {}, releaseRemoteHistoryConsumer() {},
    findWorkspanBySession: (workspans, id) => workspans.find(w => w.sessionIds.includes(id)),
    removeSessionFromTerminalWorkspans: (workspans, id) => { assert.equal(id, 'closing'); return workspans.map(w => ({ ...w, sessionIds: w.sessionIds.filter(s => s !== id) })).filter(w => w.sessionIds.length); },
    buildWorkspanMirror: (workspans, activeWorkspanId) => ({ workspans, activeWorkspanId, activeSessionId: workspans.find(w => w.id === activeWorkspanId)?.sessionIds[0] ?? null }),
    queueSshSessionPersistence: async sessions => persistence.push(sessions.map(s => s.id)), isPersistableSession: Boolean,
    useSessionStore: { getState: () => ({ splits: [], saveActiveSessionId: async () => {}, saveWorkspans: async () => {}, saveSplits: async () => {} }) },
  });
  const closing = close('closing', true); assert.equal(calls.length, 0);
  // Another tab closes while another project publishes a new session and layout.
  state = { ...state, sessions: [{ id: 'closing' }, { id: 'new-unrelated', projectId: 'other' }],
    workspans: [{ id: 'changed', sessionIds: ['closing'] }, { id: 'new-layout', sessionIds: ['new-unrelated'] }], activeWorkspanId: 'new-layout',
    sessionStatuses: { 'new-unrelated': 'running' }, tabNotifications: { 'new-unrelated': true },
    hiddenBackgroundSessionIds: new Set(['new-unrelated']), daemonAttachPendingSessionIds: new Set(['closing', 'new-unrelated']) };
  wait.resolve(); await closing;
  assert.deepEqual(Array.from(state.sessions, s => s.id), ['new-unrelated']);
  assert.deepEqual(Array.from(state.workspans, w => w.id), ['new-layout']);
  assert.equal(state.activeWorkspanId, 'new-layout'); assert.equal(state.activeSessionId, 'new-unrelated');
  assert.equal(state.sessionStatuses['new-unrelated'], 'running'); assert.equal(state.tabNotifications['new-unrelated'], true);
  assert.equal(state.hiddenBackgroundSessionIds.has('new-unrelated'), true); assert.equal(state.daemonAttachPendingSessionIds.has('new-unrelated'), true);
  assert.equal(state.daemonAttachPendingSessionIds.has('closing'), false);
  assert.deepEqual(persistence, [['new-unrelated']]);
});

test('actual dialog preserves cleanup error when redundant release disconnects and surfaces sole release failure', async () => {
  for (const primary of [true, false]) {
    const h = dialogHarness(); h.setState(pending());
    h.dependencies.finishCleanup = async () => { if (primary) throw Error('primary close failed'); };
    h.dependencies.releaseFinishCleanup = async () => { throw Error('release disconnected'); };
    h.render(h.props); await flush(); h.render();
    h.button('worktree.finish.cleanup').props.onClick(); await flush(); h.render();
    h.nodes('ConfirmDialog').find(node => node.props.open).props.onConfirm(); await flush(); h.render();
    const rendered = JSON.stringify(h.render());
    assert.match(rendered, primary ? /primary close failed/ : /release disconnected/);
    if (primary) { assert.doesNotMatch(rendered, /release disconnected/); assert.equal(h.calls.includes('warnRelease'), true); }
  }
});
