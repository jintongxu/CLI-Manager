import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}) {
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, console, setTimeout, crypto: { randomUUID: () => 'new-id' },
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error('unexpected import ' + name); } });
  return exports;
}
const force = load('src/features/projects/api/worktreeForceDelete.ts', { '@tauri-apps/api/core': { invoke: (...args) => forceInvoke(...args) } });
let forceInvoke;
const finish = load('src/features/projects/api/worktreeFinish.ts');
const initial = (patch = {}) => ({ checkoutValid: true, merged: false, outcome: null, sourceOid: 'abc',
  cleanupReady: false, cleanupPending: false, blocker: null, unknown: false, done: false,
  stashReference: null, mergeResult: null, ...patch });
const pending = (patch = {}) => initial({ merged: true, outcome: 'merged', cleanupReady: true, cleanupPending: true, ...patch });
const record = { id: 'w1', project_id: 'p1', path: 'D:/tasks/one', branch: 'wt/one', base_branch: 'master', name: 'one', status: 'active' };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function cleanupHarness(state = pending()) {
  const calls = [], sessions = ['s1'];
  const deps = {
    inspect: async () => { calls.push('inspect'); return state; }, sessionIds: () => [...sessions],
    closeSession: async id => { calls.push('close:' + id); sessions.splice(sessions.indexOf(id), 1); },
    releaseSessions: async () => calls.push('release'), cleanup: async () => { calls.push('cleanup'); return pending({ done: true }); },
    deleteRecord: async () => calls.push('sql'), removeLocal: () => calls.push('remove'), ack: async () => calls.push('ack'),
    refresh: async () => calls.push('refresh'), warn: () => calls.push('warn'),
  };
  return { deps, calls, sessions };
}

test('invalid/unknown/pending never read changes; historical dirty valid checkout must review', async () => {
  for (const state of [initial({ checkoutValid: false, unknown: true }), pending(), pending({ done: true }), pending({ blocker: 'finish_restore_blocked' })]) {
    let reads = 0;
    const result = await finish.readFinishReview(async () => state, async () => { reads++; return [{ path: 'wrong' }]; });
    assert.equal(reads, 0);
    assert.equal(result.changes.length, 0);
    assert.equal(finish.canReviewFinish(state), false);
  }
  const historical = initial({ merged: true, outcome: 'merged', blocker: 'finish_dirty_checkout' });
  const result = await finish.readFinishReview(async () => historical, async () => [{ path: 'new.txt', status: '??' }]);
  assert.equal(result.step, 'review');
  assert.equal(finish.canReviewFinish(historical), true);
});
test('missing branch without completion evidence stays unknown; receipt done enables SQL-only finalization', async () => {
  assert.equal(finish.finishStatus(initial({ checkoutValid: false, unknown: true })), 'missing');
  const h = cleanupHarness(pending({ checkoutValid: false, done: true, cleanupReady: false }));
  await finish.finalizeFinish(h.deps, ['s1']);
  assert.equal(h.calls.includes('cleanup'), false);
  assert.equal(h.calls.join(','), 'inspect,close:s1,release,sql,remove,ack,refresh');
});
test('blocked inspect has no session side effects; new sessions require another confirmation', async () => {
  const blocked = cleanupHarness(pending({ blocker: 'finish_legacy_residual_manual_review' }));
  await assert.rejects(finish.finalizeFinish(blocked.deps, ['s1']), /manual_review/);
  assert.equal(blocked.calls.join(','), 'inspect');
  const h = cleanupHarness(); h.sessions.push('newcomer');
  await assert.rejects(finish.finalizeFinish(h.deps, ['s1']), /sessions_changed/);
  assert.equal(h.calls.join(','), 'inspect');
});
test('SQL failure retains record and receipt; refresh/ack failure after SQL does not retry Git', async () => {
  const h = cleanupHarness();
  h.deps.deleteRecord = async () => { h.calls.push('sql'); throw new Error('database locked'); };
  await assert.rejects(finish.finalizeFinish(h.deps, ['s1']), /finish_database_failed/);
  assert.equal(h.calls.includes('ack'), false); assert.equal(h.calls.includes('remove'), false);
  const success = cleanupHarness(pending({ done: true }));
  success.deps.refresh = async () => { throw new Error('sidebar'); };
  success.deps.ack = async () => { throw new Error('ack'); };
  await finish.finalizeFinish(success.deps, ['s1']);
  assert.equal(success.calls.includes('cleanup'), false);
  assert.equal(success.calls.filter(x => x === 'warn').length, 2);
  assert.equal(success.calls.includes('remove'), true);
});
test('cleanup failure does not delete SQL or ack; same-worktree process guard releases after rejection', async () => {
  const h = cleanupHarness(); h.deps.cleanup = async () => { throw new Error('os error 32'); };
  await assert.rejects(finish.finalizeFinish(h.deps, ['s1']), /os error 32/);
  assert.equal(h.calls.includes('sql'), false);
  const hold = deferred(); const operation = finish.withFinishLock('w1', () => hold.promise);
  await assert.rejects(finish.withFinishLock('w1', async () => {}), /finish_in_progress/);
  hold.resolve(); await operation;
  await finish.withFinishLock('w1', async () => {});
});

function dialogHarness(flow = false) {
  let slots = [], cursor = 0, effects = [], props, tree, dirty = false, language = 'en', closes = 0;
  const calls = [], sessions = [{ id: 's1', worktreeId: 'w1' }];
  let state = initial(), inspectOverride;
  const deps = {
    inspectFinish: async wt => { calls.push('inspect:' + wt.id); return inspectOverride ? inspectOverride(wt) : state; },
    finishMerge: async () => { calls.push('merge'); state = pending(); return state; },
    finishCleanup: async (_wt, _deleteBranch, confirmed) => { calls.push('cleanup:' + confirmed.join(',')); },
  };
  const react = {
    useState(initialValue) {
      const i = cursor++; if (!(i in slots)) slots[i] = { value: initialValue };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo: compute => { cursor++; return compute(); },
    useEffect(effect, dependencies) {
      const i = cursor++, previous = slots[i];
      if (!previous || dependencies.some((v, j) => v !== previous.dependencies[j])) {
        slots[i] = { dependencies }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); });
      }
    },
  };
  const jsx = (type, p) => ({ type, props: p });
  const component = load(flow ? 'src/features/projects/api/WorktreeForceDeleteFlow.tsx' : 'src/features/projects/api/WorktreeFinishDialog.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push(command + ':' + args.projectPath);
      if (command === 'git_get_changes') return h.changes;
      if (command === 'git_stage_all' && h.stageError) throw new Error(h.stageError);
      return 'oid';
    } },
    sonner: { toast: { success: () => {} } },
    '../../../shared/i18n/index': { useI18n: () => ({ t: (key, params) => language + ':' + key + (params ? ':' + JSON.stringify(params) : '') }) },
    './WorktreeForceDeleteDialog': { WorktreeForceDeleteDialog: 'WorktreeForceDeleteDialog' },
    './worktreeStore': { useWorktreeStore: select => select(deps) },
    './worktreeMetadata': { getWorktreeDisplayName: wt => wt.name }, './worktreeFinish': finish,
    '../../terminal/state': { useTerminalStore: { getState: () => ({ sessions }) } },
    '../../../shared/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogTitle'].map(k => [k, k])),
    '../../../shared/ui/button': { Button: 'Button' }, '../../../shared/ui/textarea': { Textarea: 'Textarea' },
    '../../../shared/ui/ConfirmDialog': { ConfirmDialog: 'ConfirmDialog' },
  })[flow ? "WorktreeForceDeleteFlow" : "WorktreeFinishDialog"];
  const h = {
    calls, changes: [], stageError: null, sessions,
    setState: value => { state = value; }, setInspect: value => { inspectOverride = value; },
    language: value => { language = value; }, get closes() { return closes; },
    render(next = props) {
      props = next;
      for (let pass = 0; pass < 20; pass++) {
        dirty = false; cursor = 0; tree = component(props); const queued = effects; effects = []; queued.forEach(effect => effect());
        if (!dirty) break;
      }
      return tree;
    },
    nodes(type) {
      const result = []; const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.type === type) result.push(node); walk(node.props?.children);
      }; walk(tree); return result;
    },
    button(key) { return h.nodes('Button').find(node => node.props.children?.endsWith?.(':' + key)); },
    props: { project: { id: 'p1', path: 'D:/main' }, worktree: record, open: true, onClose: () => closes++ },
  };
  h.dependencies = deps;
  return h;
}

test('dialog invalid checkout disables mutation and initial inspect failure exposes no stale changes', async () => {
  const h = dialogHarness(); h.setState(initial({ checkoutValid: false, unknown: true }));
  h.render(h.props); await flush(); h.render();
  assert.equal(h.calls.some(call => call.startsWith('git_get_changes')), false);
  assert.equal(h.button('worktree.finish.merge').props.disabled, true);
  h.button('worktree.finish.merge').props.onClick(); await flush();
  assert.equal(h.calls.includes('merge'), false);
});
test('dialog object/language refresh does not reset cycle; close/reopen isolates late old response', async () => {
  const h = dialogHarness(), late = deferred();
  h.setInspect(wt => wt.id === 'w1' ? late.promise : Promise.resolve(pending({ done: true })));
  h.render(h.props);
  h.language('zh'); h.render({ ...h.props, worktree: { ...record } });
  assert.equal(h.calls.filter(call => call === 'inspect:w1').length, 1);
  h.render({ ...h.props, open: false });
  h.render({ ...h.props, worktree: { ...record, id: 'w2', path: 'D:/two' } });
  await flush(); h.render();
  late.resolve(initial()); await flush(); h.render();
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, false);
  assert.equal(h.calls.some(call => call.startsWith('git_get_changes:D:/tasks/one')), false); // Cancelled cycles never read the old checkout.
  assert.equal(h.nodes('Textarea').length, 0);
});
test('dialog stage failure rechecks authority; pending retry/reopen never stages or remerges', async () => {
  const h = dialogHarness(); h.changes = [{ path: 'new.txt', status: '??' }];
  h.render(h.props); await flush(); h.render();
  h.stageError = 'stage_all_failed'; h.button('worktree.finish.commitAll').props.onClick();
  await flush(); h.render();
  assert.equal(h.calls.filter(call => call.startsWith('git_commit')).length, 0);
  assert.equal(h.button('worktree.finish.commitAll').props.disabled, true);
  h.setState(pending()); h.render({ ...h.props, open: false }); h.render(h.props); await flush(); h.render();
  assert.equal(h.nodes('Textarea').length, 0);
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, false);
});
test('dialog requires explicit cleanup confirmation; busy rejects outside close; language updates errors', async () => {
  const h = dialogHarness(); h.setState(pending()); h.render(h.props); await flush(); h.render();
  const wait = deferred(); h.setInspect(() => wait.promise);
  h.button('worktree.finish.cleanup').props.onClick(); h.render();
  h.nodes('Dialog')[0].props.onOpenChange(false); assert.equal(h.closes, 0);
  wait.resolve(pending()); await flush(); h.render();
  assert.equal(h.calls.some(call => call.startsWith('cleanup:')), false);
  const confirm = h.nodes('ConfirmDialog').find(node => node.props.open);
  assert.ok(confirm); confirm.props.onConfirm(); await flush(); h.render();
  assert.ok(h.calls.includes('cleanup:s1')); assert.equal(h.closes, 1);
  const error = dialogHarness(); error.changes = [{ path: 'new', status: 'M' }]; error.stageError = 'stage_all_failed';
  error.render(error.props); await flush(); error.render(); error.button('worktree.finish.commitAll').props.onClick(); await flush(); error.render();
  error.language('zh'); error.render();
  assert.match(JSON.stringify(error.render()), /zh:worktree.finish.error.stageAllFailedTitle/);
});

function storeHarness() {
  let store;
  const calls = [], project = { id: 'p1', path: 'D:/main' }, sessions = [];
  let state = initial(), sqlFail = false, refreshFail = false, inspectError = null;
  const projectStore = { projects: [project], setWorktreeStatusLocal: (_id, status) => calls.push('status:' + status),
    removeWorktreeLocal: id => calls.push('removeProject:' + id), fetchAll: async () => { calls.push('refresh'); if (refreshFail) throw Error('refresh'); } };
  const api = load('src/features/projects/api/worktreeStore.ts', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push(command);
      if (command === 'git_worktree_finish_inspect' && inspectError) throw Error(inspectError);
      assert.equal(args.req.worktreeId, 'w1');
      if (command === 'git_worktree_finish_cleanup') state = pending({ done: true, checkoutValid: false });
      return state;
    } },
    zustand: { create: init => {
      const get = () => store;
      const set = update => { store = { ...store, ...(typeof update === 'function' ? update(store) : update) }; };
      store = init(set, get); return { getState: get };
    } },
    '../../../shared/platform/db': { getDb: async () => ({ execute: async sql => {
      calls.push(sql.startsWith('DELETE') ? 'sql-delete' : 'sql-update');
      if (sql.startsWith('DELETE') && sqlFail) throw Error('locked');
    } }) },
    '../../../shared/platform/logger': { logWarn: () => calls.push('warn') },
    '../../providers/api/providerSwitching': { hasConfiguredCliTool: () => true },
    './projectCapabilities': { projectSupportsCapability: () => true }, './projectStore': { useProjectStore: { getState: () => projectStore } },
    '../../terminal/state': { useTerminalStore: { getState: () => ({ sessions, closeSession: async id => { calls.push('close:' + id); sessions.splice(sessions.findIndex(item => item.id === id), 1); } }) } },
    './worktreeForceDelete': force,
    './worktreeFinish': finish,
  });
  api.useWorktreeStore.getState().worktrees = [{ ...record }];
  return { sessions, get store() { return api.useWorktreeStore.getState(); }, calls, setState: next => { state = next; }, sqlFail: next => { sqlFail = next; }, refreshFail: next => { refreshFail = next; }, inspectError: next => { inspectError = next; } };
}
test('actual store SQL failure remains pending and retry does not merge; refresh failure removes store immediately', async () => {
  const h = storeHarness(); h.setState(pending()); h.sqlFail(true);
  await assert.rejects(h.store.finishCleanup(record, true, []), /database_failed/);
  assert.equal(h.store.worktrees[0].status, 'pending');
  assert.equal(h.calls.includes('git_worktree_finish_ack'), false);
  h.sqlFail(false); h.refreshFail(true); await h.store.finishCleanup(record, true, []);
  assert.equal(h.store.worktrees.length, 0);
  assert.equal(h.calls.filter(call => call === 'git_worktree_finish_cleanup').length, 1);
  assert.equal(h.calls.includes('git_worktree_finish_merge'), false);
  assert.ok(h.calls.indexOf('sql-delete') < h.calls.indexOf('git_worktree_finish_ack'));
});
test('actual store startup only inspects and invalid merge guards prohibit backend mutation', async () => {
  const h = storeHarness(); h.setState(initial({ checkoutValid: false, unknown: true }));
  await h.store.markMissingWorktrees();
  assert.equal(h.store.worktrees[0].status, 'missing');
  await assert.rejects(h.store.finishMerge(record), /invalid_checkout/);
  assert.equal(h.calls.includes('git_worktree_finish_merge'), false);
  assert.equal(h.calls.includes('git_worktree_finish_cleanup'), false);
});

test('dialog historical dirty merge evidence still presents review; restore blockers never commit', async () => {
  const h = dialogHarness(); h.changes = [{ path: 'new.txt', status: 'M' }];
  h.setState(initial({ merged: true, outcome: 'merged', blocker: 'finish_dirty_checkout' }));
  h.render(h.props); await flush(); h.render();
  assert.equal(h.button('worktree.finish.commitAll').props.disabled, false);
  h.render({ ...h.props, open: false }); h.setState(pending({ blocker: 'force_merge_restore_failed', stashReference: 'stash-oid' }));
  h.render(h.props); await flush(); h.render();
  assert.equal(h.nodes('Textarea').length, 0);
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, true);
  assert.match(JSON.stringify(h.render()), /forceRestoreStashReference/);
});
test('dialog merge then cleanup failure retries cleanup without remerge across refresh/language/reopen', async () => {
  const h = dialogHarness(); h.render(h.props); await flush(); h.render();
  h.button('worktree.finish.merge').props.onClick(); await flush(); h.render();
  h.dependencies.finishCleanup = async () => { h.calls.push('cleanupFailed'); throw new Error('os error 32'); };
  h.button('worktree.finish.cleanup').props.onClick(); await flush(); h.render();
  h.nodes('ConfirmDialog').find(node => node.props.open).props.onConfirm(); await flush(); h.render();
  assert.match(JSON.stringify(h.render()), /cleanupFailedTitle/);
  h.language('zh'); h.render({ ...h.props, worktree: { ...record, display_name: 'renamed' } });
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, false);
  assert.match(JSON.stringify(h.render()), /zh:worktree.finish.cleanupFailedTitle/);
  h.render({ ...h.props, open: false }); h.render(h.props); await flush(); h.render();
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, false);
  assert.equal(h.calls.filter(call => call === 'merge').length, 1);
  assert.equal(h.calls.filter(call => call.startsWith('git_stage_all')).length, 0);
});

test('commit reinspection becoming pending prevents staging; cancelled open cannot start late mutations', async () => {
  const h = dialogHarness(); h.changes = [{ path: 'new', status: 'M' }];
  h.render(h.props); await flush(); h.render(); h.setState(pending());
  h.button('worktree.finish.commitAll').props.onClick(); await flush(); h.render();
  assert.equal(h.calls.some(call => call.startsWith('git_stage_all')), false);
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, false);
  const late = dialogHarness(), wait = deferred(); late.changes = [{ path: 'old', status: 'M' }];
  late.render(late.props); await flush(); late.render(); late.setInspect(() => wait.promise);
  late.button('worktree.finish.commitAll').props.onClick();
  late.render({ ...late.props, open: false }); wait.resolve(initial()); await flush(); late.render();
  assert.equal(late.calls.some(call => call.startsWith('git_stage_all')), false);
});
test('actual store and dialog commit share the same same-worktree process lock', async () => {
  const h = storeHarness(), wait = deferred();
  const held = finish.withFinishLock('w1', () => wait.promise);
  await assert.rejects(h.store.finishCleanup(record, true, []), /finish_in_progress/);
  await assert.rejects(h.store.finishMerge(record), /finish_in_progress/);
  assert.equal(h.calls.length, 0); wait.resolve(); await held;
});
test('recovery tree nodes remain accessible in open-terminals-only sidebar filter', () => {
  const model = load('src/features/projects/lib/sidebarModel.ts', {
    '../api/projectStore': {}, '../../history/api/externalSessionSyncStore': {}, '../api/projectStartupCommand': {},
    '../../../shared/lib/cliTools': {}, '../../providers/api/providerSwitching': {}, '../../history/api/externalSessionGrouping': {},
    '../api/groupPath': {},
  });
  const tree = [{ type: 'group', group: { id: 'g' }, children: [{ type: 'project', project: { id: 'p1' },
    worktrees: [{ ...record, status: 'pending' }, { ...record, id: 'w2', status: 'active' }] }] }];
  const filtered = model.filterTreeForOpenTerminals(tree, new Set(), new Set());
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].children[0].worktrees.length, 1);
  assert.equal(filtered[0].children[0].worktrees[0].status, 'pending');
});

test('dialog failed initialization clears old changes and blocks commit until a successful recheck', async () => {
  const h = dialogHarness(); h.changes = [{ path: 'stale-secret.txt', status: 'M' }];
  h.render(h.props); await flush(); h.render();
  h.render({ ...h.props, open: false }); h.setInspect(async () => { throw Error('finish_path_failed: access denied'); });
  h.render(h.props); await flush(); h.render();
  assert.equal(JSON.stringify(h.render()).includes('stale-secret.txt'), false);
  assert.equal(h.nodes('Textarea').length, 1);
  assert.equal(h.button('worktree.finish.commitAll').props.disabled, true);
  h.setInspect(null); h.button('worktree.finish.reinspect').props.onClick(); await flush(); h.render();
  assert.equal(h.button('worktree.finish.commitAll').props.disabled, false);
});

test('explicit discard shares finish lock and cannot close sessions during a finish operation', async () => {
  const h = storeHarness(), wait = deferred();
  const held = finish.withFinishLock('w1', () => wait.promise);
  await assert.rejects(h.store.removeWorktree(record, true), /finish_in_progress/);
  assert.equal(h.calls.length, 0);
  wait.resolve(); await held;
});

test('dialog force-merge stash restore conflict is integrated and remains cleanup-blocked on reopen', async () => {
  const h = dialogHarness(); h.render(h.props); await flush(); h.render();
  h.dependencies.finishMerge = async (_wt, force) => {
    h.calls.push(force ? 'force-merge' : 'ordinary-merge');
    if (!force) throw Error('dirty_main_worktree');
    const state = pending({ blocker: 'finish_stash_restore_pending', stashReference: 'retained-stash', mergeResult: {
      merged: true, skipped: false, output: 'stash restore conflict', conflictFiles: [], stashCreated: true,
      stashRestored: false, stashReference: 'retained-stash', stashRestoreConflictFiles: ['base.txt'],
    } });
    h.setState(state); return state;
  };
  h.render();
  h.button('worktree.finish.merge').props.onClick(); await flush(); h.render();
  h.button('worktree.finish.forceMerge').props.onClick(); h.render();
  assert.equal(h.calls.includes('force-merge'), false);
  h.nodes('ConfirmDialog').find(node => node.props.open).props.onConfirm(); await flush(); h.render();
  assert.equal(h.calls.includes('force-merge'), true);
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, true);
  assert.match(JSON.stringify(h.render()), /forceRestoreConflictTitle/);
  assert.match(JSON.stringify(h.render()), /base.txt/);
  h.render({ ...h.props, open: false });
  h.setState(pending({ blocker: 'finish_stash_restore_pending', stashReference: 'retained-stash' }));
  h.language('zh'); h.render(h.props); await flush(); h.render();
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, true);
  assert.equal(h.nodes('Textarea').length, 0);
  assert.match(JSON.stringify(h.render()), /retained-stash/);
  assert.equal(h.calls.some(call => call.startsWith('cleanup:')), false);
});


test('legacy merged residual has an explicit manual recovery path, never checkout reads or cleanup', async () => {
  const h = dialogHarness();
  h.setState(pending({ checkoutValid: false, unknown: true, cleanupReady: false, blocker: 'finish_legacy_residual_manual_review' }));
  h.render(h.props); await flush(); h.render();
  assert.match(JSON.stringify(h.render()), /legacyResidualMessage/);
  assert.match(JSON.stringify(h.render()), new RegExp(record.path));
  assert.equal(h.nodes('Textarea').length, 0);
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, true);
  assert.equal(h.calls.some(call => call.startsWith('git_get_changes') || call.startsWith('git_stage_all')), false);
  h.setState(pending({ checkoutValid: false, cleanupReady: true, unknown: false, blocker: null }));
  h.button('worktree.finish.reinspect').props.onClick(); await flush(); h.render();
  assert.equal(h.button('worktree.finish.cleanup').props.disabled, false);
});

test('startup inspection errors fail closed without hiding pending recovery or closing sessions', async () => {
  const h = storeHarness(); h.inspectError('finish_path_failed: access denied');
  await h.store.markMissingWorktrees();
  assert.equal(h.store.worktrees[0].status, 'missing');
  assert.equal(h.calls.includes('git_worktree_finish_cleanup'), false);
  h.store.worktrees = [{ ...record, status: 'pending' }];
  await assert.rejects(h.store.inspectFinish(record), /access denied/);
  assert.equal(h.store.worktrees[0].status, 'pending');
});

export { load, finish, force, record, dialogHarness, storeHarness, flush, deferred };
export function setForceInvoke(fn) { forceInvoke = fn; }

// Lifecycle classification must not confuse historical ancestry with Finish progress.
test('lifecycle matrix keeps historical dirty and prepared checkouts active, true recovery pending', () => {
  const historicalDirty = initial({ merged: true, outcome: 'merged', blocker: 'finish_dirty_checkout' });
  for (const state of [initial(), initial({ merged: true, outcome: 'merged', cleanupReady: true }),
    historicalDirty, initial({ blocker: 'finish_dirty_checkout' })]) {
    assert.equal(finish.finishStatus(state), 'active');
    assert.equal(finish.canReviewFinish(state), true);
  }
  assert.throws(() => finish.assertCleanupReady(historicalDirty), /finish_dirty_checkout/);
  for (const state of [pending(), pending({ merged: false, outcome: 'no_diff' }),
    initial({ cleanupPending: true }), initial({ done: true }),
    ...['finish_stash_restore_pending', 'finish_restore_blocked', 'finish_source_changed',
      'finish_base_changed', 'finish_residual_changed', 'finish_root_replaced'].map(blocker => pending({ blocker }))]) {
    assert.equal(finish.finishStatus(state), 'pending');
    assert.equal(finish.canReviewFinish(state), false);
  }
  assert.equal(finish.finishStatus(initial({ checkoutValid: false, unknown: true })), 'missing');
  assert.equal(finish.finishStatus(pending({ checkoutValid: false, unknown: true })), 'pending');
});

// Execute BOTH production stores and production tree building. Only platform/SQL
// boundaries are mocked; persisted state is reloaded on every startup cycle.
function startupHarness(storedStatus = 'pending') {
  const calls = [], rows = [{ ...record, status: storedStatus, description: '' }];
  const projects = [{ id: 'p1', name: 'Project', cli_tool: '', path: 'D:/main', group_id: null }];
  const sessions = [{ id: 'hidden-wt', projectId: 'p1', worktreeId: 'w1', cwd: record.path, cliSessionId: 'cli-one', hidden: true },
    { id: 'root', projectId: 'p1', cwd: 'D:/main', cliSessionId: 'cli-root' }];
  let state = initial({ merged: true, outcome: 'merged', blocker: 'finish_dirty_checkout' }), error = null;
  const create = init => {
    let value;
    const get = () => value;
    const set = update => { value = { ...value, ...(typeof update === 'function' ? update(value) : update) }; };
    value = init(set, get);
    return { getState: get, setState: set };
  };
  const db = { select: async sql => {
    calls.push(['select', sql]);
    if (sql.includes('FROM worktrees')) return rows.map(row => ({ ...row }));
    if (sql.includes('FROM projects')) return projects.map(row => ({ ...row }));
    if (sql.includes('FROM groups')) return [];
    throw Error('unexpected select ' + sql);
  }, execute: async (sql, params) => {
    calls.push(['execute', sql, [...params]]);
    assert.equal(sql, 'UPDATE worktrees SET status = $1, updated_at = $2 WHERE id = $3');
    assert.equal(params[2], 'w1'); rows[0].status = params[0]; rows[0].updated_at = params[1];
  } };
  const native = { invoke: async (command, args) => {
    calls.push(['invoke', command, args]);
    assert.equal(command, 'git_worktree_finish_inspect');
    assert.equal(JSON.stringify(args.req), JSON.stringify(finish.finishRequest(record, 'D:/main')));
    if (error) throw Error(error); return state;
  } };
  const settings = { getState: () => ({ worktreeOrderByProject: {} }), subscribe: () => () => {} };
  const shared = { zustand: { create }, '@tauri-apps/api/core': native,
    '../../../shared/platform/db': { getDb: async () => db },
    '../../../shared/platform/logger': { logWarn: (...args) => calls.push(['warn', ...args]) },
    '../../providers/api/providerSwitching': {}, './projectCapabilities': { projectSupportsCapability: () => false } };
  const projectApi = load('src/features/projects/api/projectStore.ts', { ...shared,
    '../../../shared/lib/worktreeOrder': load('src/shared/lib/worktreeOrder.ts'),
    sonner: { toast: {} }, '../../../shared/i18n/index': {},
    '../lib/projectLoadPolicy': { resolveProjectFetchPolicy: () => ({ includePathHealth: false, refreshProviderBadges: false }) },
    '../../../shared/preferences/settingsStore': { useSettingsStore: settings },
    '../../../shared/platform/shell': {}, './nodeAppearance': {}, '../../remote/api/sshToolIntegration': {}, './groupPath': {},
  });
  const worktreeApi = load('src/features/projects/api/worktreeStore.ts', { ...shared,
    './projectStore': projectApi, './worktreeFinish': finish, './worktreeForceDelete': force,
    '../../terminal/state': { useTerminalStore: { getState: () => ({ sessions,
      closeSession: async id => { calls.push(['close', id]); throw Error('startup must not close'); } }) } },
  });
  return { calls, rows, sessions, get project() { return projectApi.useProjectStore.getState(); },
    get store() { return worktreeApi.useWorktreeStore.getState(); },
    state: next => { state = next; }, error: next => { error = next; },
    async startup() {
      await projectApi.useProjectStore.getState().fetchAll('startup');
      await worktreeApi.useWorktreeStore.getState().loadWorktrees();
      await worktreeApi.useWorktreeStore.getState().markMissingWorktrees();
    } };
}
function assertStartupStatus(h, status) {
  assert.equal(h.store.worktrees[0].status, status);
  assert.equal(h.project.worktrees[0].status, status);
  assert.equal(h.project.tree[0].worktrees[0].status, status);
}
function assertInspectionOnly(h, sessions) {
  assert.ok(h.calls.filter(call => call[0] === 'invoke').every(call => call[1] === 'git_worktree_finish_inspect'));
  assert.equal(h.calls.some(call => call[0] === 'close'), false);
  assert.equal(JSON.stringify(h.sessions), sessions);
}
test('actual startup repairs stale SQL pending in both stores/tree and repeated reload is idempotent', async () => {
  const h = startupHarness(), sessions = JSON.stringify(h.sessions);
  await h.startup();
  assertStartupStatus(h, 'active'); assert.equal(h.rows[0].status, 'active');
  const writes = h.calls.filter(call => call[0] === 'execute');
  assert.equal(writes.length, 1); assert.equal(writes[0][2][0], 'active');
  await h.startup(); // Same loading/checking path is also used after backup restore.
  await h.store.markMissingWorktrees();
  assertStartupStatus(h, 'active');
  assert.equal(h.calls.filter(call => call[0] === 'execute').length, 1);
  assertInspectionOnly(h, sessions);
});
test('actual startup keeps trusted recovery pending and inspection errors preserve stale pending without SQL', async () => {
  for (const error of ['finish_receipt_corrupt', 'finish_receipt_identity_mismatch', 'finish_path_failed: access denied']) {
    const h = startupHarness(), sessions = JSON.stringify(h.sessions); h.error(error);
    await h.startup(); await h.startup();
    assertStartupStatus(h, 'pending'); assert.equal(h.rows[0].status, 'pending');
    assert.equal(h.calls.filter(call => call[0] === 'execute').length, 0);
    assertInspectionOnly(h, sessions);
  }
  for (const state of [pending(), pending({ merged: false, outcome: 'no_diff' }),
    pending({ blocker: 'finish_stash_restore_pending' }), pending({ checkoutValid: false, done: true })]) {
    const h = startupHarness(), sessions = JSON.stringify(h.sessions); h.state(state);
    await h.startup(); await h.startup(); assertStartupStatus(h, 'pending');
    assert.equal(h.calls.filter(call => call[0] === 'execute').length, 0);
    assertInspectionOnly(h, sessions);
  }
  const h = startupHarness('active'); h.error('finish_path_failed');
  await h.startup(); assertStartupStatus(h, 'missing');
  assert.equal(h.rows[0].status, 'active'); // Failed authority never normalizes SQL.
});
