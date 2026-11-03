import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fixture, tick } from './chatHarness.mjs';

function store() {
  const map = new Map();
  return { map, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), clear: () => map.clear() };
}

test('reasoning defaults to medium and legacy low/off choices resolve to the new medium floor', () => {
  const shim = store();
  const mod = load('src/features/chat/lib/reasoning.ts', {}, { localStorage: shim });
  assert.equal(mod.readReasoning('c1'), 'medium');
  mod.persistReasoning('c1', 'high');
  mod.persistReasoning('c2', 'low');
  assert.equal(mod.readReasoning('c1'), 'high');
  assert.equal(mod.readReasoning('c2'), 'medium');
  assert.equal(mod.readReasoning('c3'), 'medium');
  mod.persistReasoning('c1', 'off');
  assert.equal(mod.readReasoning('c1'), 'medium');
  assert.deepEqual(JSON.parse(shim.getItem(mod.CHAT_REASONING_STORAGE_KEY)), { c1: 'off', c2: 'low' });
  shim.setItem(mod.CHAT_REASONING_STORAGE_KEY, JSON.stringify({ c4: 'turbo' }));
  assert.equal(mod.readReasoning('c4'), 'medium');
  shim.setItem(mod.CHAT_REASONING_STORAGE_KEY, 'not json');
  assert.equal(mod.readReasoning('c2'), 'medium');
});

test('generate forwards the selected reasoning level and omits it when off', async () => {
  const f = fixture();
  await f.controller.start();
  await f.controller.select('c1');
  f.controller.setDraft('c1', 'hello');
  const p1 = f.controller.generate('c1', false, 'high');
  await tick();
  const high = f.calls.filter(c => c[0] === 'generate').at(-1)[1];
  assert.equal(high.reasoning, 'high');
  f.emit(high.requestId, { status: 'completed', saved: true, content: 'done' });
  await p1;
  await tick();

  f.controller.setDraft('c1', 'next');
  const p2 = f.controller.generate('c1', false, 'off');
  await tick();
  const off = f.calls.filter(c => c[0] === 'generate').at(-1)[1];
  assert.equal(off.reasoning, null);
  f.emit(off.requestId, { status: 'completed', saved: true, content: 'done' });
  await p2;
  await tick();
});
