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
