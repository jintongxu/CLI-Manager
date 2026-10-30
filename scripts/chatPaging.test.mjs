import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements, tick, deferred } from './chatHarness.mjs';

test('history UI loads literal search and explicit 50-row next page; obsolete searches are ignored', async () => {
  const f = fixture(101), original = f.api.initialize;
  f.api.initialize = async () => { const data = await original(); data.conversations = data.conversations.slice(0, 50); return data; };
  await f.controller.start(); const ui = hookHarness(f.controller); let tree = ui.render();
  const more = elements(tree).find(n => n.type === 'button' && n.props.children === 'chat.more');
  assert.ok(more); more.props.onClick(); await tick();
  assert.equal(f.calls.filter(c => c[0] === 'list').at(-1)[2], 50);
  assert.equal(f.controller.getSnapshot().conversations.length, 100);
  const old = deferred(), originalList = f.api.list; f.api.list = (search, offset) => search === 'old' ? old.promise : originalList(search, offset);
  const previous = f.controller.loadHistory('old');
  tree = ui.render(); elements(tree).find(n => n.props?.type === 'search').props.onChange({ target: { value: '%_literal' } }); await tick();
  old.resolve([f.rows.get('c1').conversation]); await previous;
  assert.equal(f.controller.getSnapshot().search, '%_literal'); assert.equal(f.controller.getSnapshot().conversations.length, 0); ui.cleanup();
});
test('provider/model controls persist actual selected identity and disabled reasons; foreign lease is read-only', async () => {
  const f = fixture(); f.api.providers = async () => [
    { appType: 'grok', providerId: 'new', name: 'New', defaultModel: 'default', available: true, protocol: 'responses', reason: null },
    { appType: 'claude', providerId: 'locked', name: 'Locked', available: false, protocol: null, reason: 'chat_provider_key' },
  ];
  await f.controller.start(); const ui = hookHarness(f.controller); let tree = ui.render();
  const unavailable = elements(tree).find(n => n.type === 'option' && n.props.value === 'claude:locked');
  assert.equal(unavailable.props.disabled, true); assert.ok(unavailable.props.children.join('').includes('Provider has no active API key.'));
  elements(tree).find(n => n.type === 'select').props.onChange({ target: { value: 'grok:new' } }); await tick();
  assert.equal(f.rows.get('c1').conversation.appType, 'grok'); assert.equal(f.rows.get('c1').conversation.model, 'default');
  ui.render(); tree = ui.render(); const inputs = elements(tree).filter(n => n.type === 'input');
  const model = inputs.find(n => n.props.value === 'default'); model.props.onChange({ target: { value: 'custom' } }); tree = ui.render();
  elements(tree).find(n => n.type === 'input' && n.props.value === 'custom').props.onBlur(); await tick();
  assert.equal(f.rows.get('c1').conversation.model, 'custom');
  f.rows.get('c1').conversation.requestId = 'foreign'; f.rows.get('c1').conversation.leaseUntil = Date.now() + 30000;
  await f.controller.select('c1'); tree = ui.render(); assert.equal(elements(tree).find(n => n.type === 'textarea').props.disabled, true);
  ui.cleanup();
});
