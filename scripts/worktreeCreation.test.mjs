import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

function load(file, deps, fallback) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, console, setTimeout, crypto: { randomUUID },
    require: name => {
      if (name in deps) return deps[name];
    if (name.endsWith('/worktreeCreationRecovery')) return load('src/features/projects/api/worktreeCreationRecovery.ts', {});
      if (name.endsWith('/worktreeLabels')) return load('src/features/projects/api/worktreeLabels.ts', {});
      if (name.endsWith('/WorktreeShortLabelField')) return { ...load('src/features/projects/components/WorktreeShortLabelField.tsx', {
        react: { useId: () => 'short-label' }, 'react/jsx-runtime': { jsx, jsxs: jsx },
        '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
      }), WorktreeShortLabelField: 'WorktreeShortLabelField' };
      if (fallback) return fallback(name);
      throw Error('unexpected dependency ' + name);
    } });
  return exports;
}
function harness() {
  let state, invokeImpl, sqlFail = false;
  const calls = [], sql = [];
  const project = { id: 'p', path: 'D:/repo', worktree_root: '' };
  const api = load('src/features/projects/api/worktreeStore.ts', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      assert.equal(command, 'git_worktree_create'); calls.push(args.req);
      if (invokeImpl) return invokeImpl(args.req);
      const name = args.req.taskName + '-authority';
      return { name, branch: 'wt/' + name, path: 'D:/worktrees/' + name, baseBranch: 'main' };
    } },
    zustand: { create: init => {
      const get = () => state;
      state = init(update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; }, get);
      return { getState: get };
    } },
    '../../../shared/platform/db': { getDb: async () => ({ execute: async (...args) => {
      if (sqlFail) throw Error('SQL locked'); sql.push(args);
    }, select: async (query, args) => {
      if (query.startsWith('SELECT id')) return [];
      const values = sql.find(([, values]) => values[0] === args[0])[1];
      const keys = ['id', 'project_id', 'name', 'display_name', 'description', 'branch', 'path', 'base_branch', 'deps_prompt_dismissed', 'provider_overrides', 'status', 'created_at', 'updated_at', 'short_label'];
      return [{ ...Object.fromEntries(keys.map((key, i) => [key, values[i]])), label_ordinal: sql.length }];
    } }) },
    '../../../shared/platform/logger': { logWarn() {} },
    '../../providers/api/providerSwitching': { hasConfiguredCliTool: () => true },
    './projectCapabilities': { projectSupportsCapability: () => true },
    './projectStore': { useProjectStore: { getState: () => ({ fetchAll: async () => {}, addWorktreeLocal: () => {} }) } },
    '../../../shared/lib/worktreeLaunchAdmission': {},
    './worktreeDepsRunner': { useWorktreeDepsRunnerStore: { getState: () => ({ cancel: async () => {} }) } },
    './worktreeFinish': {}, './worktreeForceDelete': {}, '../../terminal/state': {},
  });
  return { api, project, calls, sql, get store() { return api.useWorktreeStore.getState(); },
    invoke(fn) { invokeImpl = fn; }, sqlFail(value) { sqlFail = value; } };
}

test('random identity is ASCII bounded and unique within a minute regardless of loaded records', () => {
  const h = harness(), names = new Set();
  for (let i = 0; i < 100; i++) {
    const name = h.api.createDefaultWorktreeTaskName('p');
    assert.match(name, /^task-\d{4}-\d{4}-[a-f0-9]{12}$/);
    assert.ok(h.api.validateWorktreeTaskName(name)); names.add(name);
  }
  assert.equal(names.size, 100);
});

test('fixed preview passes unchanged; returned name/branch/path authoritative and display independent', async () => {
  for (const displayName of ['修复登录', 'English', '中English123', '123', '重复', '重复']) {
    const h = harness(); h.store.worktrees.push({ project_id: 'p', name: 'fixed-preview' });
    const record = await h.store.createWorktreeForProject(h.project, { taskName: 'fixed-preview', displayName });
    assert.equal(h.calls[0].taskName, 'fixed-preview');
    assert.equal(record.display_name, displayName);
    assert.equal(record.name, 'fixed-preview-authority');
    assert.equal(record.branch, 'wt/fixed-preview-authority');
    assert.equal(h.sql[0][1][2], record.name); assert.equal(h.sql[0][1][3], displayName);
  }
});

test('legacy strings and automatic calls generate internal names, never derive display slugs', async () => {
  const h = harness();
  for (const input of ['English', '中文', { displayName: 'same' }, { displayName: 'same' }, undefined]) {
    const record = await h.store.createWorktreeForProject(h.project, input);
    assert.match(h.calls.at(-1).taskName, /^task-\d{4}-\d{4}-[a-f0-9]{12}$/);
    if (input === undefined) assert.equal(record.display_name, h.calls.at(-1).taskName);
  }
  assert.equal(new Set(h.calls.map(c => c.taskName)).size, 5);
  const web = readFileSync('src/features/terminal/lib/webManagement.ts', 'utf8');
  assert.match(web, /optionalWorktreeText\(payload, "displayName", 64\)[\s\S]*?optionalWorktreeText\(payload, "taskName", 64\)/);
});

test('duplicate guard blocks IPC and releases after success, Git failure and SQL failure', async () => {
  const h = harness(), input = { taskName: 'preview', displayName: '中文' };
  let resolve; h.invoke(() => new Promise(r => { resolve = r; }));
  const first = h.store.createWorktreeForProject(h.project, input);
  await assert.rejects(h.store.createWorktreeForProject(h.project, input), /worktree_create_in_progress/);
  assert.equal(h.calls.length, 1);
  resolve({ name: 'preview', branch: 'wt/preview', path: 'D:/preview', baseBranch: 'main' }); await first;
  h.invoke(() => { throw Error('fatal: denied'); });
  await assert.rejects(h.store.createWorktreeForProject(h.project, input), /fatal: denied/);
  h.invoke(null); h.sqlFail(true);
  await assert.rejects(h.store.createWorktreeForProject(h.project, input), /worktree_record_save_failed: preview-authority; D:\/worktrees\/preview-authority; Error: SQL locked/);
  h.sqlFail(false); await h.store.createWorktreeForProject(h.project, input);
  assert.equal(h.calls.length, 4);
});

function nodes(tree, type) {
  const result = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === type) result.push(n);
    walk(n.props?.children);
  }
  walk(tree); return result;
}
const jsx = (type, props) => ({ type, props });
const dummyModule = () => new Proxy({}, { get: (_, key) => {
  if (key === 'TERM') return {};
  if (key === 'panelColorTint') return () => '';
  if (key === 'useProjectIdeaStore') return () => null;
  if (key === 'TreeContext') return { Provider: 'Provider' };
  return String(key);
} });

test('actual Sidebar prompt editing changes display only; all four button/split paths carry preview', async () => {
  const component = load('src/features/projects/components/SidebarView.tsx', {
    react: { useState: value => [value, () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
  }, dummyModule).SidebarView;
  for (const direction of [undefined, 'horizontal']) for (const auto of [false, true]) {
    const calls = [], queuedUpdates = [];
    let prompt = { project: { id: 'p' }, taskName: 'fixed-preview', displayName: 'fixed-preview', description: '', direction };
    const props = { projects: [], pinnedProjects: [], openProjectIds: new Set(), treeActions: {},
      selectedProjectIds: new Set(), selectedGroupIds: new Set(), selectedWorktreeIds: new Set(),
      sidebarToolbarVisibility: {}, activeSessionId: 'session', t: key => key,
      setWorktreePrompt: fn => { if (typeof fn === 'function') queuedUpdates.push(fn); else prompt = fn; },
      updateProject: async () => {}, createAndOpenWorktree: (...args) => calls.push(args),
      createAndSplitWorktree: (...args) => calls.push(args) };
    let tree = component({ ...props, worktreePrompt: prompt });
    const preview = nodes(tree, 'Input').find(n => n.props.readOnly && n.props.value === 'fixed-preview');
    assert.equal(preview.props.value, 'fixed-preview'); assert.equal(preview.props.onChange, undefined);
    nodes(tree, 'WorktreeShortLabelField').at(-1).props.onChange('任务');
    const nameEvent = { currentTarget: { value: '中文展示' } };
    nodes(tree, 'Input').find(n => n.props['aria-label'] === 'worktree.prompt.taskName').props.onChange(nameEvent);
    const descriptionEvent = { currentTarget: { value: '任务描述' } };
    nodes(tree, 'textarea').find(n => n.props.value === '' && !n.props.className.includes('resize-y')).props.onChange(descriptionEvent);
    // React clears currentTarget after dispatch, before queued updaters may run.
    nameEvent.currentTarget = null; descriptionEvent.currentTarget = null;
    for (const update of queuedUpdates) prompt = update(prompt);
    assert.equal(prompt.taskName, 'fixed-preview');
    assert.equal(prompt.displayName, '中文展示');
    assert.equal(prompt.description, '任务描述');
    tree = component({ ...props, worktreePrompt: prompt });
    nodes(tree, 'Button').find(n => n.props.children === (auto ? 'worktree.prompt.autoParallel' : 'worktree.prompt.isolate')).props.onClick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(calls.length, 1); assert.equal(calls[0][2], '中文展示');
    assert.equal(calls[0][3], '任务描述'); assert.equal(calls[0][4], 'fixed-preview'); assert.equal(calls[0][5], '任务'); assert.ok(prompt);
  }
});

test('actual Git creation initializes once per open, editable display and readonly preview submit separately', async () => {
  const h = harness(), slots = [], refs = []; let cursor = 0, refCursor = 0;
  const react = { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: value => { const i = refCursor++; return refs[i] ??= { current: value }; }, useMemo: fn => fn(), useCallback: fn => fn, useEffect() {} };
  const component = load('src/features/git/api/GitWorkspace.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../projects/api/worktreeStore': { ...h.api, useWorktreeStore: selector => selector(h.store) },
    './useGitTransportLease': { useGitTransportLease: () => ({ lease: { transport: { contextKey: 'repo' } } }) },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    sonner: { toast: { success() {}, error() {} } },
  }, dummyModule).GitWorkspace;
  const render = () => { cursor = 0; refCursor = 0; return component({ active: true, project: h.project, projectPath: h.project.path }); };
  let tree = render(); nodes(tree, 'GitRefTree')[0].props.onCreateWorktree(); tree = render();
  const preview = nodes(tree, 'input').find(n => n.props.readOnly), first = preview.props.value;
  const display = nodes(tree, 'input').find(n => n.props['aria-label'] === 'git.operation.worktreeDisplayName');
  assert.equal(display.props.value, first); assert.equal(preview.props.onChange, undefined);
  nodes(tree, 'WorktreeShortLabelField')[0].props.onChange('  é  ');
  display.props.onChange({ currentTarget: { value: 'Git 中文' } }); tree = render();
  nodes(tree, 'button').find(n => n.props.children === 'git.operation.confirm').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls[0].taskName, first); assert.equal(h.store.worktrees[0].display_name, 'Git 中文'); assert.equal(h.store.worktrees[0].short_label, 'é');
  tree = render(); nodes(tree, 'GitRefTree')[0].props.onCreateWorktree(); tree = render();
  assert.notEqual(nodes(tree, 'input').find(n => n.props.readOnly).props.value, first);
  h.sqlFail(true);
  const submit = nodes(tree, 'button').find(n => n.props.children === 'git.operation.confirm').props.onClick;
  await submit();
  await new Promise(resolve => setImmediate(resolve));
  const count = h.calls.length;
  assert.equal(nodes(render(), 'WorktreeShortLabelField').length, 0);
  h.sqlFail(false);
  await submit(); // stale callback must not create a second tree, even with an old Store
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, count);

});

test('all isolated launches prompt before creation, with stable names and initialization guards', async () => {
  const h = harness(), slots = [], refs = []; let cursor = 0, refCursor = 0, decision = 'prompt', createImpl, validateImpl, terminalImpl; const creations = [], errors = [];
  const react = { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: value => { const i = refCursor++; return refs[i] ??= { current: value }; }, useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {} };
  const projectState = { tree: [], projects: [], worktrees: [], groups: [], loaded: true, projectHealth: {}, providerBadges: {} };
  const terminalState = { sessions: [], activeSessionId: 's', createSession: async () => terminalImpl?.(), splitTerminal: async () => terminalImpl?.() };
  const settingState = { collapsedGroupIds: [], projectWorktreeConfigEnabled: true };
  const store = state => Object.assign(selector => selector(state), { getState: () => state });
  const component = load('src/features/projects/hooks/useSidebarController.tsx', {
    react, 'zustand/shallow': { useShallow: fn => fn },
    '../api/projectStore': { useProjectStore: store(projectState) },
    '../../terminal/state': { useTerminalStore: store(terminalState) },
    '../../../shared/preferences/settingsStore': { useSettingsStore: store(settingState) },
    '../api/worktreeStore': { ...h.api, useWorktreeStore: store({
      shouldIsolateNewSession: () => decision, validateProjectGit: async () => validateImpl ? validateImpl() : true,
      createWorktreeForProject: async (...args) => { creations.push(args); if (createImpl) return await createImpl(...args); return { id: 'w', status: 'active', name: 'result', path: 'D:/result' }; },
    }) },
    '../api/worktreeDepsRunner': { useWorktreeDepsRunnerStore: { getState: () => ({ start: async () => ({ started: false, reason: 'notNeeded' }) }) } },
    '../../files/api/fileExplorerStore': { useFileExplorerStore: store({}) },
    '../../history/index': { useHistoryStore: store({ closeHistory() {} }) },
    '../../history/api/externalSessionSyncStore': { useExternalSessionSyncStore: store({}) },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    '../../../shared/ui/useAppConfirm': { useAppConfirm: () => ({}) },
    './useSidebarLayout': { useSidebarLayout: () => ({}) },
    './usePinnedProjects': { usePinnedProjects: () => ({ pinnedProjects: [] }) },
    './useSidebarTerminals': { useSidebarTerminals: () => ({}) },
    './useProjectLocate': { useProjectLocate: () => ({}) },
    './useSidebarTreeDrag': { useSidebarTreeDrag: () => () => {} },
    '../lib/sidebarDeleteConfirmation': { createSidebarDeleteConfirmation: () => null },
    '../lib/sidebarTerminals': { summarizeProjectTerminalStates: () => new Map() },
    '../api/worktreeMetadata': { getWorktreeDisplayName: wt => wt.name },
    '../../terminal/api/terminalProject': { projectWithWorktreeProviderOverrides: project => project },
    '../../../shared/platform/logger': { logError: (...args) => errors.push(args) },
    '../lib/sidebarModel': { ALL_TERMINALS_SCOPE: { kind: 'all' }, buildProjectSplitOptions: () => ({}) },
    '../../terminal/api/terminalScope': { ALL_TERMINALS_SCOPE: { kind: 'all' } },
    sonner: { toast: { success() {}, error() {} } },
  }, dummyModule).useSidebarController;
  const render = () => { cursor = 0; refCursor = 0; return component({}); };
  let controller = render(); await controller.handleOpen(h.project); controller = render();
  const first = controller.worktreePrompt.taskName;
  assert.equal(controller.worktreePrompt.displayName, first);
  assert.equal(render().worktreePrompt.taskName, first);
  controller.setWorktreePrompt(value => ({ ...value, displayName: '中文' }));
  assert.equal(render().worktreePrompt.taskName, first);
  controller.setWorktreePrompt(null); await controller.handleOpen(h.project); controller = render();
  assert.notEqual(controller.worktreePrompt.taskName, first);
  controller.setWorktreePrompt(null); await controller.handleSplitProject(h.project, 'vertical'); controller = render();
  assert.equal(controller.worktreePrompt.direction, 'vertical');
  assert.equal(controller.worktreePrompt.displayName, controller.worktreePrompt.taskName);
  controller.setWorktreePrompt(null); decision = 'auto';
  await render().handleOpen(h.project);
  assert.ok(render().worktreePrompt);
  assert.equal(render().worktreePrompt.displayName, render().worktreePrompt.taskName);
  controller.setWorktreePrompt(null);
  await render().handleSplitProject(h.project, 'horizontal');
  assert.equal(render().worktreePrompt.direction, 'horizontal');
  assert.equal(creations.length, 0); // Auto/always decisions still require name confirmation.
  let release, validations = 0;
  validateImpl = () => { validations++; return new Promise(resolve => { release = resolve; }); };
  controller.setWorktreePrompt(null);
  const normal = render().handleOpen(h.project);
  const duplicateNormal = render().handleOpen(h.project);
  assert.equal(validations, 1);
  const releaseNormal = release;
  const split = render().handleSplitProject(h.project, 'horizontal');
  const duplicateSplit = render().handleSplitProject(h.project, 'horizontal');
  assert.equal(validations, 2); // Independent actions do not share initialization locks.
  releaseNormal(true); release(true);
  await Promise.all([normal, duplicateNormal, split, duplicateSplit]);
  assert.equal(creations.length, 0);
  validateImpl = () => { throw Error('validation failure'); };
  await assert.rejects(render().handleOpen(h.project), /validation failure/);
  await assert.rejects(render().handleSplitProject(h.project, 'horizontal'), /validation failure/);
  validateImpl = undefined;
  controller.setWorktreePrompt(null); await render().handleOpen(h.project);
  assert.ok(render().worktreePrompt);
  controller.setWorktreePrompt(null); await render().handleSplitProject(h.project, 'horizontal');
  assert.ok(render().worktreePrompt);
  // Actual prompt submissions carry user display text and fixed identity after confirmation.
  createImpl = () => { throw Error('Git/SQL creation failure'); };
  await render().createAndOpenWorktree(h.project, undefined, '中文', '', 'fixed');
  await render().createAndSplitWorktree(h.project, 'horizontal', '中文', '', 'fixed');
  assert.equal(errors.length, 2); assert.ok(render().worktreePrompt);
  createImpl = undefined;
  terminalImpl = () => { throw Error('terminal open failure'); };
  await render().createAndOpenWorktree(h.project, undefined, '中文', '', 'fixed');
  assert.equal(errors.length, 3);
  assert.equal(render().worktreePrompt, null);
  const afterTerminal = creations.length;
  terminalImpl = undefined;
  await render().createAndOpenWorktree(h.project, undefined, '中文', '', 'fixed');
  assert.equal(creations.length, afterTerminal);
  assert.equal(creations.at(-1)[1].taskName, 'fixed');
  assert.equal(creations.at(-1)[1].displayName, '中文');
  await render().createAndSplitWorktree(h.project, 'horizontal', '中文', '', 'fixed-split', ' é ');
  assert.equal(creations.at(-1)[1].shortLabel, 'é');
  const count = creations.length;
  await render().createAndOpenWorktree(h.project, undefined, '中文', '', 'fixed', 'W12');
  assert.equal(creations.length, count);

  // Actual normal/split callbacks: both current typed Store and legacy string failures
  // close the dialog and retain the same operation after stale/double submissions.
  for (const split of [false, true]) for (const phase of ['save', 'readback', 'refresh', 'terminal']) {
    const key = `${split}-${phase}`;
    let gitCalls = 0;
    createImpl = async () => {
      gitCalls++;
      if (phase !== 'terminal') throw Error(`worktree_record_${phase}_failed: internal; D:/existing; worktree_short_label_conflict`);
      return { id: 'saved', name: 'internal', path: 'D:/existing', branch: 'wt/internal' };
    };
    terminalImpl = () => { throw Error('terminal unavailable'); };
    controller.setWorktreePrompt({ project: h.project, taskName: key, displayName: 'keep' });
    const callback = split ? render().createAndSplitWorktree : render().createAndOpenWorktree;
    await callback(h.project, split ? 'horizontal' : undefined, 'keep', '', key);
    assert.equal(render().worktreePrompt, null);
    await callback(h.project, split ? 'horizontal' : undefined, 'changed alias', '', key, 'new');
    assert.equal(gitCalls, 1);
  }

});

test('actual Sidebar edit retains failed input and clears alias through fourth metadata parameter', async () => {
  const slots = []; let cursor = 0, fail = true; const calls = [];
  const component = load('src/features/projects/components/SidebarView.tsx', {
    react: { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../api/worktreeMetadata': { getWorktreeDisplayName: wt => wt.display_name },
    '../../providers/api/providerSwitching': { getProviderSwitchAppType: () => null },
  }, dummyModule).SidebarView;
  const worktree = { id: 'w', name: 'internal', display_name: 'Full name', short_label: 'alias', label_ordinal: 8, description: '' };
  const props = { projects: [], pinnedProjects: [], openProjectIds: new Set(), treeActions: {},
    selectedProjectIds: new Set(), selectedGroupIds: new Set(), selectedWorktreeIds: new Set(),
    sidebarToolbarVisibility: {}, t: key => key, contextMenu: { kind: 'worktree', worktree, project: {} },
    setContextMenu() {}, updateWorktreeMetadata: async (...args) => { calls.push(args); if (fail) throw Error('worktree_short_label_conflict'); } };
  const render = () => { cursor = 0; return component(props); };
  let tree = render(); nodes(tree, 'button').find(n => n.props.children?.includes?.('worktree.menu.rename')).props.onClick(); tree = render();
  let field = nodes(tree, 'WorktreeShortLabelField')[0]; assert.equal(field.props.value, 'alias'); assert.equal(field.props.defaultLabel, 'W8');
  field.props.onChange('new'); tree = render(); await nodes(tree, 'Button').find(n => n.props.children === 'common.save').props.onClick();
  // onClick starts async callback without returning it.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  tree = render(); assert.equal(nodes(tree, 'WorktreeShortLabelField')[0].props.value, 'new');
  assert.ok(nodes(tree, 'p').some(n => n.props.children === 'worktree.shortLabel.conflict'));
  fail = false; nodes(tree, 'WorktreeShortLabelField')[0].props.onChange(''); tree = render();
  nodes(tree, 'Button').find(n => n.props.children === 'common.save').props.onClick();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['w', 'Full name', '', '']);
});

test('actual Git edit submits alias separately, preserves conflict input, clears to default', async () => {
  const slots = []; let cursor = 0, fail = true; const calls = [];
  const wt = { id: 'w', project_id: 'p', name: 'internal', display_name: 'Full', description: '', short_label: 'alias', label_ordinal: 4 };
  const react = { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn, useEffect() {} };
  const component = load('src/features/git/api/GitWorkspace.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../projects/api/worktreeStore': { useWorktreeStore: selector => selector({ worktrees: [wt],
      updateWorktreeMetadata: async (...args) => { calls.push(args); if (fail) throw Error('worktree_short_label_conflict'); } }) },
    '../../projects/api/worktreeMetadata': { getWorktreeDisplayName: wt => wt.display_name },
    './useGitTransportLease': { useGitTransportLease: () => ({ lease: { transport: { contextKey: 'repo' } } }) },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    sonner: { toast: { success() {}, error() {} } },
  }, dummyModule).GitWorkspace;
  const render = () => { cursor = 0; return component({ active: true, project: { id: 'p' }, projectPath: 'repo' }); };
  let tree = render(); nodes(tree, 'GitRefTree')[0].props.onRenameWorktree(wt); tree = render();
  const field = nodes(tree, 'WorktreeShortLabelField')[0]; assert.equal(field.props.defaultLabel, 'W4'); assert.equal(field.props.value, 'alias');
  field.props.onChange(' e\u0301 '); tree = render(); nodes(tree, 'button').find(n => n.props.children === 'git.operation.confirm').props.onClick();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  tree = render(); assert.equal(nodes(tree, 'WorktreeShortLabelField')[0].props.value, ' e\u0301 ');
  assert.ok(nodes(tree, 'div').some(n => n.props.children === 'worktree.shortLabel.conflict'));
  assert.equal(calls[0][3], 'é'); fail = false;
  nodes(tree, 'WorktreeShortLabelField')[0].props.onChange(''); tree = render();
  nodes(tree, 'button').find(n => n.props.children === 'git.operation.confirm').props.onClick();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(calls.at(-1), ['w', 'Full', '', '']);
});

test('actual short label field exposes bilingual rules and all domain error keys', () => {
  const api = load('src/features/projects/components/WorktreeShortLabelField.tsx', {
    react: { useId: () => 'label' }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
  });
  for (const [value, code] of [['W001', 'reserved'], ['a'.repeat(13), 'too_long'], ['bad\u202e', 'invalid'], ['bad\n', 'invalid']]) {
    const tree = api.WorktreeShortLabelField({ value, onChange() {} });
    assert.equal(nodes(tree, 'input')[0].props['aria-invalid'], true);
    assert.equal(nodes(tree, 'p').at(-1).props.children, `worktree.shortLabel.${code}`);
  }
  for (const code of ['reserved', 'too_long', 'invalid', 'conflict']) {
    assert.equal(api.worktreeLabelErrorKey(Error(`wrapped: worktree_short_label_${code}`)), `worktree.shortLabel.${code}`);
  }
  assert.equal(api.worktreeLabelErrorKey('worktree_label_ordinal_exhausted'), 'worktree.shortLabel.exhausted');
  const outer = 'worktree_record_save_failed: internal; D:/created; worktree_short_label_conflict';
  assert.equal(api.worktreeLabelErrorKey(outer), null);
  const description = api.worktreeCreationErrorDescription(outer, key => key);
  assert.ok(description.includes(outer));
  assert.ok(description.includes('worktree.recovery.save'));
  assert.ok(description.includes('worktree.shortLabel.conflict'));

  for (const locale of ['en-US', 'zh-CN']) {
    const messages = readFileSync(`src/shared/i18n/messages/projects.${locale}.ts`, 'utf8');
    for (const code of ['reserved', 'too_long', 'invalid', 'conflict', 'exhausted', 'createHelp', 'editHelp']) assert.ok(messages.includes(`"worktree.shortLabel.${code}"`));
  }
});
