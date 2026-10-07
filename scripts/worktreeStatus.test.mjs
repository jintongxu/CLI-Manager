import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, finish, record, flush, deferred } from './worktreeFinishRecovery.test.mjs';

const initial = (patch = {}) => ({ checkoutValid: true, merged: false, outcome: null, sourceOid: 'abc',
  cleanupReady: false, cleanupPending: false, blocker: null, unknown: false, done: false,
  stashReference: null, mergeResult: null, ...patch });
function nodes(tree, type) {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === type) found.push(node);
    walk(node.props?.children);
  };
  walk(tree); return found;
}
function harness() {
  let cursor = 0, slots = [], effects = [], dirty = false, props, tree, language = 'en', closes = 0;
  let inspect = async () => initial();
  const calls = [];
  const react = {
    useState(value) {
      const i = cursor++; if (!(i in slots)) slots[i] = { value };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; }];
    },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((v, j) => v !== previous.deps[j])) {
        slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const service = load('src/features/projects/api/worktreeStatus.ts', { '@tauri-apps/api/core': {
    invoke: (command, args) => { calls.push([command, args]); assert.equal(command, 'git_worktree_finish_inspect'); return inspect(args.req); },
  } });
  const component = load('src/features/projects/api/WorktreeStatusDialog.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, './worktreeFinish': finish, './worktreeStatus': service,
    './worktreeMetadata': { getWorktreeDisplayName: wt => wt.display_name || wt.name },
    '../../../shared/i18n/index': { useI18n: () => ({ t: (key, params) => language + ':' + key + (params ? ':' + JSON.stringify(params) : '') }) },
    '../../../shared/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogTitle', 'DialogDescription', 'DialogFooter'].map(k => [k, k])),
    '../../../shared/ui/button': { Button: 'Button' },
    // Any Store/SQL/session import or other invoke throws rather than supplying a permissive stub.
  }).WorktreeStatusDialog;
  const h = {
    calls, service,
    props: { open: true, project: { id: 'p1', path: 'D:/main' }, worktree: record, onClose: () => closes++ },
    inspect(fn) { inspect = fn; }, language(value) { language = value; }, get closes() { return closes; },
    render(next = props) {
      props = next;
      for (let pass = 0; pass < 20; pass++) {
        dirty = false; cursor = 0; tree = component(props); const queued = effects; effects = []; queued.forEach(fn => fn());
        if (!dirty) break;
      }
      return tree;
    },
    text() { return JSON.stringify(tree); }, nodes(type) { return nodes(tree, type); },
    refresh() { h.nodes('Button').find(n => n.props.children.endsWith(':worktree.statusView.refresh')).props.onClick(); },
    close() { h.nodes('Button').find(n => n.props.children.endsWith(':common.close')).props.onClick(); },
  };
  return h;
}

test('actual read-only component classifies all finish states without SQL, sessions or other IPC', async () => {
  const cases = [
    [initial(), 'valid', 'notConfirmed'],
    [initial({ merged: true, outcome: 'merged', cleanupPending: true, cleanupReady: true }), 'merged', 'merged'],
    [initial({ outcome: 'no_diff', cleanupReady: true }), 'noDiff', 'noDiff'],
    [initial({ done: true, checkoutValid: false }), 'done', 'notConfirmed'],
    [initial({ unknown: true, merged: true, outcome: 'merged', checkoutValid: false }), 'unknown', 'notConfirmed'],
    [initial({ checkoutValid: false }), 'unknown', 'notConfirmed'],
    [initial({ blocker: 'finish_dirty_checkout' }), 'blocked', 'notConfirmed'],
    [initial({ blocker: 'finish_stash_restore_pending', stashReference: 'retained-oid', merged: true, outcome: 'merged' }), 'blocked', 'merged'],
    [initial({ blocker: 'finish_legacy_residual_manual_review', unknown: true, merged: true, outcome: 'merged' }), 'blocked', 'notConfirmed'],
  ];
  for (const [state, summary, outcome] of cases) {
    const h = harness(); h.inspect(async () => state);
    h.render(h.props); await flush(); h.render();
    assert.match(h.text(), new RegExp('summary\\.' + summary));
    assert.match(h.text(), new RegExp('outcome\\.' + outcome));
    assert.match(h.text(), /recordStatus/); assert.match(h.text(), /record\.active/);
    assert.match(h.text(), /D:\/main/); assert.match(h.text(), /D:\/tasks\/one/);
    assert.match(h.text(), /wt\/one/); assert.match(h.text(), /master/); assert.match(h.text(), /sourceOid/);
    assert.match(h.text(), /checkoutValid/); assert.match(h.text(), /cleanupPending/);
    assert.match(h.text(), /cleanupReady/); assert.match(h.text(), /statusView.done/);
    if (state.blocker) assert.ok(h.text().includes(state.blocker));
    if (state.stashReference) assert.ok(h.text().includes('retained-oid'));
    assert.equal(h.nodes('Button').length, 2); // Close + refresh, never a mutation action.
    assert.equal(h.calls.length, 1);
    assert.equal(JSON.stringify(h.calls[0][1]), JSON.stringify({ req: finish.finishRequest(record, 'D:/main') }));
  }
});

test('known blockers provide human guidance with raw code; unsupported fields are never guessed', () => {
  const h = harness();
  for (const [raw, expected] of [
    ['finish_dirty_checkout', 'dirty'], ['finish_legacy_residual_manual_review', 'residual'],
    ['finish_stash_restore_pending', 'stash'], ['finish_merge_abort_unconfirmed', 'abort'],
    ['finish_source_changed', 'changed'], ['finish_base_changed', 'changed'], ['finish_branch_in_use', 'branchInUse'],
    ['finish_unsafe_link', 'identity'], ['finish_checkout_root_mismatch', 'identity'], ['arbitrary: error', 'generic'],
  ]) assert.equal(h.service.worktreeStatusGuidance(raw), expected);
  const source = readFileSync(new URL('../src/features/projects/api/WorktreeStatusDialog.tsx', import.meta.url), 'utf8');
  assert.equal(/pathExists|branchExists|registered|git_get_changes|inspectFinish/.test(source), false);
});

test('refresh clears old result; error retry restores authority without stale snapshot or side effects', async () => {
  const h = harness(); h.inspect(async () => initial({ sourceOid: 'old-proof' }));
  h.render(h.props); await flush(); h.render(); assert.ok(h.text().includes('old-proof'));
  const wait = deferred(); h.inspect(() => wait.promise); h.refresh(); h.render();
  assert.equal(h.text().includes('old-proof'), false); assert.match(h.text(), /statusView.loading/);
  wait.reject(Error('finish_path_failed: denied')); await flush(); h.render();
  assert.match(h.text(), /statusView.error/); assert.match(h.text(), /finish_path_failed: denied/);
  assert.equal(h.text().includes('old-proof'), false);
  h.language('zh'); h.render(); assert.match(h.text(), /zh:worktree.statusView.error/);
  h.inspect(async () => initial({ outcome: 'no_diff' })); h.refresh(); await flush(); h.render();
  assert.match(h.text(), /summary.noDiff/); assert.equal(h.text().includes('denied'), false);
  assert.equal(h.calls.length, 3);
});

test('same identity object/language refresh preserves cycle; overlapping inspect responses use request generation', async () => {
  const h = harness(), old = deferred(), latest = deferred();
  h.inspect(() => old.promise); h.render(h.props);
  h.language('zh'); h.render({ ...h.props, project: { ...h.props.project }, worktree: { ...record, display_name: '新名称' } });
  assert.equal(h.calls.length, 1); assert.match(h.text(), /新名称/);
  h.inspect(() => latest.promise); h.refresh(); h.render();
  latest.resolve(initial({ sourceOid: 'latest-proof', outcome: 'no_diff' })); await flush(); h.render();
  old.resolve(initial({ sourceOid: 'stale-proof' })); await flush(); h.render();
  assert.ok(h.text().includes('latest-proof')); assert.equal(h.text().includes('stale-proof'), false);
  assert.match(h.text(), /zh:worktree.statusView.summary.noDiff/);
});

test('close/reopen same target and changed identity ignore late success/failure; hooks survive null targets', async () => {
  const h = harness(), old = deferred(); h.inspect(() => old.promise); h.render(h.props); h.close();
  assert.equal(h.closes, 1);
  old.resolve(initial({ sourceOid: 'closed-proof' })); await flush(); h.render();
  assert.equal(h.text().includes('closed-proof'), false);
  h.render({ ...h.props, open: false });
  h.inspect(async () => initial({ sourceOid: 'reopened-proof' })); h.render(h.props); await flush(); h.render();
  assert.ok(h.text().includes('reopened-proof'));
  const late = deferred(); h.inspect(() => late.promise); h.refresh(); h.render();
  h.inspect(async () => initial({ sourceOid: 'new-target' }));
  const next = { ...h.props, project: { ...h.props.project, path: 'D:/other' }, worktree: { ...record, id: 'w2', path: 'D:/two' } };
  h.render(next); await flush(); h.render(); late.reject(Error('old-error')); await flush(); h.render();
  assert.ok(h.text().includes('new-target')); assert.equal(h.text().includes('old-error'), false);
  assert.equal(h.calls.at(-1)[1].req.projectPath, 'D:/other');
  h.render({ ...next, worktree: null }); assert.equal(h.render(), null);
  h.render({ ...next, project: null }); assert.equal(h.render(), null);
  h.render(next); await flush(); h.render(); assert.ok(h.text().includes('new-target'));
  h.nodes('Dialog')[0].props.onOpenChange(false); assert.equal(h.closes, 2);
});

test('every request identity field initiates fresh inspection; record-status-only changes do not', async () => {
  for (const patch of [{ id: 'other' }, { path: 'D:/new' }, { branch: 'wt/new' }, { base_branch: 'main' }]) {
    const h = harness(); h.render(h.props); await flush(); h.render();
    h.render({ ...h.props, worktree: { ...record, ...patch } }); await flush(); h.render(); assert.equal(h.calls.length, 2);
  }
  for (const patch of [{ id: 'new-project' }, { path: 'D:/new-main' }]) {
    const h = harness(); h.render(h.props); await flush(); h.render();
    h.render({ ...h.props, project: { ...h.props.project, ...patch } }); await flush(); h.render();
    assert.equal(h.calls.length, 2);
  }
  const h = harness(); h.render(h.props); await flush(); h.render();
  h.render({ ...h.props, worktree: { ...record, status: 'pending' } }); assert.equal(h.calls.length, 1);
  assert.match(h.text(), /record.pending/);
});

test('actual Sidebar status callback is non-dangerous, before Finish and available for active/missing/pending', () => {
  const source = readFileSync(new URL('../src/features/projects/components/SidebarView.tsx', import.meta.url), 'utf8');
  const dependencies = {};
  for (const match of source.matchAll(/import \{([^}]+)\} from "([^"]+)"/g)) {
    dependencies[match[2]] = Object.fromEntries(match[1].split(',').map(name => [name.trim(), name.trim()]));
  }
  let slots = [], cursor = 0;
  dependencies.react = { useState(value) {
    const i = cursor++; if (!(i in slots)) slots[i] = value;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
  } };
  const jsx = (type, props) => ({ type, props });
  dependencies['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  dependencies['../api/projectIdeaStore'] = { useProjectIdeaStore: select => select({ activeProjectId: null, closeProjectIdeas() {} }) };
  dependencies['../../providers/api/providerSwitching'] = { getProviderSwitchAppType: () => null };
  dependencies['../api/worktreeMetadata'] = { getWorktreeDisplayName: wt => wt.name };
  const sidebar = load('src/features/projects/components/SidebarView.tsx', dependencies).SidebarView;
  for (const status of ['active', 'missing', 'pending']) {
    slots = [];
    const project = { id: 'p1', path: 'D:/main' }, target = { ...record, status }, calls = [];
    const props = {
      projects: [project], pinnedProjects: [], openProjectIds: new Set(), selectedProjectIds: new Set(),
      selectedGroupIds: new Set(), selectedWorktreeIds: new Set(), displayedTree: [], groups: [], compactMode: true,
      sidebarCollapsed: true, contextMenu: { kind: 'worktree', project, worktree: target }, t: key => key,
      setContextMenu: value => calls.push(value), setFinishTarget: () => assert.fail('must not finish'),
      setDiscardTarget: () => assert.fail('must not discard'), removeWorktree: () => assert.fail('must not delete'),
    };
    const render = () => { cursor = 0; return sidebar(props); };
    let tree = render();
    const buttons = nodes(tree, 'button').filter(n => n.props.role === 'menuitem');
    const index = buttons.findIndex(n => n.props.children?.includes?.('worktree.statusView.menu'));
    assert.ok(index >= 0); assert.ok(buttons[index + 1].props.children.includes('worktree.menu.finish'));
    assert.equal(buttons[index].props.className, 'context-menu-item'); assert.ok(!buttons[index].props.disabled);
    buttons[index].props.onClick(); tree = render();
    const dialog = nodes(tree, 'WorktreeStatusDialog')[0];
    assert.equal(dialog.props.open, true); assert.equal(dialog.props.worktree, target); assert.equal(dialog.props.project, project);
    assert.equal(nodes(tree, 'WorktreeFinishDialog')[0].props.open, false);
    assert.equal(nodes(tree, 'WorktreeForceDeleteFlow')[0].props.open, false); assert.deepEqual(calls, [null]);
    dialog.props.onClose(); assert.equal(nodes(render(), 'WorktreeStatusDialog')[0].props.open, false);
  }
});

test('new zh/en status keys match; all rendered/guidance keys resolve and wording rejects live-field guesses', async () => {
  const zh = load('src/shared/i18n/messages/projects.zh-CN.ts').zh;
  const en = load('src/shared/i18n/messages/projects.en-US.ts').en;
  const keys = messages => Object.keys(messages).filter(k => k.startsWith('worktree.statusView.')).sort();
  assert.deepEqual(keys(zh), keys(en)); assert.equal(zh['worktree.statusView.menu'], '查看 Worktree 状态…');
  assert.equal(en['worktree.statusView.menu'], 'View Worktree status…');
  assert.match(en['worktree.statusView.description'], /does not prove the branch still exists/);
  assert.match(en['worktree.statusView.description'], /does not imply a clean checkout/);
  assert.match(en['worktree.statusView.summary.done'], /database finalization/);
  assert.match(en['worktree.statusView.summary.noDiff'], /does not mean a merge ran/);
  for (const state of [initial(), initial({ unknown: true }), initial({ done: true }), initial({ merged: true, outcome: 'merged' }),
    initial({ outcome: 'no_diff' }), initial({ blocker: 'finish_stash_restore_pending' })]) {
    const h = harness(); h.inspect(async () => state); h.render(h.props); await flush(); h.render();
    for (const match of h.text().matchAll(/en:(worktree\.statusView\.[A-Za-z.]+)/g)) {
      assert.equal(typeof zh[match[1]], 'string', match[1]); assert.equal(typeof en[match[1]], 'string', match[1]);
    }
  }
});
