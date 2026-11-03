import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './chatHarness.mjs';

const capabilities = load('src/features/chat/lib/reasoningCapabilities.ts');

test('reasoning levels follow the provider protocol instead of one global list', () => {
  const { reasoningLevelsFor } = capabilities;
  for (const protocol of ['anthropic_messages', 'openai_responses', 'openai_chat', null]) {
    assert.deepEqual([...reasoningLevelsFor(protocol, 'gpt-5.6-sol')],
      ['medium', 'high', 'xhigh', 'max']);
  }
});

test('anthropic levels expose the token budget they map to', () => {
  const { reasoningTokenBudget, isBudgetProtocol } = capabilities;
  assert.equal(isBudgetProtocol('anthropic_messages'), true);
  assert.equal(isBudgetProtocol('openai_chat'), false);
  assert.equal(reasoningTokenBudget('minimal'), null);
  assert.equal(reasoningTokenBudget('low'), 1024);
  assert.equal(reasoningTokenBudget('medium'), 2048);
  assert.equal(reasoningTokenBudget('high'), 4096);
  assert.equal(reasoningTokenBudget('xhigh'), 8192);
  assert.equal(reasoningTokenBudget('max'), 16384);
});

test('removed values normalize to medium while remaining levels retain their value', () => {
  const { normalizeReasoningFor } = capabilities;
  for (const protocol of ['anthropic_messages', 'openai_chat', null]) {
    for (const old of ['off', 'minimal', 'low']) {
      assert.equal(normalizeReasoningFor(protocol, 'model', old), 'medium');
    }
    for (const allowed of ['medium', 'high', 'xhigh', 'max']) {
      assert.equal(normalizeReasoningFor(protocol, 'model', allowed), allowed);
    }
  }
});

test('rust accepts the extended scale and budgets anthropic thinking above the API minimum', () => {
  const stream = readFileSync('src-tauri/src/features/chat/stream.rs', 'utf8');
  assert.match(stream, /"minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"/);
  assert.match(stream, /"xhigh" => Some\(8192\)/);
  assert.match(stream, /"max" => Some\(16384\)/);
  const quickChat = readFileSync('src-tauri/src/features/quick_chat/mod.rs', 'utf8');
  assert.match(quickChat, /enum Reasoning \{\s*Off,\s*Minimal,\s*Low,\s*Medium,\s*High,\s*Xhigh,\s*Max,/);
});

test('pill renders model-aware options with budget hints and keeps the shared prefix label', () => {
  const pill = readFileSync('src/features/chat/components/ChatReasoningPill.tsx', 'utf8');
  assert.match(pill, /reasoningLevelsFor\(protocol, modelId\)/);
  assert.match(pill, /isBudgetProtocol\(protocol\)/);
  assert.match(pill, /reasoningTokenBudget\(level\)/);
  assert.match(pill, /chat\.panel\.reasoningTokens/);
  assert.match(pill, /chat\.panel\.reasoningPrefix/);
  assert.match(pill, /chat-reasoning-pill-icon/);
  assert.match(pill, /SelectPrimitive\.ItemIndicator/);
});
