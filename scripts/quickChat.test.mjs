import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, fixture, tick, deferred } from './chatHarness.mjs';
const contract = load('src/features/chat/lib/panelController.ts');

test('selected snapshot excludes other message histories, drafts and provider options', async () => {
  const f = fixture(); await f.controller.start(); await f.controller.select('c2');
  f.controller.setDraft('c1', 'private other draft');
  const state = contract.selectedSnapshot(f.controller.getSnapshot());
  assert.deepEqual(Object.keys(state.details), ['c2']);
  assert.deepEqual(Object.keys(state.drafts), ['c2']);
  assert.equal(state.conversations.find(c => c.id === 'c1').draft, '');
  assert.equal(state.providers.length, 0);
});
test('panel surface never creates a conversation implicitly', () => {
  const surface = readFileSync('src/features/chat/components/ChatPanelSurface.tsx', 'utf8');
  assert.doesNotMatch(surface, /if \(!state\.ready \|\| selected\) return;/);
  assert.match(surface, /chat\.panel\.noSelection/);
  const zh = readFileSync('src/shared/i18n/messages/chat.zh-CN.ts', 'utf8');
  const en = readFileSync('src/shared/i18n/messages/chat.en-US.ts', 'utf8');
  assert.match(zh, /"chat\.panel\.noSelection"/);
  assert.match(en, /"chat\.panel\.noSelection"/);
});
test('command ledger deduplicates pending, completed and failed IDs without replaying requests', async () => {
  const ledger = new contract.CommandLedger(); let calls = 0;
  const command = { id: 'unique', command: { op: 'generate' } };
  const action = async () => { calls++; };
  const a = ledger.run(command, action), b = ledger.run(command, action);
  assert.equal(a, b); await a; await ledger.run(command, action); assert.equal(calls, 1);
  const failed = { id: 'failed', command: { op: 'create' } };
  const result = await ledger.run(failed, async () => { calls++; throw Error('credential must never leak'); });
  assert.equal(result.error, 'chat_quick_command_failed');
  await ledger.run(failed, action); assert.equal(calls, 2);
});
test('command ledger window is bounded and expired sequence numbers fail closed', async () => {
  const ledger = new contract.CommandLedger();
  let calls = 0;
  const action = async () => { calls++; };
  for (let seq = 1; seq <= contract.COMMAND_LEDGER_WINDOW + 40; seq++) {
    await ledger.run({ id: `id-${seq}`, seq, command: { op: 'create' } }, action);
  }
  assert.equal(calls, contract.COMMAND_LEDGER_WINDOW + 40);
  // Evicted ID at or below the watermark must be rejected, never re-executed.
  const stale = await ledger.run({ id: 'id-1', seq: 1, command: { op: 'generate' } }, action);
  assert.equal(stale.error, 'chat_quick_capacity');
  assert.equal(calls, contract.COMMAND_LEDGER_WINDOW + 40);
  // Recent IDs still dedupe exactly.
  const recent = { id: 'recent', seq: contract.COMMAND_LEDGER_WINDOW + 41, command: { op: 'create' } };
  const first = ledger.run(recent, action); const again = ledger.run(recent, action);
  assert.equal(first, again); await first;
  assert.equal(calls, contract.COMMAND_LEDGER_WINDOW + 41);
  // Envelopes without seq neither advance nor are rejected by the watermark.
  await ledger.run({ id: 'no-seq', command: { op: 'create' } }, action);
  assert.equal(calls, contract.COMMAND_LEDGER_WINDOW + 42);
});
function remoteFixture() {
  let channel; const sent = []; const ackQueue = [];
  class Channel { constructor() { channel = this; } }
  const invoke = async (name, args) => {
    if (name === 'quick_chat_command') {
      sent.push(args.envelope);
      if (args.envelope.command.op === 'hello') channel.onmessage({ kind: 'ack', payload: { id: args.envelope.id, error: null } });
      else ackQueue.push(args.envelope.id);
    }
  };
  let id = 0;
  const { QuickChatRemote } = load('src/features/chat/lib/quickChatRemote.ts', { '@tauri-apps/api/core': { Channel, invoke } }, { crypto: { randomUUID: () => `id-${++id}` } });
  return { remote: new QuickChatRemote(), sent, ack: () => channel.onmessage({ kind: 'ack', payload: { id: ackQueue.shift(), error: null } }) };
}
test('remote rejects old snapshots and waits for authoritative draft ack before generation', async () => {
  const f = remoteFixture(); await f.remote.start();
  const state = { ready: true, selected: 'c1', drafts: {}, details: { c1: {} }, conversations: [{ id: 'c1' }] };
  f.remote.accept({ epoch: "owner1", version: 2, state, catalog: [] });
  f.remote.accept({ epoch: "owner1", version: 1, state: { ...state, ready: false }, catalog: [] });
  assert.equal(f.remote.getSnapshot().ready, true);
  f.remote.accept({ epoch: 'owner2', version: 1, state, catalog: [] });
  f.remote.accept({ epoch: 'owner1', version: 99, state: { ...state, ready: false }, catalog: [] });
  assert.equal(f.remote.getSnapshot().ready, true);
  f.remote.setDraft('c1', 'question');
  f.remote.accept({ epoch: 'owner2', version: 2, state: { ...state, drafts: { c1: 'stale' } }, catalog: [] });
  assert.equal(f.remote.getSnapshot().drafts.c1, 'question');
  const generating = f.remote.generate('c1', false, 'high', ['data:image/png;base64,a']);
  assert.equal(generating, f.remote.generate('c1'), 'rapid send shares one mutation intent');
  await tick(); assert.equal(f.sent.filter(x => x.command.op === 'generate').length, 0);
  f.ack(); await tick();
  const sent = f.sent.find(x => x.command.op === 'generate');
  assert.equal(sent.command.reasoning, 'high'); assert.equal(sent.command.images.length, 1);
  f.ack(); await generating;
  const create = f.remote.create(); assert.equal(create, f.remote.create());
  await tick(); f.ack(); await create;
});
test('remote presentation cannot load real controller/catalog; Rust sender identity fences both channels', () => {
  for (const file of ['src/features/chat/components/ChatPanelSurface.tsx', 'src/features/chat/components/ChatPanelComposer.tsx', 'src/features/chat/lib/quickChatRemote.ts']) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /import \{ chatController|loadChatProviderCatalog/);
  }
  const rust = readFileSync('src-tauri/src/features/quick_chat/mod.rs', 'utf8');
  for (const command of ['quick_chat_connect_main', 'quick_chat_publish', 'quick_chat_configure']) {
    assert.match(rust.slice(rust.indexOf(`fn ${command}`)).split('#[tauri::command]')[0], /require\(&window, "main"\)/);
  }
  for (const command of ['quick_chat_connect(', 'quick_chat_command', 'quick_chat_window']) {
    assert.match(rust.slice(rust.indexOf(`fn ${command}`)).split('#[tauri::command]')[0], /require\(&window, LABEL\)/);
  }
  assert.match(rust, /api.prevent_close\(\)/);
  assert.doesNotMatch(rust, /unregister_all|Focused\(false\)/);
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/quick-chat.json', 'utf8'));
  assert.equal(capability.permissions.some(p => /sql:|store:|read-text|destroy|emit/.test(p)), false);
});
test('shortcut preferences default/migrate without changing disabled or cleared settings', () => {
  const { migrateQuickChatSettings } = load('src/shared/preferences/quickChatSettings.ts', {
    zustand: { create: () => ({}) },
    '@tauri-apps/plugin-store': { Store: {} }, '@tauri-apps/api/core': { invoke: () => {} },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(migrateQuickChatSettings(null))), { enabled: true, shortcut: 'Ctrl+Alt+Space' });
  assert.deepEqual(JSON.parse(JSON.stringify(migrateQuickChatSettings({ enabled: false, shortcut: '  ' }))), { enabled: false, shortcut: '' });
});
test('main owner executes remote intents once and publishes only projected catalog/selected state', async () => {
  const f = fixture(); await f.controller.start();
  let channel; let navigations = 0; const publications = [];
  class Channel { constructor() { channel = this; } }
  const invoke = async (name, args) => { if (name === 'quick_chat_publish') publications.push(args); };
  const settings = { getState: () => ({ language: 'en-US', resolvedTheme: 'dark' }), subscribe: () => () => {} };
  const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
    '@tauri-apps/api/core': { Channel, invoke }, './lifecycle': { chatController: f.controller },
    '../lib/panelController': contract,
    '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => [{ id: 'p', name: 'P', baseUrl: 'secret-url', credential: 'secret',
      enabled: true, isDefault: true, protocol: 'chat', models: [{ modelId: 'm', enabled: true, isDefault: true, credential: 'secret' }] }] },
    '../../../shared/preferences/settingsStore': { useSettingsStore: settings },
    '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
  }, { crypto: { randomUUID: () => 'epoch' } });
  await startQuickChatOwner(source => { assert.equal(source, "quick-chat"); navigations++; });
  channel.onmessage({ id: 'hello', command: { op: 'hello' } }); await tick();
  assert.equal(f.controller.getSnapshot().selected, 'c1', 'hello never changes main selection');
  const quickId = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
  assert.equal(quickId, 'c3');
  channel.onmessage({ id: 'hello-again', command: { op: 'hello' } }); await tick();
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 1);
  await f.controller.select('c2');
  channel.onmessage({ id: 'hello-main-moved', command: { op: 'hello' } }); await tick();
  const quickState = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state;
  assert.equal(quickState.selected, quickId);
  assert.ok(quickState.conversations.every(c => c.origin === 'quick-chat'));
  await f.controller.loadHistory('no matching title');
  channel.onmessage({ id: 'hello-filtered', command: { op: 'hello' } }); await tick();
  assert.equal(publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected, quickId);
  const serialized = JSON.stringify(publications);
  assert.doesNotMatch(serialized, /secret|credential/);
  const envelope = { id: 'continue', epoch: 'epoch', command: { op: 'continue' } };
  channel.onmessage(envelope); channel.onmessage(envelope); await tick();
  assert.equal(navigations, 1); assert.equal(f.controller.getSnapshot().selected, 'c3');
  channel.onmessage({ id: 'wrong-selection', epoch: 'epoch', command: { op: 'generate', conversationId: 'c2', retry: false, reasoning: 'off', images: [] } });
  await tick(); assert.equal(f.calls.filter(c => c[0] === 'generate').length, 0);
  assert.ok(publications.some(p => p.kind === 'ack' && p.payload.id === 'wrong-selection' && p.payload.error));
  channel.onmessage({ id: 'old-owner', epoch: 'retired', command: { op: 'create' } });
  await tick();
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 1, 'queued mutations cannot cross owner reload');
  await f.controller.remove(quickId); await tick();
  channel.onmessage({ id: 'hello-deleted', command: { op: 'hello' } }); await tick();
  const recovered = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
  assert.equal(recovered, 'c4');
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 2, 'deletion creates one replacement');
  channel.onmessage({ id: 'select-workspace', epoch: 'epoch', command: { op: 'select', conversationId: 'c2' } }); await tick();
  assert.ok(publications.some(p => p.kind === 'ack' && p.payload.id === 'select-workspace' && p.payload.error));
});

test('draft burst coalesces and navigation waits for the latest acknowledged edit', async () => {
  const f = remoteFixture(); await f.remote.start();
  f.remote.accept({ epoch: 'owner', version: 1, state: { ready: true, selected: 'c1', details: { c1: {} }, conversations: [{ id: 'c1' }], drafts: {} }, catalog: [] });
  f.remote.setDraft('c1', 'first');
  for (let n = 0; n < 1000; n++) f.remote.setDraft('c1', `latest ${n}`);
  const selecting = f.remote.select('c2');
  await tick();
  assert.equal(f.sent.filter(x => x.command.op === 'draft').length, 1);
  assert.equal(f.sent.filter(x => x.command.op === 'select').length, 0);
  f.ack(); await tick();
  const drafts = f.sent.filter(x => x.command.op === 'draft');
  assert.equal(drafts.length, 2); assert.equal(drafts[1].command.text, 'latest 999');
  f.ack(); await tick();
  assert.equal(f.sent.filter(x => x.command.op === 'select').length, 1);
  f.ack(); await selecting;
});
test('authoritative recovered snapshot retires deleted draft and clears prior command failure', async () => {
  const f = remoteFixture(); await f.remote.start();
  f.remote.accept({ epoch: 'e', version: 1, state: { ready: true, selected: 'old', details: { old: {} }, conversations: [{ id: 'old' }], drafts: {}, error: null }, catalog: [] });
  f.remote.report('chat_quick_timeout');
  f.remote.drainingDrafts = true;
  f.remote.setDraft('old', 'unsent');
  f.remote.accept({ epoch: 'e', version: 2, state: { ready: true, selected: 'new', details: { new: {} }, conversations: [{ id: 'new' }], drafts: {}, error: null }, catalog: [] });
  f.remote.drainingDrafts = false;
  await tick();
  assert.equal(f.remote.getSnapshot().error, null);
  assert.equal(f.remote.getSnapshot().drafts.old, undefined);
  assert.equal(f.sent.some(x => x.command.op === 'draft' && x.command.conversationId === 'old'), false);
});
test('quick presentation synchronizes theme store and submit lock covers pre-ack interval', () => {
  const app = readFileSync('src/features/chat/api/QuickChatWindowApp.tsx', 'utf8');
  assert.match(app, /resolvedTheme: presentation.theme/);
  const composer = readFileSync('src/features/chat/components/ChatPanelComposer.tsx', 'utf8');
  assert.match(composer, /submitting.current = true/);
  assert.match(composer, /running \|\| sending \|\| busy \|\| suspended/);
});
test('owner reload rejects pending generation and never retries it into the new epoch', async () => {
  const f = remoteFixture(); await f.remote.start();
  const snapshot = epoch => ({ epoch, version: 1, state: { ready: true, selected: 'c1', drafts: {}, details: { c1: {} }, conversations: [{ id: 'c1' }] }, catalog: [] });
  f.remote.accept(snapshot('old'));
  f.remote.setDraft('c1', 'question');
  const generation = f.remote.generate('c1');
  const failed = assert.rejects(generation, error => error === 'chat_quick_owner_changed');
  f.remote.accept(snapshot('new'));
  await failed; await tick();
  assert.equal(f.sent.filter(x => x.command.op === 'generate').length, 0);
  assert.equal(f.remote.getSnapshot().drafts.c1, 'question');
});

test('independent creation/detail loads never borrow global selection or its race token', async () => {
  const f = fixture(); await f.controller.start();
  const id = await f.controller.createUnselected('quick-chat');
  assert.equal(f.controller.getSnapshot().selected, 'c1');
  assert.equal(f.rows.get(id).conversation.origin, 'quick-chat');
  await f.controller.select('c2'); await f.controller.loadDetail(id);
  assert.equal(f.controller.getSnapshot().selected, 'c2');
  const projected = contract.selectedSnapshot(f.controller.getSnapshot(), id, true);
  assert.equal(projected.selected, id);
  assert.deepEqual(Object.keys(projected.details), [id]);
});

test('quick reasoning starts medium and retains explicit off in generated intent', async () => {
  assert.match(readFileSync('src/features/chat/api/QuickChatWindowApp.tsx', 'utf8'), /useState<ReasoningEffort>\("medium"\)/);
  const f = remoteFixture(); await f.remote.start();
  const pending = f.remote.generate('c1', false, 'off'); await tick();
  assert.equal(f.sent.at(-1).command.reasoning, 'off'); f.ack(); await pending;
});

test('quick selection cannot be overwritten by an older load racing explicit new', async () => {
  const f = fixture(); await f.controller.start();
  f.rows.get('c2').conversation.origin = 'quick-chat';
  let channel; const publications = [];
  class Channel { constructor() { channel = this; } }
  const settings = { getState: () => ({}), subscribe: () => () => {} };
  const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
    '@tauri-apps/api/core': { Channel, invoke: async (name, args) => { if (name === 'quick_chat_publish') publications.push(args); } },
    './lifecycle': { chatController: f.controller }, '../lib/panelController': contract,
    '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => [] },
    '../../../shared/preferences/settingsStore': { useSettingsStore: settings },
    '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
  }, { crypto: { randomUUID: () => 'epoch' } });
  await startQuickChatOwner(() => {});
  const send = (id, command) => channel.onmessage({ id, epoch: 'epoch', command });
  send('hello', { op: 'hello' }); await tick();
  const gate = deferred(); const get = f.api.get;
  f.api.get = async id => { if (id === 'c2') await gate.promise; return get(id); };
  send('select', { op: 'select', conversationId: 'c2' }); await tick();
  send('new', { op: 'create' }); await tick();
  gate.resolve(); await tick();
  const latest = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state;
  assert.equal(latest.selected, 'c4', 'later explicit new wins instead of older select completion');
  assert.equal(f.controller.getSnapshot().selected, 'c1');
  // Continue must not navigate a deleted conversation after an asynchronous load.
  const loading = deferred();
  f.api.get = async id => { const detail = await get(id); if (id === 'c4') await loading.promise; return detail; };
  send('continue', { op: 'continue' }); await tick();
  f.api.get = get;
  await f.controller.remove('c4'); loading.resolve(); await tick();
  const ack = publications.find(p => p.kind === 'ack' && p.payload.id === 'continue');
  assert.ok(ack.payload.error, 'deleted target must reject continuation');
});

test('quick non-selecting create/load preserve main filtered page and pagination', async () => {
  const f = fixture(55); await f.controller.start();
  f.rows.get('c1').conversation.title = 'matching';
  await f.controller.loadHistory('matching');
  const before = f.controller.getSnapshot();
  const id = await f.controller.createUnselected('quick-chat');
  await f.controller.loadDetail(id);
  const after = f.controller.getSnapshot();
  assert.deepEqual(after.conversations, before.conversations);
  assert.equal(after.search, before.search);
  assert.equal(after.hasMore, before.hasMore);
  assert.equal(after.selected, before.selected);
  const projected = contract.selectedSnapshot(after, id, true);
  assert.ok(projected.conversations.some(c => c.id === id));
});

test('failed deleted-chat recovery publishes error and a later hello successfully recovers', async () => {
  const f = fixture(); await f.controller.start();
  let channel; const publications = [];
  class Channel { constructor() { channel = this; } }
  const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
    '@tauri-apps/api/core': { Channel, invoke: async (name, args) => { if (name === 'quick_chat_publish') publications.push(args); } },
    './lifecycle': { chatController: f.controller }, '../lib/panelController': contract,
    '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => [] },
    '../../../shared/preferences/settingsStore': { useSettingsStore: { getState: () => ({}), subscribe: () => () => {} } },
    '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
  }, { crypto: { randomUUID: () => 'recover-failure-epoch' } });
  await startQuickChatOwner(() => {});
  const send = (id, command) => channel.onmessage({ id, epoch: 'recover-failure-epoch', command });
  send('hello', { op: 'hello' }); await tick();
  const original = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
  const create = f.api.create; let rejectReplacement = true;
  f.api.create = async origin => { if (rejectReplacement) { rejectReplacement = false; throw 'chat_storage'; } return create(origin); };
  await f.controller.remove(original); await tick(); await tick();
  const failed = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state;
  assert.equal(failed.selected, null);
  assert.equal(failed.error, 'chat_storage');
  assert.equal(failed.ready, true);
  send('hello-retry', { op: 'hello' }); await tick(); await tick();
  const recovered = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state;
  assert.ok(recovered.selected);
  assert.equal(recovered.error, null, JSON.stringify(publications.filter(p => p.kind === 'snapshot').map(p => p.payload.state.error)));
  assert.equal(recovered.ready, true);
});

test('quick hello after DB failure never loads catalog, creates conversation or publishes ready', async () => {
  const f = fixture(); f.api.initialize = async () => { throw 'chat_storage'; };
  let channel, catalogCalls = 0; const publications = [];
  class Channel { constructor() { channel = this; } }
  const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
    '@tauri-apps/api/core': { Channel, invoke: async (name,args) => { if (name === 'quick_chat_publish') publications.push(args); } },
    './lifecycle': { chatController: f.controller }, '../lib/panelController': contract,
    '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => { catalogCalls++; throw 'chat_model_missing'; } },
    '../../../shared/preferences/settingsStore': { useSettingsStore: { getState: () => ({ language: 'en-US', resolvedTheme: 'dark' }), subscribe: () => () => {} } },
    '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
  }, { crypto: { randomUUID: () => 'db-failed-owner' } });
  await startQuickChatOwner(() => {});
  for (const id of ['hello-1','hello-2']) { channel.onmessage({ id, command: { op: 'hello' } }); await tick(); }
  assert.equal(catalogCalls, 0);
  assert.equal(f.calls.some(c => c[0] === 'create'), false);
  assert.equal(f.controller.getSnapshot().ready, false);
  assert.equal(f.controller.getSnapshot().error, 'chat_storage');
  assert.equal(publications.filter(p => p.kind === 'snapshot').every(p => !p.payload.state.ready), true);
  assert.equal(publications.filter(p => p.kind === 'ack').every(p => p.payload.error === 'chat_quick_command_failed'), true);
});

test('unready panel never diagnoses an unloaded catalog as missing models', () => {
  const react = { useEffect() {}, useState: value => [value, () => {}], useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const picker = () => null;
  const { ChatPanelSurface } = load('src/features/chat/components/ChatPanelSurface.tsx', {
    react,
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    '../../../shared/ui/select': { Select: 'select' },
    '../api/chatReasoning': { REASONING_EFFORT_OPTIONS: [] },
    '../lib/chatProviderCatalog': { defaultCatalogModel: () => null },
    '../lib/chatPanelActions': { panelTitle: () => 'title' },
    './ChatPanelComposer': { ChatPanelComposer: () => null },
    './ChatPanelMessages': { ChatPanelMessages: () => null },
    './ChatPanelModelPicker': { ChatPanelModelPicker: picker },
    './ChatReasoningPill': { ChatReasoningPill: () => null },
  });
  const containsPicker = node => !!node && (Array.isArray(node) ? node.some(containsPicker)
    : typeof node === 'object' && (node.type === picker || containsPicker(node.props?.children)));
  const render = ready => ChatPanelSurface({ mode: 'float', catalog: [], attachedSelection: '',
    reasoningEffort: 'medium', controller: { subscribe() {}, getSnapshot: () => ({ ready,
      selected: null, details: {}, running: [], busy: [], conversations: [], drafts: {}, suspended: false }) } });
  assert.equal(containsPicker(render(false)), false, 'notReady includes DB failure and pending handshake');
  assert.equal(containsPicker(render(true)), true, 'successful empty catalog still offers configuration');
});

test('shared sidebar/quick reasoning renders reasoning pill with full keyboard access', () => {
  const source = readFileSync('src/shared/ui/select.tsx', 'utf8');
  assert.match(source, /unstyled = false/);
  assert.match(source, /showChevron = true/);
  assert.match(source, /!unstyled && "ui-input"/);
  assert.match(source, /showChevron && <SelectPrimitive.Icon/);
  assert.match(source, /<SelectPrimitive.Trigger[\s\S]*aria-label=\{ariaLabel\}/);
  assert.match(source, /ui-focus-ring/);
  const css = readFileSync('src/features/chat/components/chatPanel.css', 'utf8');
  assert.match(css, /\.chat-reasoning-pill \{[^}]*display: inline-flex/);
  assert.match(css, /\.chat-reasoning-pill\.is-active \{[^}]*var\(--accent/);
  const react = { useEffect() {}, useState: value => [value, () => {}], useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const composer = () => null;
  const pill = (props) => ({ type: 'pill', props });
  const { ChatPanelSurface } = load('src/features/chat/components/ChatPanelSurface.tsx', {
    react, '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    '../../../shared/ui/select': { Select: 'select' },
    '../api/chatReasoning': { REASONING_EFFORT_OPTIONS: ['off', 'medium'] },
    '../lib/chatProviderCatalog': { defaultCatalogModel: () => null },
    '../lib/chatPanelActions': { panelTitle: () => 'title' },
    './ChatPanelComposer': { ChatPanelComposer: composer },
    './ChatPanelMessages': { ChatPanelMessages: () => null },
    './ChatPanelModelPicker': { ChatPanelModelPicker: () => null },
    './ChatReasoningPill': { ChatReasoningPill: pill },
  });
  const find = (node, predicate) => !node ? undefined : Array.isArray(node)
    ? node.map(x => find(x, predicate)).find(Boolean)
    : typeof node === 'object' ? predicate(node) ? node : find(node.props?.children, predicate) : undefined;
  for (const mode of ['dock', 'float']) {
    let changed;
    const tree = ChatPanelSurface({ mode, catalog: [], attachedSelection: '', reasoningEffort: 'medium',
      onReasoningEffortChange: value => { changed = value; },
      controller: { subscribe() {}, getSnapshot: () => ({ ready: true, selected: null, details: {}, running: [], busy: [], conversations: [], drafts: {}, suspended: false }) } });
    const control = find(tree, node => node.type === composer).props.reasoningControl;
    assert.equal(control.type, pill);
    assert.equal(control.props.value, 'medium');
    control.props.onChange('off');
    assert.equal(changed, 'off');
    const history = find(tree, node => node.props?.className === 'chat-panel-compact-select');
    assert.equal(history.props.unstyled, undefined); assert.equal(history.props.showChevron, undefined);
  }
});

test('quick Expand waits for same-ID continuation before native reveal/hide and surfaces failures', async () => {
  const source = readFileSync('src/features/chat/api/QuickChatWindowApp.tsx', 'utf8');
  assert.match(source, /remote.continueInMain\(\).then\(\(\) => invoke\("quick_chat_window", \{ action: "main" \}\)\).catch\(remote.report\)/);
  const rust = readFileSync('src-tauri/src/features/quick_chat/mod.rs', 'utf8');
  assert.match(rust, /continue_window\(\s*\|\| main.show\(\),\s*\|\| main.unminimize\(\),\s*\|\| main.set_focus\(\),\s*\|\| window.hide\(\),/);
  assert.doesNotMatch(rust, /window.destroy|window.close/);
});

test('real owner continuation rejects failed or superseded selection even with cached same-ID detail', async () => {
  for (const outcome of ['failure', 'stale', 'success']) {
    const f = fixture(); await f.controller.start();
    let channel, navigations = 0; const publications = [];
    class Channel { constructor() { channel = this; } }
    const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
      '@tauri-apps/api/core': { Channel, invoke: async (name, args) => { if (name === 'quick_chat_publish') publications.push(args); } },
      './lifecycle': { chatController: f.controller }, '../lib/panelController': contract,
      '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => [] },
      '../../../shared/preferences/settingsStore': { useSettingsStore: { getState: () => ({}), subscribe: () => () => {} } },
      '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
    }, { crypto: { randomUUID: () => 'continuation-epoch' } });
    await startQuickChatOwner(() => { navigations++; });
    const send = (id, command) => channel.onmessage({ id, epoch: 'continuation-epoch', command });
    send('hello', { op: 'hello' }); await tick();
    const target = publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
    const get = f.api.get, selection = deferred(); let gets = 0;
    f.api.get = async id => {
      if (id === target && ++gets === 2) {
        if (outcome === 'failure') throw 'chat_storage';
        if (outcome === 'stale') await selection.promise;
      }
      return get(id);
    };
    send('continue', { op: 'continue' }); await tick();
    if (outcome === 'stale') {
      // Even returning to the same ID must not make the older selection successful.
      await f.controller.select(target); selection.resolve(); await tick();
    }
    assert.ok(f.controller.getSnapshot().details[target], 'loadDetail succeeded before selection');
    assert.equal(f.controller.getSnapshot().selected, target, 'ID/cache guards alone cannot detect this failure');
    const ack = publications.find(p => p.kind === 'ack' && p.payload.id === 'continue').payload;
    assert.equal(ack.error, outcome === 'success' ? null : 'chat_quick_command_failed', outcome);
    assert.equal(navigations, outcome === 'success' ? 1 : 0, outcome);
    if (outcome === 'failure') assert.equal(f.controller.getSnapshot().error, 'chat_storage');
    assert.equal(gets, outcome === 'stale' ? 3 : 2);
  }
});

for (const deleteRecovery of [false, true]) test(`queued deletion recovery yields to later explicit selection; replacement deleted=${deleteRecovery}`, async () => {
  const f = fixture(); await f.controller.start();
  f.rows.get('c2').conversation.origin = 'quick-chat';
  let channel; const publications = [];
  class Channel { constructor() { channel = this; } }
  const { startQuickChatOwner } = load('src/features/chat/api/quickChatOwner.ts', {
    '@tauri-apps/api/core': { Channel, invoke: async (name, args) => { if (name === 'quick_chat_publish') publications.push(args); } },
    './lifecycle': { chatController: f.controller }, '../lib/panelController': contract,
    '../lib/chatProviderCatalog': { loadChatProviderCatalog: async () => [] },
    '../../../shared/preferences/settingsStore': { useSettingsStore: { getState: () => ({}), subscribe: () => () => {} } },
    '../../../shared/preferences/quickChatSettings': { useQuickChatSettings: { getState: () => ({ load: async () => {} }) } },
  }, { crypto: { randomUUID: () => 'recovery-epoch' } });
  await startQuickChatOwner(() => {});
  const send = (id, command) => channel.onmessage({ id, epoch: 'recovery-epoch', command });
  const selected = () => publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected;
  send('hello', { op: 'hello' }); await tick();
  const original = selected(), creating = deferred(), release = deferred(), create = f.api.create;
  let replacement;
  f.api.create = async origin => {
    const detail = await create(origin); replacement = detail.conversation.id;
    creating.resolve(); await release.promise; return detail;
  };
  await f.controller.remove(original); await tick();
  assert.equal(publications.filter(p => p.kind === 'snapshot').at(-1).payload.state.selected, original, 'no ready/null transient while replacement is pending');
  await creating.promise;
  send('select-b', { op: 'select', conversationId: 'c2' }); await tick();
  // Extra owner notifications must neither recursively create nor deadlock the queue.
  f.controller.clearError(); f.controller.report('chat_conflict'); await tick();
  if (deleteRecovery) await f.controller.remove(replacement);
  release.resolve(); await tick();
  assert.equal(selected(), 'c2', 'later explicit navigation wins over automatic recovery');
  const ack = publications.find(p => p.kind === 'ack' && p.payload.id === 'select-b');
  assert.ok(ack, 'selection queue drains after recovery'); assert.equal(ack.payload.error, null);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 2, 'one recovery only');
  assert.equal(f.controller.getSnapshot().selected, 'c1', 'main selection remains independent');
  send('hello-again', { op: 'hello' }); await tick();
  assert.equal(selected(), 'c2'); assert.equal(f.calls.filter(c => c[0] === 'create').length, 2);
  if (deleteRecovery) assert.equal(f.controller.getSnapshot().details[replacement], undefined);
  await f.controller.remove('c2'); await tick();
  assert.equal(selected(), 'c5', 'a subsequent selected deletion gets its own recovery');
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 3);
});
