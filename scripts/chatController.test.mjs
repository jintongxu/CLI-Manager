import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tick, deferred, ChatController } from './chatHarness.mjs';

async function send(f, id = 'c1') {
  f.controller.setDraft(id, 'hello'); await f.controller.generate(id); return f.calls.filter(c => c[0] === 'generate').at(-1)[1].requestId;
}
test('StrictMode subscriptions/start replay are idempotent; switching and hidden subscriptions never cancel', async () => {
  const f = fixture(); const a = f.controller.start(), b = f.controller.start(); await Promise.all([a, b]);
  assert.equal(f.calls.filter(c => c[0] === 'initialize').length, 1);
  const unsubscribe = f.controller.subscribe(() => {}); unsubscribe(); f.controller.subscribe(() => {})();
  const request = await send(f); await f.controller.select('c2');
  f.emit(request); assert.equal(f.controller.getSnapshot().details.c1.messages.at(-1).content, 'partial');
  assert.equal(f.controller.getSnapshot().selected, 'c2'); assert.equal(f.calls.filter(c => c[0] === 'cancel').length, 0);
  f.emit(request, { sequence: 2, status: 'completed', content: 'done', saved: true }); await tick();
  assert.equal(f.controller.getSnapshot().details.c1.messages.at(-1).content, 'done');
  assert.equal(f.controller.getSnapshot().running.length, 0);
});
test('channel rejects old sequence, request, message and late terminal/retry events; retry keeps user slot', async () => {
  const f = fixture(); await f.controller.start(); const request = await send(f);
  f.emit(request, { sequence: 3, content: 'new' });
  for (const values of [{ sequence: 2, content: 'old' }, { sequence: 4, requestId: 'wrong' }, { sequence: 5, messageId: 'wrong' }]) f.emit(request, values);
  assert.equal(f.controller.getSnapshot().details.c1.messages.at(-1).content, 'new');
  f.emit(request, { sequence: 4, status: 'stopped', saved: true }); await tick();
  await f.controller.generate('c1', true); const next = f.calls.filter(c => c[0] === 'generate').at(-1)[1];
  assert.equal(next.retry, true); assert.equal(next.text, null);
  f.emit(request, { sequence: 99, content: 'stale', status: 'completed', saved: true });
  f.emit(next.requestId, { sequence: 1, content: 'retry answer', status: 'completed', saved: true }); await tick();
  assert.equal(f.controller.getSnapshot().details.c1.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(f.controller.getSnapshot().details.c1.messages.at(-1).content, 'retry answer');
});
test('rapid selects ignore late detail, stale lists cannot resurrect explicitly deleted chats', async () => {
  const f = fixture(); await f.controller.start(); const late = deferred(), original = f.api.get;
  f.api.get = id => id === 'c2' ? late.promise : original(id);
  const selecting = f.controller.select('c2'); await f.controller.select('c1'); late.resolve(structuredClone(f.rows.get('c2'))); await selecting;
  assert.equal(f.controller.getSnapshot().selected, 'c1');
  const list = deferred(); f.api.list = () => list.promise;
  const listing = f.controller.loadHistory(); const old = structuredClone(f.rows.get('c1').conversation);
  await f.controller.remove('c1'); list.resolve([old]); await listing;
  assert.equal(f.controller.getSnapshot().conversations.some(c => c.id === 'c1'), false);
  assert.equal(f.rows.has('c2'), true);
});
test('stop-before-generate receipt sends immediate tombstone; delete fences late channel', async () => {
  const f = fixture(); await f.controller.start(); const receipt = deferred(), original = f.api.generate;
  f.api.generate = async (input, cb) => { const message = await original(input, cb); await receipt.promise; return message; };
  f.controller.setDraft('c1', 'hi'); const generating = f.controller.generate('c1'); await tick();
  await f.controller.stop('c1'); assert.deepEqual(f.calls.find(c => c[0] === 'cancel').slice(1), ['c1', 'r1']);
  receipt.resolve(); await generating;
  const removing = f.controller.remove('c1'); await removing;
  f.emit('r1', { sequence: 20, status: 'completed', saved: true }); await tick();
  assert.equal(f.controller.getSnapshot().details.c1, undefined);
  assert.equal(f.calls.filter(c => c[0] === 'delete').length, 1);
});
test('early event before invoke receipt retains cumulative final answer', async () => {
  const f = fixture(); await f.controller.start(); const original = f.api.generate;
  f.api.generate = async (input, cb) => {
    const receipt = await original(input, cb);
    f.emit(input.requestId, { sequence: 1, status: 'completed', content: 'early', saved: true });
    return receipt;
  };
  await send(f); await tick(); assert.equal(f.controller.getSnapshot().details.c1.messages.at(-1).content, 'early');
});
test('initialize restoration never generates automatically', async () => {
  const f = fixture(); f.api.initialize = async () => ({ conversations: [...f.rows.values()].map(d => d.conversation), unsaved: [] });
  f.rows.get('c1').messages.push({ id: 'old', conversationId: 'c1', role: 'assistant', status: 'interrupted', content: 'checkpoint' });
  const controller = new ChatController(f.api); await controller.start(); await controller.select('c2'); await controller.select('c1');
  assert.equal(controller.getSnapshot().details.c1.messages[0].status, 'interrupted');
  assert.equal(f.calls.some(c => c[0] === 'generate'), false);
});

test('retry stopped answer preserves independently saved next-question composer', async () => {
  const f = fixture(); await f.controller.start();
  f.controller.setDraft('c1', 'first question'); await f.controller.generate('c1');
  f.emit('r1', { status: 'stopped', saved: true, content: 'partial' }); await tick();
  f.controller.setDraft('c1', 'next unrelated question'); await f.controller.flushDraft('c1');
  await f.controller.generate('c1', true);
  assert.equal(f.controller.getSnapshot().drafts.c1, 'next unrelated question');
  assert.equal(f.rows.get('c1').conversation.draft, 'next unrelated question');
  assert.equal(f.rows.get('c1').messages.length, 2);
  assert.equal(f.calls.filter(c => c[0] === 'generate').at(-1)[1].text, null);
});
