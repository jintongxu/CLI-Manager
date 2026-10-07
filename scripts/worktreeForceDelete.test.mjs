import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { load, finish, force, record, dialogHarness, storeHarness, flush, deferred, setForceInvoke } from './worktreeFinishRecovery.test.mjs';
const req = finish.finishRequest(record, 'D:/main');
const confirmation = () => ({ req, token: 'original', confirmedPath: record.path, deleteBranch: true, branchOid: 'a'.repeat(40), pathMissing: false, sessionIds: [] });

test('actual service exact path, original-token preflight, replacement rejection and newcomers have no effects', async () => {
  const h = storeHarness(), calls = [];
  setForceInvoke(async (command, args) => { calls.push([command, args]); if (command.endsWith('_validate')) throw Error('replaced'); });
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path + ' '), /confirmation_changed/);
  assert.equal(calls.length, 0);
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /replaced/);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].token, 'original');
  assert.equal(h.calls.length, 0); assert.equal(h.store.worktrees.length, 1);
  let sessions = ['new'];
  const deps = { currentRequest: () => req, sessionIds: () => sessions, closeSession: async () => { throw Error('must not close'); } };
  await assert.rejects(force.finalizeForceDelete(deps, confirmation(), record.path), /sessions_changed/);
  assert.equal(calls.length, 1);
  sessions = [];
  setForceInvoke(async () => { sessions.push('new'); return confirmation(); });
  await assert.rejects(force.finalizeForceDelete(deps, confirmation(), record.path), /sessions_changed/);
});

test('actual store force SQL failure retains record; missing path/branch retry finalizes and refresh never redoes Git', async () => {
  const h = storeHarness(), calls = [];
  setForceInvoke(async (command, args) => { calls.push(command); assert.equal(args.token, 'original'); return command.endsWith('_validate') ? { ...confirmation(), pathMissing: calls.length > 2, branchOid: calls.length > 2 ? null : confirmation().branchOid } : { done: true, branchDeleted: true }; });
  h.sqlFail(true);
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /force_delete_database_failed/);
  assert.equal(h.store.worktrees.length, 1);
  assert.equal(h.calls.includes('removeProject:w1'), false);
  h.sqlFail(false); h.refreshFail(true);
  await h.store.forceDelete(record, { ...confirmation(), pathMissing: true, branchOid: null, req: { ...req } }, record.path);
  assert.equal(h.store.worktrees.length, 0);
  assert.ok(h.calls.indexOf('removeProject:w1') > h.calls.indexOf('sql-delete'));
  assert.ok(h.calls.includes('warn'));
  assert.deepEqual(calls, ['git_worktree_force_delete_validate','git_worktree_force_delete','git_worktree_force_delete_validate','git_worktree_force_delete']);
  assert.equal(h.calls.some(x => /merge|stage|commit|ack/.test(x)), false);
});

test('actual store force shares commit/finish/discard lock and original request identity', async () => {
  const h = storeHarness(), wait = deferred();
  const held = finish.withFinishLock(record.id, () => wait.promise);
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /finish_in_progress/);
  assert.equal(h.calls.length, 0); wait.resolve(); await held;
  h.store.worktrees[0].path = 'D:/changed';
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /confirmation_changed/);
});

test('standalone force preflight independent of unknown/dirty/legacy finish; cancel and close cycles isolate authorization', async () => {
  const h = dialogHarness(true);
  h.setState({ checkoutValid: false, unknown: true, blocker: 'finish_legacy_residual_manual_review' });
  h.dependencies.inspectForceDelete = async () => { h.calls.push('force-inspect'); return confirmation(); };
  h.dependencies.forceDelete = async (_record, c, path) => { h.calls.push('force-execute'); assert.equal(c.token, 'original'); assert.equal(path, record.path); };
  h.render(h.props); await flush(); h.render();
  let dialog = h.nodes('WorktreeForceDeleteDialog')[0]; assert.ok(dialog);
  h.nodes('Dialog')[0].props.onOpenChange(false); assert.equal(h.closes, 0);
  dialog.props.onConfirm('wrong'); await flush(); assert.equal(h.calls.includes('force-execute'), false);
  dialog.props.onClose(); h.render(); assert.equal(h.closes, 1);
  dialog.props.onConfirm(record.path); await flush(); assert.equal(h.calls.includes('force-execute'), false);
  h.render({ ...h.props, open: false }); h.render(h.props); await flush(); h.render();
  h.nodes('WorktreeForceDeleteDialog')[0].props.onConfirm(record.path); await flush(); h.render();
  assert.ok(h.calls.includes('force-execute')); assert.equal(h.closes, 2);
  assert.equal(h.calls.some(x => /git_stage|git_commit|^merge$|^inspect:/.test(x)), false);
});

test('actual confirmation callbacks exact input/cancel/doubleclick/outside/Escape and bilingual aria', () => {
  let typed = '', tree, confirms = [], cancelled = 0; const ref = { current: false };
  const jsx = (type, props) => ({ type, props });
  const component = load('src/features/projects/api/WorktreeForceDeleteDialog.tsx', {
    react: { useState: () => [typed, value => { typed = value; }], useRef: () => ref },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    '../../../shared/ui/dialog': Object.fromEntries(['Dialog','DialogContent','DialogTitle','DialogDescription','DialogFooter'].map(x => [x,x])),
    '../../../shared/ui/button': { Button: 'Button' },
  }).WorktreeForceDeleteDialog;
  const render = () => tree = component({ confirmation: confirmation(), onConfirm: path => confirms.push(path), onClose: () => cancelled++ });
  const nodes = type => { const found = []; const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.type === type) found.push(n); walk(n.props?.children); }; walk(tree); return found; };
  render(); assert.equal(nodes('Button')[1].props.disabled, true);
  nodes('Button')[1].props.onClick(); assert.equal(confirms.length, 0);
  nodes('Button')[0].props.onClick(); assert.equal(cancelled, 1);
  for (const name of ['onInteractOutside','onEscapeKeyDown']) { let prevented = false; nodes('DialogContent')[0].props[name]({ preventDefault: () => prevented = true }); assert.ok(prevented); }
  typed = record.path.toUpperCase(); render(); assert.ok(nodes('Button')[1].props.disabled);
  nodes('input')[0].props.onChange({ currentTarget: { value: record.path } }); render();
  assert.equal(nodes('Button')[1].props.disabled, false);
  assert.equal(nodes('input')[0].props['aria-label'], 'worktree.forceDelete.typePath');
  nodes('Button')[1].props.onClick(); nodes('Button')[1].props.onClick(); assert.deepEqual(confirms, [record.path]);
  const zh = load('src/shared/i18n/messages/projects.zh-CN.ts').zh;
  const en = load('src/shared/i18n/messages/projects.en-US.ts').en;
  for (const key of Object.keys(zh).filter(key => key.startsWith('worktree.forceDelete.'))) assert.ok(zh[key] && en[key]);
});

test('backend validate cannot silently replace opaque token before session effects', async () => {
  const h = storeHarness();
  setForceInvoke(async () => ({ ...confirmation(), token: 'replacement' }));
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /authorization_changed/);
  assert.equal(h.calls.length, 0);
});

test('actual store closes sessions only after same-token validation and before execute/SQL; invalid token leaves sessions', async () => {
  const h = storeHarness(); h.sessions.push({ id: 's1', worktreeId: record.id });
  const c = { ...confirmation(), sessionIds: ['s1'] };
  setForceInvoke(async () => { throw Error('expired'); });
  await assert.rejects(h.store.forceDelete(record, c, record.path), /expired/);
  assert.equal(h.sessions.length, 1); assert.equal(h.calls.length, 0);
  setForceInvoke(async command => {
    h.calls.push(command);
    if (command.endsWith('_validate')) return c;
    assert.equal(h.sessions.length, 0);
    return { done: true, branchDeleted: true };
  });
  await h.store.forceDelete(record, c, record.path);
  assert.deepEqual(h.calls.slice(0, 4), ['git_worktree_force_delete_validate', 'close:s1', 'git_worktree_force_delete', 'sql-delete']);
});

test('missing branch/path finalization is force-only and newcomer during release prevents execute', async () => {
  const c = { ...confirmation(), pathMissing: true, branchOid: null };
  const calls = []; let sessions = ['s1']; c.sessionIds = ['s1'];
  const deps = { currentRequest: () => c.req, sessionIds: () => sessions,
    closeSession: async () => { calls.push('close'); sessions = []; },
    releaseSessions: async () => { sessions.push('new'); },
    deleteRecord: async () => calls.push('sql'), removeLocal: () => calls.push('local'), refresh: async () => calls.push('refresh'), warn: () => {},
  };
  setForceInvoke(async command => { calls.push(command); return c; });
  await assert.rejects(force.finalizeForceDelete(deps, c, record.path), /sessions_changed/);
  assert.deepEqual(calls, ['git_worktree_force_delete_validate','close']);
  sessions = []; c.sessionIds = []; calls.length = 0;
  setForceInvoke(async command => { calls.push(command); return command.endsWith('_validate') ? c : { done: true, branchDeleted: true }; });
  await force.finalizeForceDelete(deps, c, record.path);
  assert.deepEqual(calls, ['git_worktree_force_delete_validate','git_worktree_force_delete','sql','local','refresh']);
});

test('standalone busy and doubleclick protect force confirmation; failed force requires explicit fresh inspection', async () => {
  const h = dialogHarness(true), wait = deferred(); let inspects = 0;
  h.dependencies.inspectForceDelete = async () => { inspects++; return inspects === 1 ? wait.promise : confirmation(); };
  h.dependencies.forceDelete = async () => { h.calls.push('force-failed'); throw Error('force_delete_database_failed'); };
  h.render(h.props); h.render();
  assert.equal(inspects, 1); h.nodes('Dialog')[0].props.onOpenChange(false); assert.equal(h.closes, 0);
  assert.equal(h.button('common.cancel').props.disabled, true);
  wait.resolve(confirmation()); await flush(); h.render();
  const confirm = h.nodes('WorktreeForceDeleteDialog')[0].props.onConfirm;
  confirm(record.path); confirm(record.path); h.render();
  h.nodes('Dialog')[0].props.onOpenChange(false); assert.equal(h.closes, 0);
  await flush(); h.render();
  assert.equal(h.calls.filter(x => x === 'force-failed').length, 1);
  assert.equal(h.nodes('WorktreeForceDeleteDialog').length, 0);
  assert.match(JSON.stringify(h.render()), /forceDelete.failed/);
  assert.equal(inspects, 1);
  const retry = h.button('worktree.forceDelete.retry').props.onClick;
  retry(); retry(); await flush(); h.render(); assert.equal(inspects, 2);
  assert.equal(h.nodes('WorktreeForceDeleteDialog').length, 1);
});

test('external parent close invalidates retained confirm callback and in-flight preflight before session effects', async () => {
  const h = dialogHarness(true);
  h.dependencies.inspectForceDelete = async () => confirmation();
  h.dependencies.forceDelete = async () => h.calls.push('force-execute');
  h.render(h.props); await flush(); h.render();
  const staleConfirm = h.nodes('WorktreeForceDeleteDialog')[0].props.onConfirm;
  h.render({ ...h.props, open: false });
  staleConfirm(record.path); await flush();
  assert.equal(h.calls.includes('force-execute'), false);
  h.render(h.props); await flush(); h.render();
  staleConfirm(record.path); await flush();
  assert.equal(h.calls.includes('force-execute'), false);

  const store = storeHarness(), wait = deferred(); let current = true;
  store.sessions.push({ id: 's1', worktreeId: record.id });
  const c = { ...confirmation(), sessionIds: ['s1'] };
  setForceInvoke(async command => { assert.equal(command, 'git_worktree_force_delete_validate'); return wait.promise; });
  const operation = store.store.forceDelete(record, c, record.path, () => current);
  current = false; wait.resolve(c);
  await assert.rejects(operation, /confirmation_changed/);
  assert.equal(store.sessions.length, 1);
  assert.equal(store.calls.length, 0);
});

function walkNodes(tree, type) {
  const result = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === type) result.push(node);
    walk(node.props?.children);
  };
  walk(tree); return result;
}

test('actual Sidebar menu places danger force directly below discard for active/missing/pending and only opens standalone flow', () => {
  const source = readFileSync(new URL('../src/features/projects/components/SidebarView.tsx', import.meta.url), 'utf8');
  const dependencies = {};
  for (const match of source.matchAll(/import \{([^}]+)\} from "([^"]+)"/g)) {
    dependencies[match[2]] = Object.fromEntries(match[1].split(',').map(name => [name.trim(), name.trim()]));
  }
  let slots = [], cursor = 0;
  dependencies.react = { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; } };
  const jsx = (type, props) => ({ type, props });
  dependencies['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  dependencies['../api/projectIdeaStore'] = { useProjectIdeaStore: select => select({ activeProjectId: null, closeProjectIdeas() {} }) };
  dependencies['../../providers/api/providerSwitching'] = { getProviderSwitchAppType: () => null };
  dependencies['../api/worktreeMetadata'] = { getWorktreeDisplayName: wt => wt.name };
  const sidebar = load('src/features/projects/components/SidebarView.tsx', dependencies).SidebarView;
  const project = { id: 'p1', path: 'D:/main' }, calls = [];
  for (const status of ['active', 'missing', 'pending']) {
    slots = [];
    const target = { ...record, status, branch: status === 'missing' ? '' : record.branch };
    const props = {
      projects: [project], pinnedProjects: [], openProjectIds: new Set(), selectedProjectIds: new Set(), selectedGroupIds: new Set(), selectedWorktreeIds: new Set(),
      displayedTree: [], groups: [], compactMode: true, sidebarCollapsed: true,
      contextMenu: { kind: 'worktree', project, worktree: target },
      t: key => key, setContextMenu: value => calls.push(['menu', value]),
      setFinishTarget: () => { throw Error('must not open finish'); }, setDiscardTarget: () => { throw Error('must not discard'); },
      removeWorktree: () => { throw Error('must not delete'); },
    };
    const render = () => { cursor = 0; return sidebar(props); };
    let tree = render();
    const buttons = walkNodes(tree, 'button').filter(n => n.props.role === 'menuitem');
    const index = buttons.findIndex(n => n.props.children?.includes?.('worktree.menu.discard'));
    const forceItem = buttons[index + 1];
    assert.ok(index >= 0); assert.ok(forceItem.props.children.includes('worktree.menu.forceDelete'));
    assert.equal(forceItem.props.className, 'context-menu-item danger'); assert.ok(!forceItem.props.disabled);
    forceItem.props.onClick(); tree = render();
    const flow = walkNodes(tree, 'WorktreeForceDeleteFlow')[0];
    assert.equal(flow.props.open, true); assert.equal(flow.props.worktree, target); assert.equal(flow.props.project, project);
    assert.equal(walkNodes(tree, 'WorktreeFinishDialog')[0].props.open, false);
    assert.deepEqual(calls.at(-1), ['menu', null]);
    flow.props.onClose(); tree = render(); assert.equal(walkNodes(tree, 'WorktreeForceDeleteFlow')[0].props.open, false);
  }
  for (const [lang, expected] of [['zh-CN', '强制删除 Worktree…'], ['en-US', 'Force delete Worktree…']]) {
    const messages = load('src/shared/i18n/messages/projects.' + lang + '.ts')[lang === 'zh-CN' ? 'zh' : 'en'];
    assert.equal(messages['worktree.menu.forceDelete'], expected);
  }
  const finishDialog = dialogHarness(); finishDialog.render(finishDialog.props);
  assert.equal(finishDialog.nodes('WorktreeForceDeleteDialog').length, 0);
  assert.equal(finishDialog.button('worktree.forceDelete.title'), undefined);
});

test('standalone late inspect, changed target, language/object refresh and close during validate reject stale authorization', async () => {
  const h = dialogHarness(true), late = deferred(); let inspects = 0;
  h.dependencies.inspectForceDelete = async wt => { inspects++; return inspects === 1 ? late.promise : { ...confirmation(), confirmedPath: wt.path, req: { ...req, worktreePath: wt.path } }; };
  h.dependencies.forceDelete = async () => h.calls.push('execute');
  h.render(h.props);
  const next = { ...h.props, worktree: { ...record, path: 'D:/tasks/two' } };
  h.render(next); await flush(); h.render();
  late.resolve(confirmation()); await flush(); h.render();
  assert.equal(h.nodes('WorktreeForceDeleteDialog')[0].props.confirmation.confirmedPath, next.worktree.path);
  const retained = h.nodes('WorktreeForceDeleteDialog')[0].props.onConfirm;
  h.language('zh'); h.render({ ...next, worktree: { ...next.worktree }, project: { ...next.project } });
  assert.equal(inspects, 2);
  h.render({ ...next, open: false }); h.render(next); await flush(); h.render();
  retained(next.worktree.path); await flush(); assert.equal(h.calls.includes('execute'), false);

  const store = storeHarness(), validating = deferred();
  store.sessions.push({ id: 's1', worktreeId: record.id });
  const c = { ...confirmation(), sessionIds: ['s1'] };
  const flow = dialogHarness(true);
  flow.dependencies.inspectForceDelete = async () => c;
  flow.dependencies.forceDelete = (...args) => store.store.forceDelete(...args);
  setForceInvoke(async command => { assert.equal(command, 'git_worktree_force_delete_validate'); return validating.promise; });
  flow.render(flow.props); await flush(); flow.render();
  flow.nodes('WorktreeForceDeleteDialog')[0].props.onConfirm(record.path);
  flow.render({ ...flow.props, open: false }); validating.resolve(c); await flush(); flow.render();
  assert.equal(store.sessions.length, 1); assert.equal(store.calls.length, 0);
});

test('standalone inspection failure has explicit retry/cancel and never auto-renews authorization', async () => {
  const h = dialogHarness(true); let inspects = 0;
  h.dependencies.inspectForceDelete = async () => { inspects++; if (inspects === 1) throw Error('force_delete_protected'); return confirmation(); };
  h.render(h.props); await flush(); h.render();
  assert.match(JSON.stringify(h.render()), /forceDelete.failed/);
  assert.equal(h.nodes('WorktreeForceDeleteDialog').length, 0);
  h.language('zh'); h.render({ ...h.props, worktree: { ...record } }); await flush(); h.render();
  assert.equal(inspects, 1);
  h.button('worktree.forceDelete.retry').props.onClick(); await flush(); h.render();
  assert.equal(inspects, 2); assert.equal(h.nodes('WorktreeForceDeleteDialog').length, 1);
  h.nodes('WorktreeForceDeleteDialog')[0].props.onClose(); assert.equal(h.closes, 1);
});

test('actual service binds deleteBranch and explicit OID including null; legacy/malformed inspections are rejected', async () => {
  for (const patch of [{ deleteBranch: false }, { branchOid: undefined }, { branchOid: 'bad' }, { branchOid: '' }, { branchOid: 42 }]) {
    setForceInvoke(async () => ({ ...confirmation(), ...patch }));
    await assert.rejects(force.inspectForceDelete(req), /invalid_inspection/);
  }
  for (const oid of ['a'.repeat(40), null]) {
    setForceInvoke(async () => ({ ...confirmation(), branchOid: oid }));
    assert.equal((await force.inspectForceDelete(req)).branchOid, oid);
  }
});

test('actual store original OID validate mismatch/failure closes nothing; execution branch failure fences SQL/sidebar', async () => {
  for (const oid of [null, 'b'.repeat(40)]) {
    const h = storeHarness(); h.sessions.push({ id: 's1', worktreeId: record.id });
    const c = { ...confirmation(), sessionIds: ['s1'] };
    setForceInvoke(async () => ({ ...c, branchOid: oid }));
    await assert.rejects(h.store.forceDelete(record, c, record.path), /authorization_changed/);
    assert.equal(h.sessions.length, 1); assert.equal(h.calls.length, 0);
  }
  const h = storeHarness(), calls = [];
  setForceInvoke(async command => { calls.push(command); if (command.endsWith('_validate')) return confirmation(); throw Error('force_delete_branch_delete_failed'); });
  await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /branch_delete_failed/);
  assert.equal(h.store.worktrees.length, 1); assert.equal(h.calls.length, 0);
  const fresh = { ...confirmation(), token: 'fresh', pathMissing: true };
  setForceInvoke(async (command, args) => { calls.push(command); assert.equal(args.token, 'fresh'); return command.endsWith('_validate') ? fresh : { done: true, branchDeleted: true }; });
  await h.store.forceDelete(record, fresh, record.path);
  assert.equal(h.store.worktrees.length, 0); assert.ok(h.calls.includes('sql-delete'));
  assert.equal(h.calls.some(x => /merge|stage|commit|ack/.test(x)), false);
});

test('actual service rejects incomplete or legacy execution responses before SQL', async () => {
  for (const result of [{ done: true }, { done: true, branchDeleted: false }, { done: false, branchDeleted: true }]) {
    const h = storeHarness();
    setForceInvoke(async command => command.endsWith('_validate') ? confirmation() : result);
    await assert.rejects(h.store.forceDelete(record, confirmation(), record.path), /incomplete/);
    assert.equal(h.calls.length, 0); assert.equal(h.store.worktrees.length, 1);
  }
});

test('actual confirmation bilingual risk promises local branch deletion and warns unmerged loss; null OID displays missing', () => {
  for (const [lang, pattern, lost] of [['en-US', /local wt branch will be deleted/, /Unmerged commits lose/], ['zh-CN', /本地 wt 分支将被删除/, /未合并提交将失去/]]) {
    const messages = load('src/shared/i18n/messages/projects.' + lang + '.ts')[lang === 'zh-CN' ? 'zh' : 'en'];
    assert.match(messages['worktree.forceDelete.risk'], pattern);
    assert.match(messages['worktree.forceDelete.risk'], lost);
    assert.doesNotMatch(messages['worktree.forceDelete.branch'], /preserv|保留/);
    assert.doesNotMatch(messages['worktree.forceDelete.done'], /preserv|保留/);
  }
  const jsx = (type, props) => ({ type, props });
  const component = load('src/features/projects/api/WorktreeForceDeleteDialog.tsx', {
    react: { useState: () => ['', () => {}], useRef: () => ({ current: false }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    '../../../shared/ui/dialog': Object.fromEntries(['Dialog','DialogContent','DialogTitle','DialogDescription','DialogFooter'].map(x => [x,x])),
    '../../../shared/ui/button': { Button: 'Button' },
  }).WorktreeForceDeleteDialog;
  const tree = component({ confirmation: { ...confirmation(), branchOid: null }, onConfirm() {}, onClose() {} });
  assert.match(JSON.stringify(tree), /worktree.forceDelete.missingBranch/);
});
