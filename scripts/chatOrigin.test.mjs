import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements, tick, deferred } from './chatHarness.mjs';

test('source tabs default workspace, filter and retain manual selection across conversation changes', async () => {
  const f = fixture(5);
  f.rows.get('c2').conversation.origin = 'sidebar';
  f.rows.get('c3').conversation.origin = 'quick-chat';
  await f.controller.start();
  const ui = hookHarness(f.controller); let tree = ui.render();
  const items = () => elements(tree).filter(n => n.props?.['data-chat-item']).map(n => n.props['data-chat-item']);
  const tab = source => elements(tree).find(n => n.props?.id === `chat-source-${source}`);
  assert.deepEqual(items(), ['c1', 'c4', 'c5']);
  assert.equal(elements(tree).filter(n => n.props?.role === 'tab').length, 3);
  tab('sidebar').props.onClick(); tree = ui.render();
  assert.deepEqual(items(), ['c2']);
  await f.controller.select('c3'); tree = ui.render();
  assert.deepEqual(items(), ['c2'], 'selection must not auto-follow origin');
  tab('workspace').props.onClick(); tree = ui.render();
  const drop = id => ({ preventDefault() {}, dataTransfer: { getData: () => id } });
  elements(tree).find(n => n.props?.['data-chat-item'] === 'c4').props.onDrop(drop('c3'));
  tree = ui.render(); assert.deepEqual(items(), ['c1', 'c4', 'c5']);
  elements(tree).find(n => n.props?.['data-chat-item'] === 'c4').props.onDrop(drop('c1'));
  tree = ui.render(); assert.deepEqual(items(), ['c4', 'c1', 'c5']);
  tab('quick-chat').props.onClick(); tree = ui.render(); assert.deepEqual(items(), ['c3']);
  tab('workspace').props.onClick(); tree = ui.render(); assert.deepEqual(items(), ['c4', 'c1', 'c5']);
  assert.equal(f.rows.get('c1').conversation.origin, 'workspace');
  assert.equal(f.rows.get('c3').conversation.origin, 'quick-chat');
  tree = ui.render(true, { historySource: 'sidebar' }); assert.deepEqual(items(), ['c2']);
  tree = ui.render(true, { historySource: 'quick-chat' }); assert.deepEqual(items(), ['c3']);
  const controls = ui.renderSelection(tree);
  elements(controls).find(n => n.type === 'button' && elements(n).some(x => x.props?.children === 'chat.new')).props.onClick();
  await tick(); tree = ui.render(); assert.equal(f.controller.getSnapshot().details[f.controller.getSnapshot().selected].conversation.origin, 'workspace');
  assert.equal(tab('workspace').props['aria-selected'], true);
  ui.cleanup();
});

test('bulk current deletion retains recovery anchor until unlock and batch replacement once', async () => {
  const f = fixture(3); await f.controller.start(); await f.controller.select('c2');
  const ui = hookHarness(f.controller); let tree = ui.render();
  const controls = () => elements(tree).find(node => typeof node.type === 'function' && node.type.name === 'HistorySelectionControls');
  const selection = controls().props.selection;
  const scope = JSON.stringify(['workspace', '']);
  selection.start(scope); selection.toggle(scope, 'c2', ['c1', 'c2', 'c3']);
  selection.open(scope, ['c1', 'c2', 'c3']);
  const pending = deferred();
  const remove = f.controller.remove.bind(f.controller);
  f.controller.remove = async id => { await pending.promise; return remove(id); };
  const confirmation = selection.confirm(scope, id => f.controller.remove(id));
  tree = ui.render(); await tick(); assert.equal(f.controller.getSnapshot().selected, 'c2');
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0, 'must not create during bulk lock');
  pending.resolve(); await tick(); await confirmation;
  assert.equal(f.controller.getSnapshot().selected, null);
  tree = ui.render(); await tick(); tree = ui.render();
  const snap = f.controller.getSnapshot();
  assert.ok(snap.selected && snap.details[snap.selected], JSON.stringify({ selected: snap.selected, calls: f.calls.map(call => call[0]), ids: snap.conversations.map(c => c.id) }));
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
  ui.cleanup();
});

test('failed selected deletion leaves the selected conversation unchanged', async () => {
  const f = fixture(2); await f.controller.start(); await f.controller.select('c1');
  const keepId = f.controller.getSnapshot().selected;
  const remove = f.controller.remove.bind(f.controller);
  f.controller.remove = async id => { if (id === keepId) throw new Error('delete failed'); return remove(id); };
  const ui = hookHarness(f.controller); let tree = ui.render();
  const controls = () => elements(tree).find(node => typeof node.type === 'function' && node.type.name === 'HistorySelectionControls');
  const selection = controls().props.selection;
  const scope = JSON.stringify(['workspace', '']);
  selection.start(scope); selection.toggle(scope, keepId, ['c1', 'c2']);
  selection.open(scope, ['c1', 'c2']);
  await selection.confirm(scope, id => f.controller.remove(id));
  await tick();
  assert.equal(f.controller.getSnapshot().selected, keepId);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
  ui.cleanup();
});

test('deleting the selected chat restores an editable same-source conversation', async () => {
  const f = fixture(3); await f.controller.start();
  const deletedId = f.controller.getSnapshot().selected;
  const origin = f.controller.getSnapshot().details[deletedId].conversation.origin;
  const ui = hookHarness(f.controller);
  ui.render();
  await f.controller.remove(deletedId);
  let tree = ui.render();
  await tick(); tree = ui.render();
  const selected = f.controller.getSnapshot().selected;
  assert.ok(selected, 'composer must not fall back to the empty state');
  assert.notEqual(selected, deletedId);
  assert.equal(f.controller.getSnapshot().details[selected].conversation.origin, origin);
  ui.cleanup();
});

test('deleting the last selected chat creates one same-source replacement; failure does not switch', async () => {
  const f = fixture(1); await f.controller.start();
  const deletedId = f.controller.getSnapshot().selected;
  const ui = hookHarness(f.controller); ui.render();
  await f.controller.remove(deletedId);
  ui.render(); await tick(); ui.render();
  let selected = f.controller.getSnapshot().selected;
  assert.ok(selected);
  assert.equal(f.controller.getSnapshot().details[selected].conversation.origin, 'workspace');
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);

  const failing = fixture(2); await failing.controller.start();
  const keepId = failing.controller.getSnapshot().selected;
  const failedUi = hookHarness(failing.controller); failedUi.render();
  const remove = failing.controller.remove.bind(failing.controller);
  failing.controller.remove = async () => { throw 'chat_storage'; };
  await assert.rejects(failing.controller.remove(keepId));
  failedUi.render(); await tick(); failedUi.render();
  assert.equal(failing.controller.getSnapshot().selected, keepId);
  assert.equal(failing.calls.filter(call => call[0] === 'create').length, 0);
  failing.controller.remove = remove;
  ui.cleanup(); failedUi.cleanup();
});

test('tabs support roving keyboard focus, empty labels, search, and source-local pinned order', async () => {
  const f = fixture(4); f.rows.get('c2').conversation.origin = 'sidebar';
  f.rows.get('c1').conversation.title = 'needle';
  f.rows.get('c4').conversation.title = 'needle';
  await f.controller.start();
  const ui = hookHarness(f.controller); let tree = ui.render();
  const tabs = () => elements(tree).filter(n => n.props?.role === 'tab');
  const ids = () => elements(tree).filter(n => n.props?.['data-chat-item']).map(n => n.props['data-chat-item']);
  let focused = -1, prevented = false;
  tabs()[0].props.onKeyDown({ key: 'End', preventDefault() { prevented = true; }, currentTarget: {
    parentElement: { querySelectorAll: () => [0, 1, 2].map(i => ({ focus() { focused = i; } })) },
  } });
  tree = ui.render(); assert.equal(prevented, true); assert.equal(focused, 2);
  assert.equal(tabs()[2].props.tabIndex, 0); assert.deepEqual(ids(), []);
  assert.ok(elements(tree).some(n => n.props?.children === 'chat.historyEmpty.quick-chat'));
  tabs()[0].props.onClick(); tree = ui.render();
  const c4 = elements(tree).find(n => n.props?.['data-chat-item'] === 'c4');
  c4.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 });
  tree = ui.render();
  elements(tree).find(n => n.type === 'button' && [n.props.children].flat(Infinity).includes('chat.pin')).props.onClick();
  tree = ui.render(); assert.deepEqual(ids(), ['c4', 'c1', 'c3']);
  tabs()[1].props.onClick(); tree = ui.render(); assert.deepEqual(ids(), ['c2']);
  await f.controller.loadHistory('needle'); tree = ui.render(); assert.deepEqual(ids(), []);
  tabs()[0].props.onClick(); tree = ui.render(); assert.deepEqual(ids(), ['c4', 'c1']);
  assert.equal(f.controller.getSnapshot().search, 'needle');
  assert.equal(f.calls.some(c => c[0] === 'update' && 'origin' in c[1]), false);
  ui.cleanup();
});

test('entire pinned historical SQL equals Git HEAD, not just a normalized prefix', async () => {
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  for (const [module, sql] of [
    ['src-tauri/src/features/chat/schema_bytes.rs', 'src-tauri/src/features/chat/schema.sql'],
    ['src-tauri/src/features/translator/history/history_bytes.rs', 'src-tauri/src/features/translator/history.sql'],
  ]) {
    const source = readFileSync(module, 'utf8');
    const pinned = Buffer.from([...source.matchAll(/^\s*(".*"),?\r?$/gm)].map(match => JSON.parse(match[1])).join(''));
    const historical = execFileSync('git', ['show', `HEAD:${sql}`]);
    assert.deepEqual(pinned, historical, module);
  }
  const source = readFileSync('src-tauri/src/features/chat/mod.rs', 'utf8');
  const origin = JSON.parse(source.match(/ORIGIN_MIGRATION: &str = (".*");/)[1]);
  assert.equal(origin, readFileSync('src-tauri/src/features/chat/origin.sql', 'utf8').replaceAll('\r\n', '\n'));
});
