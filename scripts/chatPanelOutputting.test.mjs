import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { load, elements } from './chatHarness.mjs';

const { ChatPanelMessages } = load('src/features/chat/components/ChatPanelMessages.tsx', {
  react: { useRef: value => ({ current: value }), useEffect() {} },
  '@tauri-apps/plugin-opener': { openUrl() {} },
  '@tauri-apps/plugin-clipboard-manager': { writeText() {} },
  'lucide-react': { Sparkles: () => null },
  '../../../shared/ui/MarkdownContent': { MarkdownContent: () => null },
  '../../../shared/i18n/index': { useI18n: () => ({ t: key => key, language: 'en-US' }) },
});

test('shared sidebar/quick messages show pending output and remove it on every terminal state', () => {
  for (const status of ['pending', 'completed', 'stopped', 'failed', 'interrupted']) {
    const tree = ChatPanelMessages({
      messages: [{ id: 'a', role: 'assistant', status, content: 'partial', createdAt: 1 }],
      conversationId: 'c', copiedId: null, onCopied() {}, onRetry() {}, report() {},
    });
    const indicators = elements(tree).filter(node => node.props?.['data-status'] === 'pending');
    assert.equal(indicators.length, status === 'pending' ? 1 : 0);
    if (status === 'pending') assert.equal(indicators[0].props.children, 'chat.pending');
  }
});

test('pending panel status remains visible without hover and respects reduced motion', () => {
  const root = postcss.parse(readFileSync('src/features/chat/components/chatPanel.css', 'utf8'));
  const rules = [];
  root.walkRules(rule => rules.push(rule));
  const visible = rules.find(rule => rule.selector === '.chat-panel-message-meta:has(.chat-panel-status[data-status="pending"])');
  assert.ok(visible?.nodes.some(node => node.prop === 'opacity' && node.value === '1'));
  const dot = rules.find(rule => rule.selector === '.chat-panel-status[data-status="pending"]::before');
  assert.ok(dot?.nodes.some(node => node.prop === 'animation' && node.value.includes('chat-panel-pulse')));
  assert.ok(rules.some(rule => rule.selector === dot.selector
    && rule.parent.type === 'atrule' && rule.parent.params === '(prefers-reduced-motion: reduce)'
    && rule.nodes.some(node => node.prop === 'animation' && node.value === 'none')));
});
