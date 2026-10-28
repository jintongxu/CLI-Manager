import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../browser/terminalWebglLoss.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports, queueMicrotask });
function fixture() {
  let listener, recoveries = 0;
  const element = {
    addEventListener(name, fn, capture) { assert.equal(name, 'webglcontextlost'); assert.equal(capture, true); listener = fn; },
    removeEventListener(name, fn, capture) { assert.equal(name, 'webglcontextlost'); assert.equal(fn, listener); assert.equal(capture, true); listener = null; },
  };
  const stop = exports.watchTerminalWebglLoss(element, () => recoveries++);
  return { stop, lose() { const event = new Event('webglcontextlost', { cancelable: true }); listener(event); assert.equal(event.defaultPrevented, true); }, count: () => recoveries };
}
test('loss falls back after dispatch without waiting three seconds, coalescing repeated events', async () => {
  const f = fixture(); f.lose(); f.lose(); assert.equal(f.count(), 0);
  await Promise.resolve(); assert.equal(f.count(), 1); f.stop();
});
test('unmount or renderer disposal cancels queued recovery', async () => {
  const f = fixture(); f.lose(); f.stop(); await Promise.resolve(); assert.equal(f.count(), 0);
});
test('new renderer watcher is independent of disposed generation', async () => {
  const old = fixture(); old.lose(); old.stop();
  const next = fixture(); next.lose(); await Promise.resolve();
  assert.equal(old.count(), 0); assert.equal(next.count(), 1); next.stop();
});
