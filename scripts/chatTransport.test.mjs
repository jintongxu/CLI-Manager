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
      if (command === 'chat_generate' || command === 'chat_fork_edit') args.onEvent.onmessage({ content: 'early' });
      if (command === 'chat_asset_read') return new ArrayBuffer(3);
      if (command === 'chat_asset_stage') return { stageId: 'stage', mediaType: 'image/png', byteLength: args.byteLength, width: 1, height: 1 };
      return command === 'chat_list' ? [] : {};
    } },
  }, { ArrayBuffer, Uint8Array });
  await api.initialize(); await api.providers(); await api.list('literal %_', 50); await api.get('c'); await api.create();
  await api.update({ conversationId: 'c', revision: 4, draft: 'draft' }); await api.delete('c', 5);
  const bytes = new Uint8Array([1, 2, 3]);
  const staged = await api.stage(bytes); await api.releaseAssets(['stage']);
  const read = await api.readAsset({ conversationId: 'c', messageId: 'm', ordinal: 0, assetId: 'a' });
  await api.generate({ conversationId: 'c', revision: 6, requestId: 'r', appType: 'claude', providerId: 'p', model: 'm', text: 'hello', retry: false, stageIds: ['stage'] }, e => { received = e; });
  await api.forkEdit({ sourceConversationId: 'c', sourceRevision: 7, targetMessageId: 'u', operationId: 'o', requestId: 'fr', appType: 'claude', providerId: 'p', model: 'm', text: 'edit', stageIds: ['stage'] }, e => { received = e; });
  await api.cancel('c', 'r'); await api.flush([]);
  assert.equal(received.content, 'early'); assert.equal(staged.stageId, 'stage'); assert.ok(read instanceof ArrayBuffer);
  assert.equal(calls.map(c => c[0]).join(','), 'chat_initialize,chat_provider_options,chat_list,chat_get,chat_create,chat_update,chat_delete,chat_asset_stage,chat_asset_release,chat_asset_read,chat_generate,chat_fork_edit,chat_cancel,chat_flush_drafts');
  assert.equal(JSON.stringify(calls[2][1]), JSON.stringify({ input: { search: 'literal %_', offset: 50 } }));
  assert.equal(JSON.stringify(calls[8][1]), '{"input":{"stageIds":["stage"]}}');
  assert.equal(JSON.stringify(calls[13][1]), '{"input":{"drafts":[]}}');
  assert.ok(calls[7][1] instanceof Uint8Array, 'stage request is raw Uint8Array, not JSON');
  assert.equal(Object.keys(calls[10][1]).sort().join(','), 'input,onEvent');
  assert.deepEqual(calls[10][1].input.stageIds, ['stage']);
  assert.equal(Object.keys(calls[11][1]).sort().join(','), 'input,onEvent');
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
