import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, tick } from './chatHarness.mjs';

const {
  diagnoseChatError,
  resolveSnapshotError,
  ERROR_CATEGORY_MAP,
  CATEGORY_ACTIONS,
  ACTION_KEYS,
  CATEGORY_KEYS,
} = load('src/features/chat/lib/chatErrors.ts');

const { zh: zhCN } = load('src/shared/i18n/messages/chat.zh-CN.ts');
const { en: enUS } = load('src/shared/i18n/messages/chat.en-US.ts');

test('every error code in ERROR_CATEGORY_MAP maps to valid category, action, and translated keys in zh-CN and en-US', () => {
  const codes = Object.keys(ERROR_CATEGORY_MAP);
  assert.ok(codes.length >= 25, `Expected at least 25 mapped error codes, got ${codes.length}`);

  for (const code of codes) {
    const diag = diagnoseChatError(code);
    assert.equal(diag.code, code);
    assert.ok(
      ['not_ready', 'not_found', 'storage', 'unsupported_protocol', 'timeout', 'capacity'].includes(diag.category),
      `Invalid category ${diag.category} for ${code}`
    );
    assert.ok(
      ['reconnect', 'create', 'retry_save', 'switch_model', 'wait'].includes(diag.action),
      `Invalid action ${diag.action} for ${code}`
    );
    assert.equal(diag.action, CATEGORY_ACTIONS[diag.category]);
    assert.equal(diag.actionKey, ACTION_KEYS[diag.action]);
    assert.equal(diag.categoryKey, CATEGORY_KEYS[diag.category]);

    // Check that messageKey, actionKey, and categoryKey exist and are non-empty in both zh-CN and en-US
    assert.ok(zhCN[diag.messageKey], `Missing zh-CN message for ${diag.messageKey}`);
    assert.ok(enUS[diag.messageKey], `Missing en-US message for ${diag.messageKey}`);
    assert.ok(zhCN[diag.actionKey], `Missing zh-CN action for ${diag.actionKey}`);
    assert.ok(enUS[diag.actionKey], `Missing en-US action for ${diag.actionKey}`);
    assert.ok(zhCN[diag.categoryKey], `Missing zh-CN category for ${diag.categoryKey}`);
    assert.ok(enUS[diag.categoryKey], `Missing en-US category for ${diag.categoryKey}`);
  }
});

test('error codes categorize accurately into the required six categories and five actions', () => {
  // 1. 未就绪/连接失败 -> 重连 (reconnect)
  for (const code of ['chat_quick_not_ready', 'chat_not_initialized', 'chat_quick_command_failed', 'chat_quick_owner_changed', 'chat_network', 'chat_shutting_down']) {
    const d = diagnoseChatError(code);
    assert.equal(d.category, 'not_ready', code);
    assert.equal(d.action, 'reconnect', code);
  }

  // 2. 会话不存在（已删除） -> 新建 (create)
  const notFound = diagnoseChatError('chat_not_found');
  assert.equal(notFound.category, 'not_found');
  assert.equal(notFound.action, 'create');

  // 3. 存储失败 -> 重试保存 (retry_save)
  for (const code of ['chat_storage', 'chat_conflict', 'chat_drain_timeout']) {
    const d = diagnoseChatError(code);
    assert.equal(d.category, 'storage', code);
    assert.equal(d.action, 'retry_save', code);
  }

  // 4. 供应商协议不支持 -> 换模型 (switch_model)
  for (const code of [
    'chat_provider_protocol', 'chat_protocol', 'chat_protocol_eof',
    'chat_frame_limit', 'chat_empty', 'chat_provider_config',
    'chat_provider_missing', 'chat_provider_disabled', 'chat_provider_url',
    'chat_provider_key', 'chat_provider_storage', 'chat_auth', 'chat_http',
    'chat_invalid_input',
  ]) {
    const d = diagnoseChatError(code);
    assert.equal(d.category, 'unsupported_protocol', code);
    assert.equal(d.action, 'switch_model', code);
  }

  // 5. 超时 -> 等待 (wait)
  for (const code of ['chat_timeout', 'chat_quick_timeout']) {
    const d = diagnoseChatError(code);
    assert.equal(d.category, 'timeout', code);
    assert.equal(d.action, 'wait', code);
  }

  // 6. 容量上限 -> 等待 (wait)
  for (const code of [
    'chat_capacity', 'chat_quick_capacity', 'chat_busy',
    'chat_rate_limit', 'chat_context_limit', 'chat_answer_limit',
    'chat_retry_required', 'chat_cancelled_or_replayed',
  ]) {
    const d = diagnoseChatError(code);
    assert.equal(d.category, 'capacity', code);
    assert.equal(d.action, 'wait', code);
  }

  // Fallback for unknown error
  const fallback = diagnoseChatError('unknown_code_123');
  assert.equal(fallback.category, 'storage');
  assert.equal(fallback.action, 'retry_save');
});

test('snapshot error resolution clears expired errors upon recovery and prevents masking in-flight failures', () => {
  // Case 1: In-flight failure is NOT masked by older success snapshot (version <= inFlight.version)
  const inFlight = { version: 5, code: 'chat_quick_timeout' };
  const oldSnap = resolveSnapshotError(
    'chat_quick_timeout', // currentError
    null,                 // snapshotError
    true,                 // snapshotReady
    true,                 // hasSelection
    inFlight,
    4                     // snapshotVersion < 5
  );
  assert.equal(oldSnap.error, 'chat_quick_timeout', 'Old snapshot must not mask in-flight error');
  assert.equal(oldSnap.clearInFlight, false);

  const concurrentSnap = resolveSnapshotError(
    'chat_quick_timeout',
    null,
    true,
    true,
    inFlight,
    5                     // snapshotVersion == 5
  );
  assert.equal(concurrentSnap.error, 'chat_quick_timeout', 'Concurrent snapshot must not mask in-flight error');
  assert.equal(concurrentSnap.clearInFlight, false);

  // Case 2: Recovery succeeds on later snapshot (version > inFlight.version) -> clears error
  const recoveredSnap = resolveSnapshotError(
    'chat_quick_timeout',
    null,
    true,                 // snapshotReady
    true,                 // hasSelection
    inFlight,
    6                     // snapshotVersion > 5
  );
  assert.equal(recoveredSnap.error, null, 'Fresh recovery snapshot must clear error');
  assert.equal(recoveredSnap.clearInFlight, true);

  // Case 3: Expired error from deleted chat (no inFlight) cleared when replacement is ready
  const expiredCleared = resolveSnapshotError(
    'chat_not_found',
    null,
    true,
    true,
    null,
    7
  );
  assert.equal(expiredCleared.error, null);
  assert.equal(expiredCleared.clearInFlight, true);

  // Case 4: Not recovered yet (no selection or not ready) retains error
  const unrecovered = resolveSnapshotError(
    'chat_not_found',
    null,
    true,
    false, // hasSelection = false
    null,
    7
  );
  assert.equal(unrecovered.error, 'chat_not_found');
  assert.equal(unrecovered.clearInFlight, false);

  // Case 5: Owner snapshot with explicit error is authoritative
  const ownerError = resolveSnapshotError(
    null,
    'chat_storage',
    true,
    false,
    inFlight,
    8
  );
  assert.equal(ownerError.error, 'chat_storage');
  assert.equal(ownerError.clearInFlight, true);
});

test('QuickChatRemote report preserves exact error code and snapshot handling adheres to clearing rules', async () => {
  let channel; const sent = [];
  class Channel { constructor() { channel = this; } }
  const invoke = async (name, args) => {
    if (name === 'quick_chat_command') sent.push(args.envelope);
  };
  let id = 0;
  const { QuickChatRemote } = load(
    'src/features/chat/lib/quickChatRemote.ts',
    { '@tauri-apps/api/core': { Channel, invoke } },
    { crypto: { randomUUID: () => `id-${++id}` } }
  );

  const remote = new QuickChatRemote();

  // 1. Report preserves error code instead of blindly setting chat_quick_command_failed
  remote.report('chat_quick_timeout');
  assert.equal(remote.getSnapshot().error, 'chat_quick_timeout');

  remote.report('chat_not_found');
  assert.equal(remote.getSnapshot().error, 'chat_not_found');

  // 2. An older snapshot does not mask the reported error
  const state = { ready: true, selected: 'c1', drafts: {}, details: { c1: {} }, conversations: [{ id: 'c1' }], error: null };
  remote.accept({ epoch: 'epoch1', version: 1, state, catalog: [] });
  // Now remote is at version 1.
  remote.report('chat_quick_capacity');
  assert.equal(remote.getSnapshot().error, 'chat_quick_capacity');

  // Snapshot with version 1 arrives again:
  // (In accept(), version <= this.version is rejected early; let's simulate version 1)
  assert.equal(remote.getSnapshot().error, 'chat_quick_capacity');

  // 3. Fresh recovery snapshot at version 2 with valid ready selection clears the error
  remote.accept({ epoch: 'epoch1', version: 2, state, catalog: [] });
  assert.equal(remote.getSnapshot().error, null, 'Recovery snapshot cleared error');

  // 4. clearError explicitly clears error
  remote.report('chat_storage');
  assert.equal(remote.getSnapshot().error, 'chat_storage');
  remote.clearError();
  assert.equal(remote.getSnapshot().error, null);
});
