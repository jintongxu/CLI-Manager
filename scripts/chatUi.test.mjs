import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements, tick, interactions, load } from './chatHarness.mjs';
const button = (tree, key) => elements(tree).find(n => n.type === 'button' && n.props.children === key);

test('actual workspace handlers: drafts, IME Enter/Shift+Enter and explicit send; hidden render preserves controller', async () => {
  const f = fixture(); await f.controller.start(); const ui = hookHarness(f.controller); let tree = ui.render();
  let textarea = elements(tree).find(n => n.type === 'textarea');
  textarea.props.onChange({ target: { value: 'typed' } }); tree = ui.render(); textarea = elements(tree).find(n => n.type === 'textarea');
  const key = (values = {}) => ({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault() {}, ...values });
  textarea.props.onCompositionStart(); textarea.props.onKeyDown(key()); textarea.props.onCompositionEnd();
  textarea.props.onKeyDown(key({ shiftKey: true })); textarea.props.onKeyDown(key({ nativeEvent: { isComposing: true, keyCode: 229 } }));
  await tick(); assert.equal(f.calls.some(c => c[0] === 'generate'), false);
  textarea.props.onKeyDown(key()); await tick(); assert.equal(f.calls.filter(c => c[0] === 'generate').length, 1);
  ui.render(false); f.emit('r1', { content: 'hidden response', sequence: 1 });
  tree = ui.render(true); assert.ok(elements(tree).some(n => n.props?.content === 'hidden response'));
  assert.equal(f.calls.some(c => c[0] === 'cancel'), false); ui.cleanup();
});
test('delete requires rendered confirmation; cancel is nondestructive; rename and history paging use backend', async () => {
  const f = fixture(51); await f.controller.start(); const ui = hookHarness(f.controller);
  let tree = ui.render(); button(tree, 'chat.delete').props.onClick(); tree = ui.render();
  assert.ok(elements(tree).some(n => n.props?.role === 'dialog')); assert.equal(f.calls.some(c => c[0] === 'delete'), false);
  button(tree, 'chat.cancel').props.onClick(); tree = ui.render(); assert.equal(f.rows.size, 51);
  button(tree, 'chat.rename').props.onClick(); tree = ui.render();
  const dialog = elements(tree).find(n => n.props?.role === 'dialog');
  elements(dialog).find(n => n.type === 'input').props.onChange({ target: { value: 'Renamed' } }); tree = ui.render();
  elements(elements(tree).find(n => n.props?.role === 'dialog')).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick(); assert.equal(f.rows.get('c1').conversation.title, 'Renamed');
  button(ui.render(), 'chat.delete').props.onClick(); tree = ui.render();
  elements(elements(tree).find(n => n.props?.role === 'dialog')).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick(); assert.equal(f.rows.has('c1'), false); ui.cleanup();
});
test('copy failures and only explicit HTTP(S) activation produce localized errors without navigation', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setDraft('c1', 'hi'); await f.controller.generate('c1');
  f.emit('r1', { status: 'completed', saved: true, content: 'answer' }); await tick();
  const ui = hookHarness(f.controller); ui.copyFails = true; let tree = ui.render();
  button(tree, 'chat.copy').props.onClick(); await tick(); assert.equal(f.controller.getSnapshot().error, 'chat_copy');
  const markdown = elements(tree).find(n => n.props?.content === 'answer');
  markdown.props.onLinkActivate('file:///secret'); await tick(); assert.equal(f.controller.getSnapshot().error, 'chat_link');
  assert.equal(ui.opened.length, 0);
  markdown.props.onLinkActivate('https://example.com/page?q=a#fragment'); await tick();
  assert.deepEqual(ui.opened, ['https://example.com/page?q=a#fragment']); ui.cleanup();
});
test('scroll interaction pauses following and bottom button resumes; 24h and bilingual dictionary parity', async () => {
  const f = fixture(); await f.controller.start(); const ui = hookHarness(f.controller); let tree = ui.render();
  elements(tree).find(n => n.props?.className === 'chat-messages').props.onScroll({ currentTarget: { scrollHeight: 1000, scrollTop: 10, clientHeight: 200 } });
  tree = ui.render(); assert.ok(button(tree, 'chat.bottom')); button(tree, 'chat.bottom').props.onClick();
  assert.equal(button(ui.render(), 'chat.bottom'), undefined);
  assert.equal(interactions.isFollowing({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 }), true);
  const en = load('src/shared/i18n/messages/chat.en-US.ts').en, zh = load('src/shared/i18n/messages/chat.zh-CN.ts').zh;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.ok(!/AM|PM/.test(interactions.chatTime(Date.UTC(2026, 0, 1, 23), 'en-US')));
  ui.cleanup();
});

test('UTF8 catalogs supply readable destructive, saving and primary controls in both languages', () => {
  const en = load('src/shared/i18n/messages/chat.en-US.ts').en;
  const zh = load('src/shared/i18n/messages/chat.zh-CN.ts').zh;
  assert.equal(zh['chat.title'], '对话');
  assert.equal(zh['chat.send'], '发送');
  assert.equal(zh['chat.confirmDelete'], '永久删除此对话及其消息？此操作无法撤销。');
  assert.equal(zh['chat.error.chat_storage'], '保存失败，请重试保存。');
  assert.equal(zh['chat.retrySave'], '重试保存');
  assert.equal(en['chat.saving'], 'Saving…');
  assert.equal(en['chat.loading'], 'Loading…');
  assert.equal(en['chat.pending'], 'Generating…');
});

const catalog = [
  { id: 'a', name: 'Provider A', enabled: true, models: [{ modelId: 'same', enabled: true }] },
  { id: 'b', name: 'Provider B', enabled: true, isDefault: true, models: [{ modelId: 'same', enabled: true }] },
];
async function emptyFixture(origin = "workspace") {
  const f = fixture();
  for (const row of f.rows.values()) Object.assign(row.conversation, { model: '', providerId: '', appType: '', origin });
  await f.controller.start(); return f;
}

test('workspace binds latest saved preference and fresh catalog for each new conversation without remount', async () => {
  const f = await emptyFixture();
  const settings = { loaded: true, chatDefaultModel: { providerId: 'a', model: 'same' } };
  let rows = catalog, reads = 0;
  const ui = hookHarness(f.controller, { settings, invoke: async () => { reads++; return rows; } });
  ui.render(); await tick(); ui.render(); await tick();
  assert.equal(f.rows.get('c1').conversation.providerId, 'a');
  settings.chatDefaultModel = { providerId: 'new', model: 'latest' };
  rows = [{ id: 'new', enabled: true, models: [{ modelId: 'latest', enabled: true }] }];
  const create = f.api.create;
  f.api.create = async origin => { const detail = await create(origin); Object.assign(detail.conversation, { model: '', providerId: '' }); Object.assign(f.rows.get(detail.conversation.id).conversation, { model: '', providerId: '' }); return detail; };
  await f.controller.create('workspace'); ui.render(); await tick(); ui.render(); await tick();
  const c = f.rows.get('c3').conversation;
  assert.equal(c.providerId, 'new'); assert.equal(c.model, 'latest'); assert.ok(reads >= 2);
  assert.equal(f.rows.get('c1').conversation.providerId, 'a');
  ui.cleanup();
});

test('workspace keeps explicit stale identity and never labels another provider with the same model', async () => {
  const f = fixture(); Object.assign(f.rows.get('c1').conversation, { model: 'same', providerId: 'deleted', appType: 'chat' });
  await f.controller.start(); const ui = hookHarness(f.controller, { invoke: async () => catalog });
  ui.render(); await tick(); const tree = ui.render(); await tick();
  const pill = elements(tree).find(n => n.props?.className === 'chat-model-pill-text');
  assert.equal(pill.props.children, 'same');
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 0); ui.cleanup();
});

for (const policy of ['workspace', 'sidebar']) {
  test(`${policy} consumer: invalid preference uses its legacy fallback, empty catalog and failure never bind`, async () => {
    for (const mode of ['fallback', 'empty', 'failure']) {
      const f = await emptyFixture(policy);
      const settings = { loaded: true, chatDefaultModel: { providerId: 'deleted', model: 'same' } };
      const ui = hookHarness(f.controller, { settings, invoke: async () => { if (mode === 'failure') throw 'chat_storage'; return mode === 'empty' ? [] : catalog; } });
      if (policy === 'workspace') ui.render(); else ui.renderDefaults(policy);
      await tick();
      const c = f.rows.get('c1').conversation;
      assert.equal(c.providerId, mode === 'fallback' ? (policy === 'workspace' ? 'b' : 'a') : '');
      if (mode === 'failure') assert.equal(f.controller.getSnapshot().error, 'chat_storage');
      ui.cleanup();
    }
  });

  test(`${policy} consumer: delayed old catalog and rapid selection cannot write into the new session`, async () => {
    const { deferred } = await import('./chatHarness.mjs');
    const f = await emptyFixture(policy), pending = [];
    const settings = { loaded: true, chatDefaultModel: { providerId: 'b', model: 'same' } };
    const ui = hookHarness(f.controller, { settings, invoke: () => { const d = deferred(); pending.push(d); return d.promise; } });
    const render = () => policy === 'workspace' ? ui.render() : ui.renderDefaults(policy);
    render(); await f.controller.select('c2'); render();
    pending[0].resolve(catalog); await tick();
    assert.equal(f.calls.filter(c => c[0] === 'update').length, 0);
    pending[1].resolve(catalog); await tick();
    assert.equal(f.rows.get('c1').conversation.model, '');
    assert.equal(f.rows.get('c2').conversation.providerId, 'b'); ui.cleanup();
  });

  test(`${policy} consumer: settings change cancels pending catalog, and restart preserves explicit binding`, async () => {
    const { deferred, ChatController } = await import('./chatHarness.mjs');
    const f = await emptyFixture(policy), pending = [];
    const settings = { loaded: true, chatDefaultModel: { providerId: 'a', model: 'same' } };
    const ui = hookHarness(f.controller, { settings, invoke: () => { const d = deferred(); pending.push(d); return d.promise; } });
    const render = () => policy === 'workspace' ? ui.render() : ui.renderDefaults(policy);
    render(); settings.chatDefaultModel = { providerId: 'b', model: 'same' }; render();
    pending[0].resolve(catalog); await tick(); assert.equal(f.rows.get('c1').conversation.model, '');
    pending[1].resolve(catalog); await tick(); assert.equal(f.rows.get('c1').conversation.providerId, 'b'); ui.cleanup();
    const restored = new ChatController(f.api); await restored.start();
    settings.chatDefaultModel = { providerId: 'a', model: 'same' };
    const ui2 = hookHarness(restored, { settings, invoke: async () => catalog });
    if (policy === 'workspace') ui2.render(); else ui2.renderDefaults(policy);
    await tick(); assert.equal(restored.getSnapshot().details.c1.conversation.providerId, 'b'); ui2.cleanup();
  });
}

test('queued default binding rechecks explicit edits, selected ID, preference validity and CAS conflicts', async () => {
  const f = await emptyFixture();
  const explicit = f.controller.update('c1', { appType: 'chat', providerId: 'explicit', model: 'mine' });
  const automatic = f.controller.bindDefaultModel('c1', { providerId: 'b', model: 'same' });
  await Promise.all([explicit, automatic]); assert.equal(f.rows.get('c1').conversation.model, 'mine');
  await f.controller.select('c2');
  await f.controller.bindDefaultModel('c2', { providerId: 'b', model: 'same' }, () => false);
  assert.equal(f.rows.get('c2').conversation.model, '');
  f.rows.get('c2').conversation.revision++;
  Object.assign(f.rows.get('c2').conversation, { providerId: 'remote', model: 'remote-model' });
  await assert.rejects(f.controller.bindDefaultModel('c2', { providerId: 'b', model: 'same' }));
  assert.equal(f.controller.getSnapshot().details.c2.conversation.model, 'remote-model');
});

test('actual sidebar owner supplies refreshed catalog and disables the old Surface autobinder', async () => {
  const f = await emptyFixture();
  const settings = { loaded: true, chatDefaultModel: { providerId: 'b', model: 'same' } };
  const ui = hookHarness(f.controller, { settings, invoke: async () => catalog });
  assert.equal(ui.renderPanel().props.defaultBindingManaged, true);
  await tick();
  const panel = ui.renderPanel();
  assert.equal(panel.props.catalogReady, true);
  assert.equal(panel.props.catalog.length, 2);
  assert.equal(f.rows.get('c1').conversation.providerId, 'b'); ui.cleanup();
});

test('catalog success with no models preserves the workspace native picker compatibility path', async () => {
  const f = await emptyFixture(); const ui = hookHarness(f.controller);
  ui.render(); await tick(); let tree = ui.render();
  elements(tree).find(n => n.props?.className === 'chat-model-pill').props.onClick(); tree = ui.render();
  const native = elements(tree).find(n => n.props?.className === 'chat-model-dropdown-item');
  assert.ok(native); native.props.onClick(); await tick();
  assert.equal(f.rows.get('c1').conversation.appType, 'claude');
  assert.equal(f.rows.get('c1').conversation.providerId, 'p'); ui.cleanup();
});

test('consumer waits for settings hydration; Quick Chat origin never receives the new preference', async () => {
  const f = await emptyFixture();
  const settings = { loaded: false, chatDefaultModel: null };
  const ui = hookHarness(f.controller, { settings, invoke: async () => catalog });
  ui.renderDefaults(); await tick(); assert.equal(f.rows.get('c1').conversation.model, '');
  settings.loaded = true; settings.chatDefaultModel = { providerId: 'b', model: 'same' };
  ui.renderDefaults(); await tick(); assert.equal(f.rows.get('c1').conversation.providerId, 'b'); ui.cleanup();
  Object.assign(f.rows.get('c2').conversation, { origin: 'quick-chat' });
  await f.controller.select('c2');
  const quick = hookHarness(f.controller, { settings, invoke: async () => catalog });
  quick.renderDefaults(); await tick(); assert.equal(f.rows.get('c2').conversation.model, ''); quick.cleanup();
});

for (const origin of ['workspace', 'sidebar', 'quick-chat']) {
  for (const preference of [null, { providerId: 'deleted', model: 'same' }, { providerId: 'b', model: 'same' }]) {
    for (const order of [[0, 1], [1, 0]]) {
      test(`simultaneously mounted owners: ${origin}, preference ${JSON.stringify(preference)}, order ${order}`, async () => {
        const { deferred } = await import('./chatHarness.mjs');
        const f = await emptyFixture(origin), pending = [deferred(), deferred()];
        const settings = { loaded: true, chatDefaultModel: preference };
        // Independent hook state/effect lifetimes, same actual controller and hook
        // implementations; hidden Workspace is not unmounted when Panel mounts.
        const workspace = hookHarness(f.controller, { settings, invoke: () => pending[0].promise });
        const sidebar = hookHarness(f.controller, { settings, invoke: () => pending[1].promise });
        workspace.render(false); sidebar.renderPanel();
        for (const index of order) { pending[index].resolve(catalog); await tick(); }
        const expected = origin === 'quick-chat' ? '' : preference?.providerId === 'b' || origin === 'workspace' ? 'b' : 'a';
        assert.equal(f.rows.get('c1').conversation.providerId, expected);
        assert.equal(f.calls.filter(call => call[0] === 'update').length, origin === 'quick-chat' ? 0 : 1);
        workspace.cleanup(); sidebar.cleanup();
      });
    }
  }
}

test('both mounted owners preserve an explicit session model even when catalog resolves in reverse order', async () => {
  const { deferred } = await import('./chatHarness.mjs');
  const f = fixture(); await f.controller.start();
  const pending = [deferred(), deferred()];
  const workspace = hookHarness(f.controller, { invoke: () => pending[0].promise });
  const sidebar = hookHarness(f.controller, { invoke: () => pending[1].promise });
  workspace.render(false); sidebar.renderPanel();
  pending[1].resolve(catalog); await tick(); pending[0].resolve(catalog); await tick();
  assert.equal(f.rows.get('c1').conversation.model, 'm');
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 0);
  workspace.cleanup(); sidebar.cleanup();
});
