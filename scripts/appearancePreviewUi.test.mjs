import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, deps = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { exports, console, require(name) {
    if (!(name in deps)) throw Error(`Unexpected dependency: ${name}`);
    return deps[name];
  } });
  return exports;
}
const { createAppearanceTransaction } = load('src/shared/preferences/appearanceTransaction.ts');
const sessionModule = load('src/features/settings/lib/appearancePreviewSession.ts');
const tick = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(persist = async () => {}) {
  let state = { theme: 'system', lightThemePalette: 'warm-paper', darkThemePalette: 'graphite', terminalThemeMode: 'system', terminalThemeName: 'custom', language: 'en-US', uiTextColor: '#abcdef', fontSize: 17 };
  const baseline = { ...state };
  const writes = [];
  const tx = createAppearanceTransaction({ ready: () => true, read: () => state,
    apply: values => { state = { ...state, ...values }; }, persist: async (k, v) => { writes.push([k, v]); await persist(k, v, writes.length); } });
  const errors = [];
  const session = sessionModule.createAppearancePreviewSession(tx, e => errors.push(e));
  session.setEnabled(true);
  return { tx, session, writes, errors, baseline, get: () => state, updateLanguage: () => { state.language = 'zh-CN'; } };
}

test('real transaction preview switches both complete schemes without persistence; cancel preserves unrelated settings', async () => {
  const s = setup();
  await s.session.preview('storm');
  assert.equal(s.get().theme, 'dark');
  assert.equal(s.get().terminalThemeName, 'tokyoNightStormOfficial');
  await s.session.preview('seaSalt');
  assert.equal(s.get().theme, 'light');
  assert.equal(s.get().lightThemePalette, 'sea-salt');
  assert.equal(s.get().terminalThemeMode, 'independent');
  assert.equal(s.get().terminalThemeName, 'tokyoNightStorm');
  assert.equal(s.writes.length, 0);
  s.updateLanguage();
  await s.session.cancel();
  assert.equal(s.get().theme, s.baseline.theme);
  assert.equal(s.get().darkThemePalette, s.baseline.darkThemePalette);
  assert.equal(s.get().language, 'zh-CN');
  assert.equal(s.get().uiTextColor, '#abcdef');
});

test('pending begin after programmatic close cannot leak ownership or affect reopened session', async () => {
  const gate = deferred();
  const s = setup(async () => gate.promise);
  const write = s.tx.write(() => ({ theme: 'light' }));
  const preview = s.session.preview('storm');
  s.session.setEnabled(false);
  s.session.setEnabled(true);
  const next = s.session.preview('seaSalt');
  gate.resolve();
  await Promise.all([write, preview, next]);
  assert.equal(s.get().theme, 'light');
  assert.equal(s.get().lightThemePalette, 'sea-salt');
  assert.equal(s.session.getSnapshot().phase, 'previewing');
  await s.session.cancel();
  assert.equal(s.get().theme, 'light', 'baseline follows prior committed setter');
});

test('confirm then unmount/close waits safely and retains a successful save', async () => {
  const gate = deferred();
  const s = setup(async () => gate.promise);
  await s.session.preview('storm');
  const confirm = s.session.confirm();
  s.session.setEnabled(false);
  await tick();
  assert.equal(s.tx.getStatus().phase, 'confirming');
  gate.resolve();
  await confirm;
  await tick();
  assert.equal(s.get().theme, 'dark');
  assert.equal(s.tx.getStatus().phase, 'idle');
  assert.equal(s.errors.length, 0);
});

test('failed save on close reports once; compensation failure is not described as success', async () => {
  const gate = deferred();
  const s = setup(async () => { await gate.promise; throw Error('disk failure'); });
  await s.session.preview('storm');
  const confirm = s.session.confirm();
  s.session.setEnabled(false);
  gate.resolve();
  await confirm;
  await tick();
  assert.equal(s.get().theme, 'system');
  assert.deepEqual(s.errors, ['compensation']);
});

test('ordinary compensated save failure leaves retryable inline error', async () => {
  const s = setup(async (_k, _v, n) => { if (n === 1) throw Error('save'); });
  await s.session.preview('storm');
  await s.session.confirm();
  assert.equal(s.session.getSnapshot().error, 'save');
  assert.deepEqual(s.errors, ['save']);
  await s.session.preview('seaSalt');
  assert.equal(s.session.getSnapshot().error, null);
  await s.session.confirm();
  assert.equal(s.get().theme, 'light');
});

// Minimal deterministic React hook host: executes the complete production hook and
// button component, including effect cleanup; no declaration extraction/source assertions.
function uiHost(tx) {
  let slots = [], cursor = 0, effects = [], pending = [];
  const notifications = [];
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useSyncExternalStore(_subscribe, get) { return get(); },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((d, n) => d !== effects[i].deps[n])) pending.push(() => {
      effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
    }); },
  };
  const jsx = (type, props) => ({ type, props });
  const ui = load('src/features/settings/components/AppearancePreview.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@mantine/core': Object.fromEntries(['Button', 'Group', 'Stack', 'Text'].map(n => [n, n])),
    sonner: { toast: { error: e => notifications.push(e) } },
    '../../../shared/preferences/settingsStore': { appearancePreview: tx },
    '../../../shared/i18n': { useI18n: () => ({ t: key => key }) },
    '../lib/appearancePreviewSession': sessionModule,
  });
  return { notifications, render(active = true) { cursor = 0; const preview = ui.useAppearancePreview(active); pending.splice(0).forEach(f => f());
    const tree = ui.AppearancePreview({ preview, disabled: !active });
    const nodes = []; const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk);
      nodes.push(n); walk(n.props?.children); }; walk(tree);
    return { preview, nodes, button(key) { return nodes.find(n => n.type === 'Button' && n.props.children === `settings.general.${key}`); } }; },
    unmount() { effects.forEach(e => e?.cleanup?.()); effects = []; slots = []; },
  };
}

test('production hook/buttons: click previews, locks conflicting controls, confirms only on click; open=false cleans immediately', async () => {
  const s = setup(); const ui = uiHost(s.tx);
  let view = ui.render();
  view.button('previewStorm').props.onClick(); await tick();
  view = ui.render();
  assert.equal(view.preview.locked, true);
  assert.equal(s.writes.length, 0);
  assert.ok(view.nodes.some(n => n.props?.role === 'status'));
  view.button('previewSeaSalt').props.onClick(); await tick();
  view = ui.render();
  assert.equal(s.get().theme, 'light');
  view.button('previewConfirm').props.onClick(); await tick();
  assert.ok(s.writes.length > 0);
  view = ui.render();
  assert.equal(view.preview.locked, false);
  view.button('previewStorm').props.onClick(); await tick();
  ui.render(false); await tick();
  assert.equal(s.get().theme, 'light');
  assert.equal(s.tx.getStatus().phase, 'idle');
  ui.unmount();
});

test('production hook page-unmount and pending begin cleanup with StrictMode-style remount', async () => {
  const gate = deferred(); const s = setup(async () => gate.promise); const ui = uiHost(s.tx);
  const writing = s.tx.write(() => ({ theme: 'light' }));
  ui.render().button('previewStorm').props.onClick();
  ui.unmount();
  gate.resolve(); await writing; await tick();
  assert.equal(s.tx.getStatus().phase, 'idle');
  assert.equal(s.get().theme, 'light');
  ui.render().button('previewSeaSalt').props.onClick(); await tick();
  assert.equal(s.tx.getStatus().phase, 'previewing');
  ui.unmount(); await tick();
  assert.equal(s.tx.getStatus().phase, 'idle');
});

test('production hook confirm-inflight close disables actions and surfaces compensation failure after unmount', async () => {
  const gate = deferred();
  const s = setup(async () => { await gate.promise; throw Error('disk'); });
  const ui = uiHost(s.tx);
  ui.render().button('previewStorm').props.onClick(); await tick();
  ui.render().button('previewConfirm').props.onClick(); await tick();
  const view = ui.render();
  for (const key of ['previewStorm', 'previewSeaSalt', 'previewConfirm', 'previewCancel']) {
    assert.equal(view.button(key).props.disabled, true);
  }
  ui.render(false);
  ui.unmount();
  gate.resolve(); await tick();
  assert.equal(s.get().theme, 'system');
  assert.deepEqual(ui.notifications, ['settings.general.previewCompensationFailed']);
});
