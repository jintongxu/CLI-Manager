import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tick, deferred, ChatController } from './chatHarness.mjs';

test('250ms debounce coalesces drafts; explicit flush and rehydrate retain exact text', async () => {
  const f = fixture(); await f.controller.start();
  for (let n = 0; n < 10; n++) f.controller.setDraft('c1', `draft-${n}`);
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 0);
  await new Promise(resolve => setTimeout(resolve, 280)); await tick();
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 1);
  assert.equal(f.rows.get('c1').conversation.draft, 'draft-9');
  f.controller.setDraft('c1', 'switch'); await f.controller.select('c2'); await f.controller.flush();
  const restored = new ChatController(f.api); await restored.start();
  assert.equal(restored.getSnapshot().drafts.c1, 'switch');
});
test('in-flight draft save cannot overwrite newer editing; serialized CAS and final flush win', async () => {
  const f = fixture(); await f.controller.start(); const held = deferred(), original = f.api.update;
  let first = true; f.api.update = async input => { if (first) { first = false; await held.promise; } return original(input); };
  f.controller.setDraft('c1', 'first'); const saving = f.controller.flushDraft('c1'); await tick();
  f.controller.setDraft('c1', 'newer'); held.resolve(); await saving;
  assert.equal(f.controller.getSnapshot().drafts.c1, 'newer');
  await f.controller.flush(); assert.equal(f.rows.get('c1').conversation.draft, 'newer');
});
test('storage failure stays dirty; explicit retry saves without any model request', async () => {
  const f = fixture(); await f.controller.start(); f.failUpdate(true); f.controller.setDraft('c1', 'retain');
  await assert.rejects(f.controller.flush()); assert.equal(f.controller.getSnapshot().dirty.includes('c1'), true);
  assert.equal(f.controller.getSnapshot().drafts.c1, 'retain');
  f.failUpdate(false); await f.controller.retryPersistence();
  assert.equal(f.rows.get('c1').conversation.draft, 'retain'); assert.equal(f.calls.some(c => c[0] === 'generate'), false);
});
test('CAS conflict refreshes base without replacing draft, retries only on explicit action', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setDraft('c1', 'my draft');
  f.rows.get('c1').conversation.revision++; f.rows.get('c1').conversation.draft = 'other window';
  await assert.rejects(f.controller.flushDraft('c1'));
  assert.equal(f.controller.getSnapshot().drafts.c1, 'my draft');
  assert.equal(f.rows.get('c1').conversation.draft, 'other window');
  await f.controller.retryPersistence(); assert.equal(f.rows.get('c1').conversation.draft, 'my draft');
});
test('unsaved terminal snapshot blocks exit/send; empty backend flush acknowledgement refreshes it', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setDraft('c1', 'hello'); await f.controller.generate('c1');
  f.emit('r1', { status: 'failed', errorCode: 'chat_storage', content: 'retained partial', saved: false }); await tick();
  assert.equal(f.controller.getSnapshot().details.c1.messages.at(-1).content, 'retained partial');
  await assert.rejects(f.controller.flush()); await assert.rejects(f.controller.generate('c1', true));
  f.failFlush(true); await assert.rejects(f.controller.retryPersistence());
  assert.ok(f.controller.getSnapshot().unsaved.c1);
  f.failFlush(false);
  const stored = f.rows.get('c1'); Object.assign(stored.messages.at(-1), { status: 'failed', content: 'retained partial' }); stored.conversation.requestId = null;
  await f.controller.retryPersistence(); assert.equal(f.controller.getSnapshot().unsaved.c1, undefined);
  assert.equal(f.calls.filter(c => c[0] === 'generate').length, 1);
});
test('suspend freezes edits/new requests; flush persists drafts; resume never retransmits', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setDraft('c1', 'exit draft'); f.controller.suspend();
  assert.throws(() => f.controller.setDraft('c1', 'no')); await assert.rejects(f.controller.generate('c1'));
  await f.controller.flush(); assert.equal(f.rows.get('c1').conversation.draft, 'exit draft');
  f.controller.resume(); f.controller.setDraft('c1', 'after abort'); await f.controller.flush();
  assert.equal(f.calls.some(c => c[0] === 'generate'), false);
});
