import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements } from './chatHarness.mjs';

test('draft status is scoped per conversation and typing starts as debouncing', async () => {
  const f = fixture(); await f.controller.start();
  f.controller.setDraft('c1', 'local');
  assert.equal(f.controller.getSnapshot().draftStatus.c1, 'debouncing');
  assert.equal(f.controller.getSnapshot().draftStatus.c2, undefined);
  await f.controller.flushDraft('c1');
  assert.equal(f.controller.getSnapshot().draftStatus.c1, 'clean');
});

test('Pi discovery is safe empty contract without documented config', async () => {
  const source = await (await import('node:fs/promises')).readFile('src/features/chat/lib/piDiscovery.ts', 'utf8');
  assert.match(source, /return \[\];/);
  assert.match(source, /unavailable-no-documented-safe-config/);
});

test('layout contract has a drawer toggle and no third rail', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile('src/features/chat/components/chatWorkspace.css', 'utf8');
  const ui = await fs.readFile('src/features/chat/api/ChatWorkspace.tsx', 'utf8');
  assert.match(css, /width: clamp\(220px, 23vw, 300px\)/);
  assert.match(css, /chat-history-open/);
  assert.match(ui, /aria-controls=\"chat-history\"/);
  assert.doesNotMatch(css, /third-rail/i);
});

test('conversation list supports drag reorder and persists the new order', async () => {
  const f = fixture(3);
  f.rows.get('c1').conversation.title = 'Alpha';
  f.rows.get('c2').conversation.title = 'Beta';
  f.rows.get('c3').conversation.title = 'Gamma';
  await f.controller.start();
  await f.controller.loadHistory('');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  const items = () => elements(tree).filter(n => n.type === 'button' && typeof n.props?.className === 'string' && n.props.className.includes('chat-history-item'));
  const titleOf = (node) => elements(node).find(c => c.props?.className === 'chat-history-item-title')?.props?.children?.at(-1)?.props?.children;
  const ids = () => items().map(titleOf);
  const before = ids();
  assert.equal(before.length, 3);

  const dragged = items()[2];
  const target = items()[0];
  const data = { store: {}, setData(k, v) { this.store[k] = v; }, getData(k) { return this.store[k]; }, effectAllowed: '' };
  dragged.props.onDragStart({ dataTransfer: data });
  tree = ui.render();
  items()[0].props.onDrop({ preventDefault() {}, dataTransfer: data });
  tree = ui.render();

  const after = ids();
  assert.equal(after[0], before[2]);
  assert.notEqual(after[0], before[0]);
  const persisted = JSON.parse(ui.storage.get('cli-manager.chat.conversationOrder'));
  assert.deepEqual(persisted, ['c3', 'c1', 'c2']);
  assert.equal(after[0], 'Gamma');
  ui.cleanup();
});

test('history sidebar can collapse and reopen without unmounting the conversation', async () => {
  const f = fixture(1);
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  const control = () => elements(tree).find(n => n.props?.className?.includes?.('chat-history-control'));
  assert.equal(control().props['aria-expanded'], true);
  control().props.onClick();
  tree = ui.render();
  assert.equal(control().props['aria-expanded'], false);
  assert.equal(elements(tree).find(n => n.type === 'aside' && n.props.id === 'chat-history').props.inert, true);
  assert.ok(elements(tree).some(n => n.props?.className === 'chat-messages'));
  control().props.onClick();
  tree = ui.render();
  assert.equal(control().props['aria-expanded'], true);
  ui.cleanup();
});

test('pin and unpin via context menu persists and visibly marks pinned chats', async () => {
  const f = fixture(3);
  for (const [id, label] of [['c1', 'Alpha'], ['c2', 'Beta'], ['c3', 'Gamma']]) {
    f.rows.get(id).conversation.title = label;
  }
  await f.controller.start();
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  const rows = () => elements(tree).filter(n => n.type === 'button' && n.props?.className?.includes?.('chat-history-item'));
  const titles = () => rows().map(n => elements(n).find(c => c.props?.className === 'chat-history-item-title')?.props?.children?.at(-1)?.props?.children);
  rows()[1].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 40, clientY: 40 });
  tree = ui.render();
  elements(tree).find(n => n.props?.className === 'chat-context-menu-item' && n.props.children?.at?.(-1) === 'chat.pin').props.onClick();
  tree = ui.render();
  assert.equal(titles()[0], 'Beta');
  assert.equal(elements(rows()[0]).some(n => n.props?.className === 'chat-pinned-icon'), true);
  assert.deepEqual(JSON.parse(ui.storage.get('cli-manager.chat.pinnedConversations')), ['c2']);
  rows()[0].props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 40, clientY: 40 });
  tree = ui.render();
  elements(tree).find(n => n.props?.className === 'chat-context-menu-item' && n.props.children?.at?.(-1) === 'chat.unpin').props.onClick();
  tree = ui.render();
  assert.equal(elements(rows()[0]).some(n => n.props?.className === 'chat-pinned-icon'), false);
  assert.deepEqual(JSON.parse(ui.storage.get('cli-manager.chat.pinnedConversations')), []);
  ui.cleanup();
});
