import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './chatHarness.mjs';

const mod = load('src/features/chat/lib/conversationOrder.ts', {});
// Cross-realm arrays from the vm context do not share the host Array prototype.
const ids = (rows) => Array.from(rows, r => (typeof r === 'string' ? r : r.id));
const move = (order, from, to) => { const r = mod.moveWithinOrder(order, from, to); return r === null ? null : Array.from(r); };
const apply = (rows, order) => ids(mod.applyStoredOrder(rows, order));

test('moveWithinOrder moves a chat to the target slot and rejects no-ops', () => {
  assert.deepEqual(move(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(move(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  assert.equal(move(['a', 'b'], 'a', 'a'), null);
  assert.equal(move(['a', 'b'], 'x', 'a'), null);
  assert.equal(move([], 'a', 'b'), null);
});

test('applyStoredOrder respects saved order and keeps new chats reachable', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(apply(rows, ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.deepEqual(apply(rows, null), ['a', 'b', 'c']);
  // A chat created after the saved order must still be listed, ahead of saved rows.
  assert.deepEqual(apply([...rows, { id: 'd' }], ['c', 'a', 'b']), ['d', 'c', 'a', 'b']);
  // Ids from other windows/removed chats are ignored.
  assert.deepEqual(apply(rows, ['gone', 'b', 'a']), ['c', 'b', 'a']);
});

test('pinned conversations stay first while preserving manual order within each group', () => {
  const { applyPinnedOrder } = load('src/features/chat/lib/conversationOrder.ts', {});
  const ids = (rows, pins) => Array.from(applyPinnedOrder(rows.map(id => ({ id })), pins), row => row.id);
  assert.deepEqual(ids(['a', 'b', 'c', 'd'], ['c', 'a']), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids(['a', 'b', 'c'], ['deleted', 'b']), ['b', 'a', 'c']);
});

test('moveIndexWithinOrder previews the live drag slot deterministically', () => {
  const mod = load('src/features/chat/lib/conversationOrder.ts', {});
  const byIndex = (order, from, to) => {
    const r = mod.moveIndexWithinOrder(order, from, to);
    return r === null ? null : Array.from(r);
  };
  // Dragging down: the row lands on the projected slot, not one past it.
  assert.deepEqual(byIndex(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(byIndex(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(byIndex(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.equal(byIndex(['a', 'b'], 1, 1), null);
  assert.equal(byIndex(['a'], 3, 0), null);
});
