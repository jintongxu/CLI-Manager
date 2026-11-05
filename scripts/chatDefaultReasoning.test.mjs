import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './chatHarness.mjs';

function fixture() {
  const values = new Map(), slots = [];
  let index = 0, effects = [];
  const settings = { loaded: false, chatDefaultReasoningEffort: 'high' };
  const react = {
    useState(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = initial;
      return [slots[key], next => { slots[key] = next; }];
    },
    useEffect(fn, deps) {
      const key = index++, old = slots[key];
      if (!old || deps.some((value, n) => value !== old[n])) { slots[key] = deps; effects.push(fn); }
    },
  };
  const { useConversationReasoning } = load('src/features/chat/hooks/useConversationReasoning.ts', {
    react,
    '../../../shared/preferences/settingsStore': { useSettingsStore: selector => selector(settings) },
  }, { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  return { settings, values, render(id, defaults) {
    index = 0; effects = [];
    const result = useConversationReasoning(id, defaults);
    effects.forEach(fn => fn());
    return result;
  } };
}

test('default reasoning waits for settings and seeds each conversation once without overwriting choices', () => {
  const f = fixture();
  f.render('first'); assert.equal(f.values.size, 0);
  f.settings.loaded = true;
  f.render('first'); assert.equal(f.render('first')[0], 'high');
  f.settings.chatDefaultReasoningEffort = 'max';
  f.render('first'); assert.equal(f.render('first')[0], 'high');
  f.render('second'); assert.equal(f.render('second')[0], 'max');
  f.render('second')[1]('xhigh');
  f.render('first'); f.render('second'); assert.equal(f.render('second')[0], 'xhigh');
});

test('quick window uses authoritative default after readiness, not stale local settings', () => {
  const f = fixture(); f.settings.loaded = true;
  f.render('quick', { loaded: false, effort: 'max' }); assert.equal(f.values.size, 0);
  f.render('quick', { loaded: true, effort: 'max' });
  assert.equal(f.render('quick', { loaded: true, effort: 'max' })[0], 'max');
  f.render('quick', { loaded: true, effort: 'medium' });
  assert.equal(f.render('quick', { loaded: true, effort: 'medium' })[0], 'max');
});

test('default preference normalizes malformed persisted values to medium', () => {
  const { normalizeChatDefaultReasoningEffort: normalize } = load('src/shared/preferences/chatDefaultReasoning.ts');
  for (const level of ['medium', 'high', 'xhigh', 'max']) assert.equal(normalize(level), level);
  for (const value of [null, undefined, {}, 'invalid', 0]) assert.equal(normalize(value), 'medium');
});
