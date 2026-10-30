import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './chatHarness.mjs';

test('draft status is scoped per conversation and typing starts as debouncing', async () => {
  const f = fixture(); await f.controller.start();
  f.controller.setDraft('c1', 'local');
  assert.equal(f.controller.getSnapshot().draftStatus.c1, 'debouncing');
  assert.equal(f.controller.getSnapshot().draftStatus.c2, undefined);
  await f.controller.flushDraft('c1');
  assert.equal(f.controller.getSnapshot().draftStatus.c1, 'clean');
});

test('Pi discovery is safe empty contract without documented config', async () => {
  const source = await (await import('node:fs/promises')).readFile('src/features/chat/lib/piDiscovery.ts', 'utf8');
  assert.match(source, /return \[\];/);
  assert.match(source, /unavailable-no-documented-safe-config/);
});

test('layout contract has a drawer toggle and no third rail', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile('src/features/chat/components/chatWorkspace.css', 'utf8');
  const ui = await fs.readFile('src/features/chat/api/ChatWorkspace.tsx', 'utf8');
  assert.match(css, /width: clamp\(220px, 23vw, 300px\)/);
  assert.match(css, /chat-history-open/);
  assert.match(ui, /aria-controls=\"chat-history\"/);
  assert.doesNotMatch(css, /third-rail/i);
});
