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
  f.emit('r1', { sequence: 20, status: 'completed', saved: true }); await tick();
  const removing = f.controller.remove('c1'); await removing;
  assert.equal(f.controller.getSnapshot().details.c1, undefined);
  assert.equal(f.calls.filter(c => c[0] === 'delete').length, 1);
});
test('running delete waits for terminal refresh after immediate cancellation acknowledgement', async () => {
  const f = fixture(); await f.controller.start(); const receipt = deferred(), originalGenerate = f.api.generate;
  f.api.generate = async (input, cb) => { const message = await originalGenerate(input, cb); await receipt.promise; return message; };
  f.controller.setDraft('c1', 'hello'); const generating = f.controller.generate('c1'); await tick();
  receipt.resolve(); await generating;
  const terminalGet = deferred(), originalGet = f.api.get;
  f.api.get = async id => id === 'c1' && f.calls.filter(call => call[0] === 'get' && call[1] === 'c1').length >= 2
    ? terminalGet.promise : originalGet(id);
  const removing = f.controller.remove('c1'); await tick();
  assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'delete').length, 0);
  f.emit('r1', { sequence: 2, status: 'stopped', saved: true }); await tick();
  assert.equal(f.calls.filter(call => call[0] === 'delete').length, 0);
  terminalGet.resolve(structuredClone(f.rows.get('c1'))); await removing;
  assert.equal(f.calls.filter(call => call[0] === 'delete').length, 1);
  assert.equal(f.controller.getSnapshot().details.c1, undefined);
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

test('image-only generation sends stage IDs with empty text', async () => {
  const f = fixture(); await f.controller.start();
  await f.controller.generate('c1', false, 'off', ['550e8400-e29b-41d4-a716-446655440000']);
  const input = f.calls.find(call => call[0] === 'generate')[1];
  assert.equal(input.text, ''); assert.deepEqual(input.stageIds, ['550e8400-e29b-41d4-a716-446655440000']);
});

test('fork edit stops source, waits terminal, flushes unrelated draft, refreshes CAS and routes destination events', async () => {
  const f = fixture(); await f.controller.start();
  f.controller.setDraft('c1', 'original'); await f.controller.generate('c1');
  const sourceTarget = f.rows.get('c1').messages[0].id;
  f.controller.setDraft('c1', 'unrelated composer');
  const editing = f.controller.editAndRegenerate('c1', sourceTarget, 'edited');
  await tick();
  assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'forkEdit').length, 0, 'fork waits for source terminal');
  f.emit('r1', { sequence: 2, status: 'stopped', saved: true }); await tick();
  const receipt = await editing;
  const forkInput = f.calls.find(call => call[0] === 'forkEdit')[1];
  assert.equal(f.rows.get('c1').conversation.draft, 'unrelated composer');
  assert.equal(forkInput.sourceRevision, f.rows.get('c1').conversation.revision);
  f.emit(forkInput.requestId, { sequence: 1, operationId: forkInput.operationId, content: 'child answer', status: 'completed', saved: true });
  await tick();
  assert.equal(f.controller.getSnapshot().details[receipt.childConversationId].messages.at(-1).content, 'child answer');
  assert.equal(f.controller.getSnapshot().running.length, 0);
});

test('fork duplicate guard and conflict preserve caller edit without auto retry', async () => {
  const f = fixture(); await f.controller.start();
  f.rows.get('c1').messages.push({ id: 'target', conversationId: 'c1', ordinal: 0, role: 'user', content: 'old', requestId: 'old', status: 'completed', assets: [] });
  const gate = deferred(); const original = f.api.forkEdit; let calls = 0;
  f.api.forkEdit = async (...args) => { calls++; await gate.promise; return original(...args); };
  const first = f.controller.editAndRegenerate('c1', 'target', 'local edit'); await tick();
  await assert.rejects(f.controller.editAndRegenerate('c1', 'target', 'other'), error => error === 'chat_busy');
  gate.reject('chat_conflict');
  await assert.rejects(first, error => error === 'chat_conflict');
  assert.equal(calls, 1, 'conflict is returned to caller and never auto-replayed');
});

test('fork owns destination before child refresh and blocks source generation during intent', async () => {
  const f = fixture(); await f.controller.start();
  f.rows.get('c1').messages.push({ id: 'target', conversationId: 'c1', ordinal: 0, role: 'user', content: 'old', requestId: 'old', status: 'completed', assets: [] });
  const forkGate = deferred(), originalFork = f.api.forkEdit;
  f.api.forkEdit = async (...args) => { const receipt = await originalFork(...args); await forkGate.promise; return receipt; };
  const editing = f.controller.editAndRegenerate('c1', 'target', 'edited'); await tick();
  await assert.rejects(f.controller.generate('c1'), error => error === 'chat_busy');
  const get = f.api.get; f.api.get = async id => id === 'c3' ? Promise.reject('chat_storage') : get(id);
  forkGate.resolve(); const receipt = await editing;
  assert.equal(receipt.childConversationId, 'c3'); assert.equal(f.controller.getSnapshot().running.join(','), 'c3');
  assert.equal(f.controller.getSnapshot().error, 'chat_storage');
  const input = f.calls.find(call => call[0] === 'forkEdit')[1];
  f.emit(input.requestId, { status: 'completed', saved: true }); await tick();
  assert.equal(f.controller.getSnapshot().running.length, 0);
});

test('fork exact replay loads authoritative child without registering a second model run', async () => {
  const f = fixture(); await f.controller.start();
  f.rows.get('c1').messages.push({ id: 'target', conversationId: 'c1', ordinal: 0, role: 'user', content: 'old', requestId: 'old', status: 'completed', assets: [] });
  const original = f.api.forkEdit;
  f.api.forkEdit = async (input, cb) => {
    const receipt = await original(input, cb);
    const child = f.rows.get(receipt.childConversationId);
    Object.assign(child.messages.at(-1), { status: 'completed', content: 'already done' });
    child.conversation.requestId = null;
    return { ...receipt, replayed: true };
  };
  const receipt = await f.controller.editAndRegenerate('c1', 'target', 'same edit', 'off', [], { operationId: 'fixed-op', requestId: 'fixed-request' });
  assert.equal(receipt.replayed, true);
  assert.equal(f.controller.getSnapshot().details[receipt.childConversationId].messages.at(-1).content, 'already done');
  assert.equal(f.controller.getSnapshot().running.length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'forkEdit').length, 1);
});

test('selection preserves report-and-swallow callers while strict callers observe errors and stale tokens', async () => {
  const f = fixture(); await f.controller.start();
  const get = f.api.get;
  f.api.get = async () => { throw 'chat_storage'; };
  assert.equal(await f.controller.select('c2'), undefined);
  assert.equal(f.controller.getSnapshot().error, 'chat_storage');
  f.controller.clearError();
  await assert.rejects(f.controller.select('c2', { strict: true }), error => error === 'chat_storage');
  assert.equal(f.controller.getSnapshot().error, 'chat_storage');
  f.controller.clearError();
  const late = deferred();
  f.api.get = () => late.promise;
  const selecting = f.controller.select('c2', { strict: true });
  const rejected = assert.rejects(selecting, error => error === 'chat_conflict');
  f.api.get = get;
  await f.controller.select('c1'); late.resolve(structuredClone(f.rows.get('c2'))); await rejected;
  assert.equal(f.controller.getSnapshot().selected, 'c1');
  assert.equal(f.controller.getSnapshot().error, null);
  assert.equal(await f.controller.select('c2', { strict: true }), undefined);
});
