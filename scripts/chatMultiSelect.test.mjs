import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, load, hookHarness, elements, deferred, tick } from './chatHarness.mjs';
const { HistorySelection } = load('src/features/chat/lib/historySelection.ts');
const ids = value => Array.from(value);
const find = (tree, predicate) => elements(tree).find(predicate);
const button = (tree, key) => find(tree, n => n.type === 'button' && (n.props['aria-label'] === `chat.${key}` || n.props.children === `chat.${key}`));
const controls = (h, tree) => h.renderSelection(tree);
const row = (tree, id) => find(tree, n => n.props?.['data-chat-selection'] === id);
const checkbox = (tree, id) => find(row(tree, id), n => n.type === 'input');

test('selection bounds, cancel without mutation, immutable capture, duplicate confirm, partial outcomes and scope races', async () => {
  const s = new HistorySelection(), scope = 'workspace/search', gate = deferred(), calls = [];
  s.start(scope); s.toggle(scope, 'hidden', ['a']); assert.equal(s.getSnapshot().ids.length, 0);
  s.selectAll(scope, ['a', 'a', 'b']); s.open(scope, ['a', 'b']); s.close();
  assert.equal(await s.confirm(scope, async id => calls.push(id)), null); assert.deepEqual(calls, []);
  s.open(scope, ['a', 'b']);
  assert.equal(Object.isFrozen(s.getSnapshot().confirmation), true);
  s.selectAll(scope, ['extra']);
  const pending = s.confirm(scope, async id => { calls.push(id); await gate.promise; if (id === 'b') throw 'chat_storage'; });
  s.cancel(); s.close(); s.toggle(scope, 'extra', ['extra']);
  assert.equal(s.getSnapshot().busy, true);
  assert.equal(await s.confirm(scope, async () => assert.fail('duplicate')), null);
  gate.resolve(); const result = await pending;
  assert.deepEqual(calls, ['a', 'b']); assert.deepEqual(ids(result.succeeded), ['a']);
  assert.deepEqual(ids(s.getSnapshot().ids), ['b']); assert.equal(result.failed[0].error, 'chat_storage');
  s.open(scope, ['b']); const late = deferred(); const next = s.confirm(scope, () => late.promise);
  s.resetScope('sidebar'); s.start('sidebar'); assert.equal(s.getSnapshot().enabled, false);
  late.reject('chat_conflict'); await next;
  assert.equal(s.getSnapshot().result, null); assert.equal(s.getSnapshot().ids.length, 0);
});

test('render wiring: loaded source+search only, native checkbox, no row navigation/drag, cancel and unselect', async () => {
  const f = fixture(4); f.rows.get('c2').conversation.origin = 'sidebar';
  f.rows.get('c3').conversation.title = 'different'; f.rows.get('c1').conversation.title = 'match';
  f.rows.get('c4').conversation.title = 'match'; await f.controller.start();
  const h = hookHarness(f.controller); let tree = h.render();
  const search = find(tree, n => n.props?.type === 'search');
  search.props.onChange({ target: { value: 'match' } }); await tick(); tree = h.render();
  button(controls(h, tree), 'selectChats').props.onClick(); tree = h.render(); tree = h.render();
  assert.deepEqual(elements(tree).filter(n => n.props?.['data-chat-selection']).map(n => n.props['data-chat-selection']), ['c1', 'c4']);
  assert.equal(row(tree, 'c1').type, 'label'); assert.equal(row(tree, 'c1').props.onClick, undefined);
  assert.equal(row(tree, 'c1').props.onPointerDown, undefined); assert.equal(checkbox(tree, 'c1').props.type, 'checkbox');
  button(controls(h, tree), 'selectLoaded').props.onClick(); tree = h.render();
  assert.equal(checkbox(tree, 'c1').props.checked, true);
  button(controls(h, tree), 'clearSelection').props.onClick(); tree = h.render(); assert.equal(checkbox(tree, 'c1').props.checked, false);
  checkbox(tree, 'c1').props.onChange(); tree = h.render();
  button(controls(h, tree), 'deleteSelected').props.onClick(); tree = h.render();
  button(controls(h, tree), 'cancel').props.onClick(); tree = h.render();
  assert.equal(f.calls.some(c => c[0] === 'delete'), false);
  button(controls(h, tree), 'cancelSelection').props.onClick(); tree = h.render();
  assert.equal(row(tree, 'c1'), undefined); assert.equal(find(tree, n => n.props?.['data-chat-item'] === 'c1').type, 'button');
  h.cleanup();
});

test('wiring freezes confirmation, locks search/tabs, no extra targets; retains localized partial failure', async () => {
  const f = fixture(3); await f.controller.start(); const h = hookHarness(f.controller);
  let tree = h.render(); button(controls(h, tree), 'selectChats').props.onClick(); tree = h.render(); tree = h.render();
  checkbox(tree, 'c1').props.onChange(); checkbox(tree, 'c2').props.onChange(); tree = h.render();
  button(controls(h, tree), 'deleteSelected').props.onClick(); tree = h.render();
  const gate = deferred(), original = f.api.delete;
  f.api.delete = async (id, revision) => { await gate.promise; if (id === 'c2') throw 'chat_storage'; return original(id, revision); };
  const confirm = button(controls(h, tree), 'confirm'); confirm.props.onClick(); confirm.props.onClick();
  tree = h.render(); assert.equal(find(tree, n => n.props?.type === 'search').props.disabled, true);
  const tab = find(tree, n => n.props?.role === 'tab' && n.props.id === 'chat-source-sidebar');
  assert.equal(tab.props.disabled, true); tab.props.onClick();
  assert.equal(checkbox(tree, 'c3').props.disabled, true); checkbox(tree, 'c3').props.onChange();
  gate.resolve(); await tick(); tree = h.render(); tree = h.render();
  assert.deepEqual(f.calls.filter(c => c[0] === 'delete').map(c => c[1]), ['c1']);
  assert.equal(f.rows.has('c3'), true); assert.equal(checkbox(tree, 'c2').props.checked, true);
  assert.equal(checkbox(tree, 'c3').props.checked, false);
  const alert = find(controls(h, tree), n => n.props?.role === 'alert');
  assert.ok(alert); assert.ok(elements(alert).some(n => n.type === 'li' && n.props.children.includes('Saving failed. Retry saving.')));
  h.cleanup();
});

test('source/search resets including externally controlled scope cannot delete old invisible selection', async () => {
  const f = fixture(2); await f.controller.start(); const h = hookHarness(f.controller);
  let tree = h.render(); button(controls(h, tree), 'selectChats').props.onClick(); tree = h.render(); tree = h.render();
  checkbox(tree, 'c1').props.onChange(); tree = h.render();
  find(tree, n => n.props?.role === 'tab' && n.props.id === 'chat-source-sidebar').props.onClick();
  tree = h.render(); assert.ok(button(controls(h, tree), 'selectChats'));
  tree = h.render(true, { historySource: 'workspace' }); button(controls(h, tree), 'selectChats').props.onClick();
  tree = h.render(true, { historySource: 'workspace' }); tree = h.render(true, { historySource: 'workspace' });
  checkbox(tree, 'c1').props.onChange(); tree = h.render(true, { historySource: 'workspace' });
  button(controls(h, tree), 'deleteSelected').props.onClick(); tree = h.render(true, { historySource: 'workspace' });
  const stale = button(controls(h, tree), 'confirm'); h.render(true, { historySource: 'sidebar' });
  stale.props.onClick(); await tick(); assert.equal(f.calls.some(c => c[0] === 'delete'), false);
  tree = h.render(true, { historySource: 'workspace' }); button(controls(h, tree), 'selectChats').props.onClick();
  tree = h.render(true, { historySource: 'workspace' }); tree = h.render(true, { historySource: 'workspace' });
  checkbox(tree, 'c1').props.onChange();
  find(tree, n => n.props?.type === 'search').props.onChange({ target: { value: 'other' } });
  await tick(); tree = h.render(true, { historySource: 'workspace' }); assert.ok(button(controls(h, tree), 'selectChats'));
  h.cleanup();
});

test('bulk uses actual remove stop/revision cleanup; late terminal never resurrects, unknown missing fails', async () => {
  const f = fixture(3); await f.controller.start(); f.controller.setDraft('c1', 'hello'); await f.controller.generate('c1');
  f.emit('r1', { sequence: 2, status: 'completed', saved: true }); await tick();
  f.controller.setDraft('c1', 'dirty next question');
  const s = new HistorySelection(); s.start('s'); s.selectAll('s', ['c1', 'c2']); s.open('s', ['c1', 'c2']);
  const result = await s.confirm('s', id => f.controller.remove(id)); await tick();
  assert.deepEqual(ids(result.succeeded), ['c1', 'c2']);
  assert.equal(f.calls.filter(c => c[0] === 'cancel').length, 0);
  const snap = f.controller.getSnapshot();
  for (const name of ['details', 'drafts', 'draftStatus', 'unsaved']) assert.equal(snap[name].c1, undefined);
  for (const name of ['running', 'dirty', 'busy']) assert.equal(snap[name].includes('c1'), false);
  f.emit('r1', { sequence: 99, status: 'completed', saved: false }); await tick();
  assert.equal(f.controller.getSnapshot().details.c1, undefined); assert.equal(f.rows.has('c3'), true);
  s.start('s'); s.selectAll('s', ['c3']); s.open('s', ['c3']); f.rows.delete('c3');
  const missing = await s.confirm('s', id => f.controller.remove(id));
  assert.equal(missing.failed[0].error, 'chat_not_found'); assert.equal(missing.succeeded.length, 0);
});

test('stopped terminal refresh racing remove neither reports missing after success nor swallows cancellation failure', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setDraft('c1', 'hi'); await f.controller.generate('c1');
  f.emit('r1', { sequence: 2, status: 'stopped', saved: true });
  await f.controller.remove('c1'); await tick(); assert.equal(f.controller.getSnapshot().error, null);
  await f.controller.select('c2'); f.controller.setDraft('c2', 'hi'); await f.controller.generate('c2');
  f.api.cancel = async () => { throw 'chat_storage'; };
  await assert.rejects(f.controller.remove('c2'), error => error === 'chat_storage');
  assert.equal(f.rows.has('c2'), true);
});

test('bulk deleting current quick chat recovers one independent replacement without expanding captured targets', async () => {
  const f = fixture(); await f.controller.start();
  let channel; const publications = [];
  const contract = load('src/features/chat/lib/panelController.ts');
  class Channel { constructor() { channel = this; } }
  const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
    '@tauri-apps/api/core': { Channel, invoke: async (name, args) => { if (name === 'quick_chat_publish') publications.push(args); } },
    './lifecycle': { chatController: f.controller }, '../lib/panelController': contract,
    '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => [] },
    '../../../shared/preferences/settingsStore': { useSettingsStore: {
      getState: () => ({ language: 'en-US', resolvedTheme: 'dark' }), subscribe: () => () => {},
    } },
    '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
  }, { crypto: { randomUUID: () => 'epoch' } });
  await startQuickChatOwner(() => {});
  channel.onmessage({ id: 'hello', command: { op: 'hello' } }); await tick();
  const quickId = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
  const s = new HistorySelection(); s.start('quick'); s.selectAll('quick', [quickId]); s.open('quick', [quickId]);
  const result = await s.confirm('quick', id => f.controller.remove(id)); await tick();
  channel.onmessage({ id: 'again', command: { op: 'hello' } }); await tick();
  const recovered = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
  assert.notEqual(recovered, quickId); assert.equal(f.rows.has(recovered), true);
  assert.deepEqual(ids(result.succeeded), [quickId]);
  assert.deepEqual(f.calls.filter(c => c[0] === 'delete').map(c => c[1]), [quickId]);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 2);
  assert.equal(f.controller.getSnapshot().selected, 'c1');
});

test('dialog accessibility wiring and bilingual counters/warnings cover empty selection and frozen target count', async () => {
  const f = fixture(); await f.controller.start(); const h = hookHarness(f.controller);
  let tree = h.render(); button(controls(h, tree), 'selectChats').props.onClick(); tree = h.render(); tree = h.render();
  assert.equal(button(controls(h, tree), 'deleteSelected').props.disabled, true);
  assert.ok(checkbox(tree, 'c1').props['aria-label']);
  checkbox(tree, 'c1').props.onChange(); tree = h.render(); button(controls(h, tree), 'deleteSelected').props.onClick(); tree = h.render();
  const rendered = controls(h, tree), content = find(rendered, n => n.type === 'DialogContent');
  assert.equal(find(rendered, n => n.type === 'Dialog').props.open, true);
  assert.equal(find(rendered, n => n.type === 'DialogDescription').props.children, 'chat.confirmBulkDelete');
  assert.equal(button(rendered, 'cancel').props.autoFocus, true);
  let prevented = false; content.props.onPointerDownOutside({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  assert.equal(typeof content.props.onCloseAutoFocus, 'function');
  const en = load('src/shared/i18n/messages/chat.en-US.ts').en, zh = load('src/shared/i18n/messages/chat.zh-CN.ts').zh;
  for (const key of ['selectChats', 'cancelSelection', 'selectChat', 'selectedCount', 'selectLoaded', 'clearSelection',
    'deleteSelected', 'confirmBulkDelete', 'deletingSelected', 'deletedCount', 'deleteFailedCount']) {
    assert.ok(en[`chat.${key}`]); assert.ok(zh[`chat.${key}`]);
  }
  for (const locale of [en, zh]) for (const key of ['selectedCount', 'confirmBulkDelete', 'deletedCount', 'deleteFailedCount']) {
    assert.ok(locale[`chat.${key}`].includes('{count}'));
  }
  assert.match(en['chat.confirmBulkDelete'], /cannot be undone/); assert.match(zh['chat.confirmBulkDelete'], /不可撤销/);
  h.cleanup();
});

test('partial revision failure retries only failed ID using fresh revision, without replaying successful deletes', async () => {
  const f = fixture(); await f.controller.start(); const s = new HistorySelection();
  const original = f.api.delete; let fail = true; const attempts = [];
  f.api.delete = async (id, revision) => {
    attempts.push([id, revision]);
    if (id === 'c2' && fail) { f.rows.get(id).conversation.revision++; throw 'chat_conflict'; }
    await original(id, revision);
  };
  s.start('s'); s.selectAll('s', ['c1', 'c2']); s.open('s', ['c1', 'c2']);
  const first = await s.confirm('s', id => f.controller.remove(id));
  assert.equal(first.failed[0].error, 'chat_conflict'); assert.deepEqual(ids(s.getSnapshot().ids), ['c2']);
  fail = false; s.open('s', ['c2']); const second = await s.confirm('s', id => f.controller.remove(id));
  assert.deepEqual(attempts, [['c1', 0], ['c2', 0], ['c2', 1]]);
  assert.deepEqual(ids(second.succeeded), ['c2']); assert.equal(s.getSnapshot().ids.length, 0);
});

test('terminal persistence failure does not block deletion after runtime termination', async () => {
  const f = fixture(); await f.controller.start();
  f.controller.setDraft('c1', 'hi'); await f.controller.generate('c1');
  f.emit('r1', { sequence: 3, content: 'final answer', status: 'stopped', saved: false, errorCode: 'chat_storage' });
  await tick();
  const deleting = await f.controller.remove('c1');
  assert.equal(deleting, undefined);
  assert.equal(f.calls.filter(c => c[0] === 'delete').length, 1);
  assert.equal(f.controller.getSnapshot().details.c1, undefined);
});

test('compact selection lives in existing header row, has localized icon controls and no blank result row', async () => {
  const f = fixture(); await f.controller.start(); const h = hookHarness(f.controller);
  let tree = h.render();
  const head = find(tree, n => n.props?.className === 'chat-history-head');
  assert.ok(find(head, n => n.type?.name === 'HistorySelectionControls'));
  assert.equal(elements(tree).filter(n => n.type?.name === 'HistorySelectionControls').length, 1);
  let rendered = controls(h, tree);
  const actions = find(rendered, n => n.props?.className === 'chat-history-actions');
  assert.ok(find(actions, n => n.props?.className === 'chat-new-btn'));
  assert.equal(find(rendered, n => n.props?.className === 'chat-history-selection-result'), undefined);
  const enter = button(rendered, 'selectChats');
  assert.equal(enter.props.title, 'chat.selectChats'); assert.equal(enter.props['aria-pressed'], false);
  assert.equal(enter.props.children.props['aria-hidden'], 'true');
  enter.props.onClick(); tree = h.render(); tree = h.render(); rendered = controls(h, tree);
  assert.equal(find(rendered, n => n.props?.className === 'chat-new-btn'), undefined);
  for (const key of ['selectLoaded', 'clearSelection', 'deleteSelected', 'cancelSelection']) {
    const action = button(rendered, key);
    assert.equal(action.props.title, `chat.${key}`);
    assert.equal(action.props.children.props['aria-hidden'], 'true');
  }
  assert.equal(elements(find(rendered, n => n.props?.role === 'group')).filter(n => n.type === 'button').length, 4);
  assert.equal(find(rendered, n => n.props?.className === 'chat-history-selection-count').props.children, 0);
  assert.equal(checkbox(tree, 'c1').props.type, 'checkbox');
  assert.equal(row(tree, 'c1').props['data-selected'], false);
  checkbox(tree, 'c1').props.onChange(); tree = h.render();
  assert.equal(row(tree, 'c1').props['data-selected'], true);
  button(controls(h, tree), 'deleteSelected').props.onClick(); tree = h.render(); rendered = controls(h, tree);
  assert.equal(button(rendered, 'cancelSelection').props.disabled, true);
  const trigger = button(rendered, 'cancelSelection'); let focused = 0, prevented = 0;
  trigger.props.ref.current = { focus() { focused++; } };
  find(rendered, n => n.type === 'DialogContent').props.onCloseAutoFocus({ preventDefault() { prevented++; } });
  assert.equal(focused, 1); assert.equal(prevented, 1);
  const css = readFileSync('src/features/chat/components/chatWorkspace.css', 'utf8');
  assert.match(css, /\.chat-history-selection\s*\{[^}]*flex-wrap: nowrap/);
  assert.match(css, /\.chat-history-selectable input\s*\{[^}]*appearance: none[^}]*border-radius: 50%[^}]*background: transparent/s);
  assert.match(css, /input:checked::after\s*\{\s*visibility: visible/);
  assert.match(css, /input:focus-visible/); assert.match(css, /input:disabled/);
  h.cleanup();
});
