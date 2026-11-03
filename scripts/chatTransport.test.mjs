import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './chatHarness.mjs';

test('executable Tauri adapter uses exact command envelopes and registers channel before invoke', async () => {
  const calls = []; let received;
  class Channel { onmessage; }
  const { chatTransport: api } = load('src/features/chat/lib/transport.ts', {
    '../../../shared/platform/db': { getDb: async () => ({}) },
    '@tauri-apps/api/core': { Channel, invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'chat_generate') args.onEvent.onmessage({ content: 'early' });
      return command === 'chat_list' ? [] : {};
    } },
  });
  await api.initialize(); await api.providers(); await api.list('literal %_', 50); await api.get('c'); await api.create();
  await api.update({ conversationId: 'c', revision: 4, draft: 'draft' }); await api.delete('c', 5);
  await api.generate({ conversationId: 'c', revision: 6, requestId: 'r', appType: 'claude', providerId: 'p', model: 'm', text: 'hello', retry: false }, e => { received = e; });
  await api.cancel('c', 'r'); await api.flush([]);
  assert.equal(received.content, 'early');
  assert.equal(calls.map(c => c[0]).join(','), 'chat_initialize,chat_provider_options,chat_list,chat_get,chat_create,chat_update,chat_delete,chat_generate,chat_cancel,chat_flush_drafts');
  assert.equal(JSON.stringify(calls[2][1]), JSON.stringify({ input: { search: 'literal %_', offset: 50 } }));
  assert.equal(JSON.stringify(calls[9][1]), '{"input":{"drafts":[]}}');
  assert.equal(Object.keys(calls[7][1]).sort().join(','), 'input,onEvent');
});

test('database first-load failure stays rejected in-process and never consumes plugin migrations twice', async () => {
  let repairs = 0, loads = 0;
  const failure = Error('migration 55 checksum mismatch');
  const { getDb } = load('src/shared/platform/db.ts', {
    '@tauri-apps/api/core': { invoke: async () => { repairs++; } },
    '@tauri-apps/plugin-sql': { default: { load: async () => { loads++; if (loads === 1) throw failure; return {}; } } },
    './appPaths': { getCliManagerDataPaths: async () => ({ dbUrl: 'sqlite:synthetic' }) },
    './logger': { logWarn: () => {} },
  });
  await assert.rejects(getDb(), e => e === failure);
  await assert.rejects(getDb(), e => e === failure);
  assert.equal(loads, 1); assert.equal(repairs, 1);
});
test('database failure prevents adapter initialization IPC', async () => {
  let calls = 0;
  const { chatTransport } = load('src/features/chat/lib/transport.ts', {
    '../../../shared/platform/db': { getDb: async () => { throw Error('migration failed'); } },
    '@tauri-apps/api/core': { Channel: class {}, invoke: async () => { calls++; } },
  });
  await assert.rejects(chatTransport.initialize(), /migration failed/);
  assert.equal(calls, 0);
});
