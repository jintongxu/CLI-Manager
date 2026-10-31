import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTs(relativePath, dependencies = {}, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    { exports, performance, ...globals, require: id => dependencies[id] }
  );
  return exports;
}

const languages = loadTs('../src/features/translator/lib/languages.ts');
const models = loadTs('../src/features/translator/lib/models.ts');
const crop = loadTs('../src/features/translator/lib/crop.ts');
const zhMessages = loadTs('../src/shared/i18n/messages/translator.zh-CN.ts');
const enMessages = loadTs('../src/shared/i18n/messages/translator.en-US.ts');
const rustCommands = readFileSync(
  new URL('../src-tauri/src/features/translator/commands.rs', import.meta.url),
  'utf8'
);

test('every target language resolves to a zh-CN and en-US label key', () => {
  assert.ok(languages.TRANSLATOR_TARGET_LANGUAGES.length >= 25);
  for (const code of languages.TRANSLATOR_TARGET_LANGUAGES) {
    const key = languages.translatorLanguageLabelKey(code);
    assert.ok(zhMessages.zh[key], `missing zh label for ${code} (${key})`);
    assert.ok(enMessages.en[key], `missing en label for ${code} (${key})`);
    assert.notEqual(enMessages.en[key], '', `empty en label for ${code}`);
  }
});

test('translator dictionaries stay key-compatible across locales', () => {
  assert.deepEqual(Object.keys(enMessages.en).sort(), Object.keys(zhMessages.zh).sort());
});

test('every translatable language has a backend display name', () => {
  for (const code of languages.TRANSLATOR_TARGET_LANGUAGES) {
    if (code === 'auto') continue;
    assert.ok(rustCommands.includes(`"${code}"`), `backend language_name missing ${code}`);
  }
});

test('target language resolution keeps the Kivio auto rule', () => {
  // 含中文译英、其余译中：自动模式必须由后端单一来源判定。
  assert.ok(rustCommands.includes("'\\u{4e00}'..='\\u{9fff}'"));
  assert.match(rustCommands, /if has_chinese\(text\) \{\s*"en"\.to_string\(\)\s*\} else \{\s*"zh"\.to_string\(\)/);
});

test('translation prompt preserves the professional native translation contract', () => {
  for (const requirement of [
    'You are a professional, native-level translator. Translate the text below into {lang}.',
    'LaTeX formulas',
    '<source_text>\\n{text}\\n</source_text>',
  ]) {
    assert.ok(rustCommands.includes(requirement), `prompt template lost: ${requirement}`);
  }
  assert.match(rustCommands, /\.replace\("\{lang\}", lang_full\)\s*\.replace\("\{text\}", text\)/);
  // 支持下发自定义提示词
  assert.ok(readFileSync(new URL('../src-tauri/src/features/translator/requests.rs', import.meta.url), 'utf8').includes('custom_prompt: Option<String>'));
  assert.ok(rustCommands.includes('custom_template.map'));
});

test('all three chat protocols stay wired to the configured chat model', () => {
  assert.ok(rustCommands.includes('"anthropic_messages"'));
  assert.ok(rustCommands.includes('"openai_responses"'));
  assert.ok(rustCommands.includes('"openai_chat"') || rustCommands.includes('// Default: openai_chat'));
  // 翻译必须复用设置中的对话模型，而不是独立的翻译模型配置。
  assert.ok(rustCommands.includes('FROM chat_providers'));
  assert.ok(rustCommands.includes('FROM chat_provider_models'));
  assert.ok(rustCommands.includes('FROM chat_provider_secrets'));
});

test('reasoning wrappers never leak into the translated text', () => {
  assert.ok(rustCommands.includes('strip_thinking_block'));
  assert.match(rustCommands, /let translated = strip_thinking_block\(&translated\)/);
});

test('model keys survive model ids that contain colons', () => {
  const key = models.translatorModelKey('prov-a', 'vendor:model:v2');
  const parsed = models.parseTranslatorModelKey(key);
  assert.equal(parsed.providerId, 'prov-a');
  assert.equal(parsed.modelId, 'vendor:model:v2');
  for (const invalid of ['', 'no-separator', ':::model', 'provider:::']) {
    assert.equal(models.parseTranslatorModelKey(invalid), null, invalid);
  }
});

test('an unavailable selection falls back to the default model, never to nothing', () => {
  const catalog = [
    { providerId: 'prov-a', providerName: 'Alpha', modelId: 'a-other', isDefault: false },
    { providerId: 'prov-b', providerName: 'Beta', modelId: 'b-default', isDefault: true },
  ];
  assert.equal(
    models.resolveTranslatorModel(catalog, models.translatorModelKey('prov-a', 'a-other')).modelId,
    'a-other'
  );
  for (const stale of ['', 'gone:::model', models.translatorModelKey('prov-a', 'a-off')]) {
    assert.equal(models.resolveTranslatorModel(catalog, stale).modelId, 'b-default', stale);
  }
  // 没有默认标记时退回第一项，且空目录返回 null 让界面走未配置引导。
  const noDefault = [{ providerId: 'p', providerName: 'P', modelId: 'only', isDefault: false }];
  assert.equal(models.resolveTranslatorModel(noDefault, '').modelId, 'only');
  assert.equal(models.resolveTranslatorModel([], ''), null);
});

test('normalizeRect handles reverse drag coordinates correctly', () => {
  const r1 = crop.normalizeRect(100, 200, 20, 50);
  assert.equal(r1.x, 20);
  assert.equal(r1.y, 50);
  assert.equal(r1.width, 80);
  assert.equal(r1.height, 150);

  const r2 = crop.normalizeRect(20, 50, 100, 200);
  assert.equal(r2.x, 20);
  assert.equal(r2.y, 50);
  assert.equal(r2.width, 80);
  assert.equal(r2.height, 150);
});

test('scaleRectToImage maps CSS coords to physical pixel bounding box', () => {
  // 1080p 屏幕以 2x 缩放为例 (CSS 960x540 -> 原图 1920x1080)
  const rect = crop.scaleRectToImage({ x: 10, y: 20, width: 100, height: 50 }, 960, 540, 1920, 1080);
  assert.ok(rect);
  assert.equal(rect.x, 20);
  assert.equal(rect.y, 40);
  assert.equal(rect.width, 200);
  assert.equal(rect.height, 100);

  // 面积过小的误触返回 null
  assert.equal(crop.scaleRectToImage({ x: 10, y: 10, width: 1, height: 1 }, 1000, 1000, 1000, 1000), null);
});

test('translator panel exposes the chat-model picker instead of a fixed model badge', () => {
  const panel = readFileSync(
    new URL('../src/features/translator/components/TranslatorPanel.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(panel.includes('translator_list_models') || panel.includes('loadModels'));
  // 自绘下拉框（TranslatorSelect）取代原生 <select>，避免系统风格弹层。
  assert.ok(panel.includes('TranslatorSelect'));
  assert.ok(!panel.includes('<select'), 'native select must not be used in the floating window');
  assert.ok(panel.includes('setModel'));
  // 选择的模型必须随翻译请求下发，而不是始终使用默认模型。
  const store = readFileSync(
    new URL('../src/features/translator/api/translatorStore.ts', import.meta.url),
    'utf8'
  );
  assert.ok(store.includes('providerId: model.providerId'));
  assert.ok(store.includes('modelId: model.modelId'));
  assert.ok(store.includes('translatorModelKey'));
});

test('three global translation shortcut defaults align with the spec', () => {
  const rustShortcuts = readFileSync(
    new URL('../src-tauri/src/features/translator/shortcuts.rs', import.meta.url),
    'utf8'
  );
  assert.ok(rustShortcuts.includes('DEFAULT_INPUT_HOTKEY: &str = "Alt+T"'));
  assert.ok(rustShortcuts.includes('DEFAULT_SELECTION_HOTKEY: &str = "Ctrl+Alt+T"'));
  assert.ok(rustShortcuts.includes('DEFAULT_SCREENSHOT_HOTKEY: &str = "Alt+S"'));

  const settingsStore = readFileSync(
    new URL('../src/shared/preferences/translatorSettings.ts', import.meta.url),
    'utf8'
  );
  assert.ok(settingsStore.includes('input: "Alt+T"'));
  assert.ok(settingsStore.includes('selection: "Ctrl+Alt+T"'));
  assert.ok(settingsStore.includes('screenshot: "Alt+S"'));
});

test('multimodal payload builder structures match all three protocols', () => {
  assert.ok(rustCommands.includes('build_multimodal_payload'));
  assert.ok(rustCommands.includes('"anthropic_messages"'));
  assert.ok(rustCommands.includes('"openai_responses"'));
  assert.ok(rustCommands.includes('translator_model_not_multimodal'));
});

test('translation has a dedicated settings page and stays in sync with the overlay', () => {
  const setting = readFileSync(
    new URL('../src/features/settings/components/pages/TranslatorModelSetting.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(setting.includes('translator_list_models'));
  assert.ok(setting.includes('translatorModelKey'));
  assert.ok(setting.includes('followDefault'));

  const translatorPage = readFileSync(
    new URL('../src/features/settings/components/pages/TranslatorSettingsPage.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(translatorPage.includes('TranslatorModelSetting'));
  assert.ok(translatorPage.includes('TranslatorHotkeySettings'));

  const modal = readFileSync(
    new URL('../src/features/settings/api/SettingsModal.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(modal.includes('TranslatorSettingsPage'));
  assert.ok(modal.includes('translator: {'));

  const store = readFileSync(
    new URL('../src/features/translator/api/translatorStore.ts', import.meta.url),
    'utf8'
  );
  // 设置变更必须同步到已打开的浮窗，否则两处选择会互相覆盖。
  assert.ok(store.includes('useSettingsStore.subscribe'));
  assert.ok(store.includes('selectedModelKey: state.translatorModelKey'));
});

test('independent translator and capture windows are wired into bootstrap and capabilities', () => {
  const mainTsx = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.ok(mainTsx.includes('label === "translator"'));
  assert.ok(mainTsx.includes('label === "translator-capture"'));
  assert.ok(mainTsx.includes('TranslatorWindowApp'));
  assert.ok(mainTsx.includes('CaptureWindowApp'));

  const caps = readFileSync(
    new URL('../src-tauri/capabilities/default.json', import.meta.url),
    'utf8'
  );
  assert.ok(caps.includes('"translator"'));
  assert.ok(caps.includes('"translator-capture"'));

  const shortcuts = readFileSync(
    new URL('../src-tauri/src/features/translator/shortcuts.rs', import.meta.url),
    'utf8'
  );
  // 热键触发时绝不调用 focus_main_window，只打开独立浮窗。
  assert.ok(shortcuts.includes('toggle_translator_window'));
  assert.ok(shortcuts.includes('lifecycle::begin_capture(app)'));
  assert.ok(!shortcuts.includes('focus_main_window(app)'));
});

test('standalone translator window loads the global stylesheet and theme tokens', () => {
  const translatorApp = readFileSync(
    new URL('../src/features/translator/api/TranslatorWindowApp.tsx', import.meta.url),
    'utf8'
  );
  const captureApp = readFileSync(
    new URL('../src/features/translator/api/CaptureWindowApp.tsx', import.meta.url),
    'utf8'
  );
  // 独立窗口没有 App 包装，必须自行引入 App.css，否则主题变量与浮窗样式全部缺失（透明裸奔）。
  for (const source of [translatorApp, captureApp]) {
    assert.ok(source.includes('import "../../../App.css"'), 'missing App.css import');
    assert.ok(source.includes('load()'), 'missing settings load for theme tokens');
    assert.ok(source.includes('dataset.theme'), 'missing theme dataset injection');
  }

  const css = readFileSync(
    new URL('../src/features/translator/components/translator.css', import.meta.url),
    'utf8'
  );
  // 卡片必须有坚实底色 + 模糊，不能只靠透明背景。
  assert.ok(css.includes('backdrop-filter: blur(28px)'));
  assert.ok(css.includes('background: color-mix(in srgb, var(--bg-primary'));
  assert.ok(css.includes('[data-theme="light"] .translator-card'));
  assert.ok(css.includes('scrollbar-width: none'));
});

test('translator window is draggable and auto-sizes to its content', () => {
  const panel = readFileSync(
    new URL('../src/features/translator/components/TranslatorPanel.tsx', import.meta.url),
    'utf8'
  );
  // data-tauri-drag-region 在无边框透明窗不可靠，必须显式 startDragging。
  assert.ok(panel.includes('startDragging'), 'header must call startDragging');
  assert.ok(panel.includes('data-no-drag'), 'interactive children must opt out of dragging');

  const app = readFileSync(
    new URL('../src/features/translator/api/TranslatorWindowApp.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(app.includes('ResizeObserver'), 'window must follow content height');
  assert.ok(app.includes('translator_resize'), 'content height must be pushed to Rust');

  const rustWindow = readFileSync(
    new URL('../src-tauri/src/features/translator/window.rs', import.meta.url),
    'utf8'
  );
  assert.ok(rustWindow.includes('pub async fn translator_resize'));
  assert.ok(rustWindow.includes('TRANSLATOR_MAX_HEIGHT'));
  // 高度区间保护 + 底部越界时上移。
  assert.ok(rustWindow.includes('clamp_position_to_monitor'));
});

test('index.html and translator shell enforce transparent background for floating window', () => {
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(indexHtml.includes('data-window="translator"'));
  assert.ok(indexHtml.includes('background-color: transparent !important'));

  const css = readFileSync(
    new URL('../src/features/translator/components/translator.css', import.meta.url),
    'utf8'
  );
  assert.ok(css.includes('.translator-window-shell'));
  assert.ok(css.includes('background: transparent !important'));
});

test('translator prompt can be customized in settings and clears on reopen', () => {
  const settingsPage = readFileSync(
    new URL('../src/features/settings/components/pages/TranslatorSettingsPage.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(settingsPage.includes('TranslatorPromptSetting'));

  const promptSetting = readFileSync(
    new URL('../src/features/settings/components/pages/TranslatorPromptSetting.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(promptSetting.includes('DEFAULT_TRANSLATOR_PROMPT'));
  assert.ok(promptSetting.includes('translatorPrompt'));
  assert.ok(promptSetting.includes('commit("")'));

  const store = readFileSync(
    new URL('../src/features/translator/api/translatorStore.ts', import.meta.url),
    'utf8'
  );
  assert.ok(store.includes('customPrompt'));
  assert.ok(store.includes('clear: () =>'));

  const windowApp = readFileSync(
    new URL('../src/features/translator/api/TranslatorWindowApp.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(windowApp.includes('clear()'));

  const rustWindow = readFileSync(
    new URL('../src-tauri/src/features/translator/window.rs', import.meta.url),
    'utf8'
  );
  assert.ok(rustWindow.includes('TRANSLATOR_HEIGHT: f64 = 220.0'));
});

test('screenshot capture uses fast jpeg encoding and screenshot results are not overwritten by text debouncing', () => {
  const captureRs = readFileSync(
    new URL('../src-tauri/src/features/translator/capture.rs', import.meta.url),
    'utf8'
  );
  // 全屏冻结帧改用快速 JPEG，避免 CPU PNG 耗时卡顿
  assert.ok(captureRs.includes('encode_fast_screen_base64'));
  assert.ok(captureRs.includes('data:image/jpeg;base64'));

  const panel = readFileSync(
    new URL('../src/features/translator/components/TranslatorPanel.tsx', import.meta.url),
    'utf8'
  );
  // 已有结果与 input 相符时绝对不发起多余防抖翻译
  assert.ok(panel.includes('trimmed === resultInput'));

  const app = readFileSync(
    new URL('../src/features/translator/api/TranslatorWindowApp.tsx', import.meta.url),
    'utf8'
  );
  // 截图结果直接写入 result，input 保持为空，防止伪文本被模型反向翻译覆盖
  assert.ok(app.includes('ScreenshotResultCard'));
  assert.ok(app.includes('clear()'));
});

const resultWindow = loadTs('../src/features/translator/lib/resultWindow.ts');
const { CaptureSession, confirmCapture } = loadTs('../src/features/translator/lib/captureSession.ts');
const { prepareCaptureImage } = loadTs('../src/features/translator/lib/captureReadiness.ts');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('retained reads handle warm reopen, out-of-order IPC, and disposed StrictMode mount', async () => {
  const session = new CaptureSession();
  const updates = [];
  const old = deferred();
  const pending = session.refresh(() => old.promise, (p) => updates.push(p));
  await session.refresh(async () => ({ sessionId: 2 }), (p) => updates.push(p));
  old.resolve({ sessionId: 1 });
  await pending;
  assert.equal(session.current.sessionId, 2);
  assert.equal(updates.length, 1);
  const late = deferred();
  const stopped = session.refresh(() => late.promise, (p) => updates.push(p));
  session.stop();
  late.resolve({ sessionId: 3 });
  await stopped;
  assert.equal(updates.length, 1);
});

test('cancel fences in-flight reads and retained same-session rereads keep the overlay mounted', async () => {
  const session = new CaptureSession();
  const updates = [];
  await session.refresh(async () => ({ sessionId: 1 }), (p) => updates.push(p));
  // A queued publication read can return after ready ACK; native must still retain this frame.
  await session.refresh(async () => ({ sessionId: 1 }), (p) => updates.push(p));
  assert.equal(session.isCurrent(1), true);
  const late = deferred();
  const pending = session.refresh(() => late.promise, (p) => updates.push(p));
  session.clear(1);
  late.resolve({ sessionId: 1 });
  await pending;
  assert.equal(session.current, null);
  assert.equal(updates.length, 2);
});

test('readiness StrictMode replay cancels queued paints from the abandoned effect', async () => {
  const frames = new Map();
  const events = [];
  let next = 0;
  const schedule = (fn) => { frames.set(++next, fn); return next; };
  const unschedule = (id) => frames.delete(id);
  const image = { decode: async () => {}, naturalWidth: 100 };
  const start = () => prepareCaptureImage(image, () => events.push('ready'),
    () => events.push('fail'), schedule, unschedule);
  const stop = start();
  await Promise.resolve();
  stop();
  start();
  await Promise.resolve();
  while (frames.size) {
    const [id, fn] = frames.entries().next().value;
    frames.delete(id); fn(0);
  }
  assert.deepEqual(events, ['ready']);
  prepareCaptureImage({ decode: async () => {}, naturalWidth: 0 },
    () => events.push('bad ready'), () => events.push('fail'), schedule, unschedule);
  await Promise.resolve();
  assert.deepEqual(events, ['ready', 'fail']);
});

test('confirmation awaits native hide before model call and drops cancelled translation', async () => {
  const events = [];
  const hide = deferred();
  const model = deferred();
  let active = true;
  const pending = confirmCapture(1, () => active,
    () => { events.push('hide'); return hide.promise; },
    () => { events.push('model'); return model.promise; },
    async () => { events.push('deliver'); });
  assert.deepEqual(events, ['hide']);
  hide.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['hide', 'model']);
  active = false;
  model.resolve('obsolete');
  await pending;
  assert.deepEqual(events, ['hide', 'model']);
});

test('hide or model failure cannot invoke model/deliver as successful translation', async () => {
  for (const failAt of ['hide', 'model']) {
    const events = [];
    await assert.rejects(confirmCapture(1, () => true,
      async () => { events.push('hide'); if (failAt === 'hide') throw Error('hide failed'); },
      async () => { events.push('model'); throw Error('model failed'); },
      async () => { events.push('deliver'); }));
    assert.deepEqual(events, failAt === 'hide' ? ['hide'] : ['hide', 'model']);
  }
});

test('readiness waits for decode and two committed frames; failure and stale decode never show', async () => {
  const decode = deferred();
  const frames = [];
  const events = [];
  const prepare = (promise, width = 100) => prepareCaptureImage(
    { decode: () => promise, naturalWidth: width },
    () => events.push('ready'), () => events.push('fail'),
    (fn) => { frames.push(fn); return frames.length; }, () => {});
  prepare(decode.promise);
  assert.equal(frames.length, 0);
  decode.resolve();
  await Promise.resolve();
  assert.deepEqual(events, []);
  frames.shift()(0);
  assert.deepEqual(events, []);
  frames.shift()(0);
  assert.deepEqual(events, ['ready']);
  const late = deferred();
  const stop = prepare(late.promise);
  stop(); late.resolve();
  await Promise.resolve();
  assert.equal(frames.length, 0);
  prepare(Promise.reject(Error('bad image')));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(events, ['ready', 'fail']);
});

test('same-size reopen forces measurement while stale opening and duplicate frame do not', () => {
  const session = new resultWindow.ResultWindowSession();
  const opening = { generation: 1, mode: 'input', text: '', result: null };
  assert.equal(session.accept(opening), true);
  assert.deepEqual(JSON.parse(JSON.stringify(session.measure(150))), {height:220,generation:1,sequence:1,mode:'input'});
  assert.equal(session.measure(150), null);
  assert.equal(session.accept({...opening,generation:2}), true);
  assert.equal(session.measure(150).sequence, 1);
  assert.equal(session.accept(opening), false);
  assert.equal(session.accept({...opening,generation:3,mode:'screenshot'}), true);
  assert.equal(session.measure(9999).height, 680);
  assert.equal(session.accept({...opening,generation:4}), true);
  assert.equal(session.measure(9999).height, 520);
});

test('resize queue serializes IPC and merges to the latest request', async () => {
  const pending = deferred();
  const sent = [];
  const queue = new resultWindow.ResizeQueue(async (value) => {
    sent.push(value);
    if (value === 1) await pending.promise;
  });
  queue.push(1); queue.push(2); queue.push(3);
  assert.deepEqual(sent, [1]);
  pending.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [1,3]);
});

test('screenshot card renders actual crop, translated before original, real elapsed and copies only translation', async () => {
  const copied = [];
  const exports = {};
  const source = readFileSync(new URL('../src/features/translator/components/ScreenshotResultCard.tsx', import.meta.url), 'utf8');
  const jsx = (type, props) => ({type, ...props});
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText, {exports, window:{addEventListener(){},removeEventListener(){}}, require(id) {
    if (id === 'react') return {useRef: v => ({current:v}),useEffect(){},useState:() => [false,()=>{}]};
    if (id === 'react/jsx-runtime') return {jsx,jsxs:jsx};
    if (id.includes('i18n')) return {useI18n:() => ({t:key=>key})};
    if (id.includes('systemClipboard')) return {copyTextToClipboard:async text=>{copied.push(text);}};
    if (id.includes('resultWindow')) return resultWindow;
    if (id.includes('/errors')) return loadTs('../src/features/translator/lib/errors.ts');
    if (id.includes('translatorStore')) return {};
    if (id.includes('/models')) return models;
    if (id.includes('settingsStore')) return {};
    if (id.includes('/core')) return {invoke:async()=>{}};
    if (id.includes('/window')) return {getCurrentWindow:()=>({startDragging:async()=>{}})};
    throw Error(`unexpected dependency ${id}`);
  }});
  const result = {imageBase64:'data:image/png;base64,crop', original:'source', translated:'translation',elapsedMs:1234};
  const tree = exports.ScreenshotResultCard({result});
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {nodes.push(node); walk(node.children);}
  }
  walk(tree);
  assert.equal(nodes.find(n=>n.type==='img').src, result.imageBase64);
  assert.deepEqual(nodes.filter(n=>n.type==='p').map(n=>n.children), ['translation','source']);
  assert.ok(nodes.some(n=>Array.isArray(n.children) && n.children[0]==='1.23'));
  nodes.find(n=>n.type==='button').onClick();
  await Promise.resolve();
  assert.deepEqual(copied,['translation']);
  const missing = exports.ScreenshotResultCard({result:{...result,original:null}});
  assert.ok(JSON.stringify(missing).includes('translator.screenshot.originalMissing'));
});

const selection = loadTs('../src/features/translator/lib/selection.ts', {'./crop':crop});
const plain = value => JSON.parse(JSON.stringify(value));

test('default selection scheduler preserves the Window receiver during drag and cleanup', () => {
  const frames = new Map();
  let next = 0;
  const window = {
    requestAnimationFrame(callback) {
      assert.equal(this, window, 'native RAF requires Window receiver');
      frames.set(++next, callback);
      return next;
    },
    cancelAnimationFrame(id) {
      assert.equal(this, window, 'native cancelRAF requires Window receiver');
      frames.delete(id);
    },
  };
  const native = loadTs('../src/features/translator/lib/selection.ts', { './crop': crop }, {
    window,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
  });
  const paints = [];
  const controller = new native.SelectionInteraction(value => paints.push(plain(value)));
  const view = { width: 200, height: 100 };
  assert.equal(controller.begin(1, { x: 10, y: 10 }, 'draw', view), true);
  controller.update(1, { x: 50, y: 40 }, view);
  controller.end(1, { x: 80, y: 70 }, view);
  assert.deepEqual(paints.at(-1), { x: 10, y: 10, width: 70, height: 60 });
  assert.equal(controller.dragging, false);
  assert.equal(frames.size, 0);
  controller.begin(2, { x: 20, y: 20 }, 'draw', view);
  controller.cancel(2);
  assert.equal(controller.dragging, false);
  controller.begin(3, { x: 20, y: 20 }, 'draw', view);
  controller.dispose();
  assert.equal(controller.dragging, false);
  assert.equal(frames.size, 0);
});
test('four draw directions clamp; moving and all eight handles preserve minimum and viewport', () => {
  const view = {width:100,height:100};
  for (const [x,y] of [[90,90],[10,90],[90,10],[10,10]]) {
    const r = selection.selectionGeometry('draw',{x:50,y:50},{x,y},null,view);
    assert.equal(r.width,40); assert.equal(r.height,40);
  }
  const initial = {x:20,y:20,width:40,height:40};
  assert.deepEqual(plain(selection.selectionGeometry('move',{x:20,y:20},{x:200,y:-200},initial,view)),
    {x:60,y:0,width:40,height:40});
  for (const handle of selection.HANDLES) {
    for (const end of [{x:-100,y:-100},{x:200,y:200}]) {
      const r = selection.selectionGeometry(handle,{x:20,y:20},end,initial,view);
      assert.ok(r.width>=8 && r.height>=8, handle);
      assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=100 && r.y+r.height<=100, handle);
      if (handle.includes('w')) assert.equal(r.x+r.width,60);
      if (handle.includes('n')) assert.equal(r.y+r.height,60);
      if (handle.includes('e')) assert.equal(r.x,20);
      if (handle.includes('s')) assert.equal(r.y,20);
    }
  }
  assert.deepEqual(plain(selection.selectionGeometry('draw',{x:50,y:50},{x:200,y:-100},null,view)),
    {x:50,y:0,width:50,height:50});
});

test('pointer ownership, cancellation rollback, frame coalescing and pointerup latest coordinate', () => {
  const frames = new Map(), paints = [];
  let next = 0;
  const controller = new selection.SelectionInteraction(r=>paints.push(plain(r)),
    fn=>{frames.set(++next,fn);return next;},id=>frames.delete(id));
  const view = {width:100,height:100};
  assert.equal(controller.begin(1,{x:10,y:10},'draw',view),true);
  assert.equal(controller.begin(2,{x:10,y:10},'draw',view),false);
  controller.update(2,{x:90,y:90},view);
  controller.update(1,{x:40,y:40},view);
  controller.update(1,{x:50,y:50},view);
  assert.equal(frames.size,1); assert.equal(paints.length,0);
  controller.end(1,{x:70,y:80},view);
  assert.equal(frames.size,0);
  assert.deepEqual(paints.at(-1),{x:10,y:10,width:60,height:70});
  controller.begin(3,{x:10,y:10},'move',view);
  controller.update(3,{x:30,y:30},view);
  controller.cancel(3);
  assert.deepEqual(paints.at(-1),{x:10,y:10,width:60,height:70});
  assert.equal(controller.dragging,false); assert.equal(frames.size,0);
  controller.begin(7,{x:10,y:10},'move',view);
  controller.update(7,{x:15,y:15},view); controller.update(7,{x:20,y:20},view);
  const [frameId, frame] = frames.entries().next().value;
  frames.delete(frameId); frame(0);
  assert.deepEqual(paints.at(-1),{x:20,y:20,width:60,height:70});
  controller.cancel(7);
  controller.begin(4,{x:1,y:1},'draw',view); controller.cancel(4);
  assert.equal(frames.size,0);
  controller.begin(5,{x:1,y:1},'draw',view); controller.end(5,{x:2,y:2},view);
  assert.equal(controller.bounds,null);
  controller.begin(6,{x:1,y:1},'draw',view); controller.dispose();
  assert.equal(frames.size,0);
});

test('measured toolbar and label flip and stay inside every viewport corner', () => {
  const view={width:300,height:200}, size={width:160,height:32};
  for (const x of [0,270]) for (const y of [0,170]) for (const toolbar of [true,false]) {
    const pos=selection.selectionChrome({x,y,width:30,height:30},view,size,toolbar);
    assert.ok(pos.x>=0 && pos.x+size.width<=view.width);
    assert.ok(pos.y>=0 && pos.y+size.height<=view.height);
  }
});

test('native release must resolve before crop encode, model discovery and delivery; failures and cancellation fence each stage', async () => {
  for (const outcome of ['success','release-fail','cancel-release','crop-fail','cancel-model']) {
    const events=[], timings=[], hide=deferred(), model=deferred(); let active=true, now=0;
    const pending=confirmCapture(1,()=>active,
      ()=>{events.push('release');return hide.promise;},
      image=>{events.push(`model:${image}`);return model.promise;},
      async()=>{events.push('deliver');},
      ()=>{events.push('crop');if(outcome==='crop-fail')throw Error('encode');return 'encoded';},
      (stage,elapsed)=>timings.push({stage,elapsed}),()=>++now);
    const rejected = ['release-fail','crop-fail'].includes(outcome) ? assert.rejects(pending) : null;
    assert.deepEqual(events,['release']);
    if(outcome==='release-fail') hide.reject(Error('release')); else hide.resolve();
    if(outcome==='cancel-release') active=false;
    await new Promise(resolve=>setImmediate(resolve));
    if(outcome==='cancel-model') active=false;
    model.resolve('result');
    if(rejected) await rejected;
    else await pending;
    const expected = outcome==='success' ? ['release','crop','model:encoded','deliver'] :
      outcome==='crop-fail' ? ['release','crop'] : outcome==='cancel-model' ? ['release','crop','model:encoded'] : ['release'];
    assert.deepEqual(events,expected);
    assert.ok(timings.every(t=>t.elapsed>=0));
  }
});

test('decoded crop reuses exact image and encodes only its selected rectangle', () => {
  const exports={}, events=[];
  const source=readFileSync(new URL('../src/features/translator/lib/crop.ts',import.meta.url),'utf8');
  const canvas={getContext:()=>({drawImage:(...args)=>events.push(args)}),toDataURL:()=>{events.push('encode');return 'data:image/png;base64,actual';}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}});
  const image={complete:true,naturalWidth:100};
  assert.equal(exports.cropDecodedImage(image,{x:2,y:3,width:20,height:30}),'actual');
  assert.equal(events[0][0],image);
  assert.deepEqual(events[0].slice(1),[2,3,20,30,0,0,20,30]);
  assert.equal(events[1],'encode'); assert.equal(canvas.width,20); assert.equal(canvas.height,30);
  assert.throws(()=>exports.cropDecodedImage({complete:false},{width:20,height:30}));
});

test('overlay captures pointer, handles cancel/lost capture and explicitly confirms lazy crop using latest up', async () => {
  const exports={}, effects=[], keys=new Map(), refs=[], updates=[], frames=new Map();
  let next=0, readied=0, cancelled=0, cropFactory=null, crops=0;
  const source=readFileSync(new URL('../src/features/translator/components/ScreenshotOverlay.tsx',import.meta.url),'utf8');
  const jsx=(type,props)=>({type,...props});
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText, {
    exports,performance,console:{debug(){}},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    window:{innerWidth:200,innerHeight:100,addEventListener:(key,fn)=>keys.set(key,fn),removeEventListener(){}},
    require(id){
      if(id==='react')return {useCallback:fn=>fn,useEffect:fn=>effects.push(fn),useLayoutEffect(){},
        useRef:value=>{const ref={current:value};refs.push(ref);return ref;},
        useState:value=>[value,update=>updates.push(update)]};
      if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
      if(id==='lucide-react')return {};
      if(id.includes('Portal'))return {Portal:'portal'};
      if(id.includes('i18n'))return {useI18n:()=>({t:key=>key})};
      if(id.includes('captureReadiness'))return {prepareCaptureImage:(_image,ready)=>{ready();return ()=>{};}};
      if(id.includes('/crop'))return {...crop,cropDecodedImage:()=>{crops++;return 'encoded';}};
      if(id.includes('/selection'))return {...selection,SelectionInteraction:class extends selection.SelectionInteraction {
        constructor(paint){super(paint,fn=>{frames.set(++next,fn);return next;},id=>frames.delete(id));}
      }};
      throw Error(id);
    }});
  const tree=exports.ScreenshotOverlay({imageSrc:'frame',imageWidth:400,imageHeight:200,
    onReady:()=>readied++,onCancel:()=>cancelled++,onConfirm:fn=>{cropFactory=fn;}});
  refs[0].current={complete:true,naturalWidth:400};
  const cleanups=effects.map(fn=>fn());
  assert.equal(readied,1);
  const root=tree.children, target={closest:()=>null,dataset:{}}, captured=[];
  const currentTarget={setPointerCapture:id=>captured.push(id),hasPointerCapture:()=>true,releasePointerCapture:id=>captured.push(-id)};
  const event=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,target,currentTarget,preventDefault(){},nativeEvent:{}});
  root.onPointerDown(event(10,10));
  root.onPointerMove({...event(40,40),nativeEvent:{getCoalescedEvents:()=>[{clientX:60,clientY:60}]}});
  root.onPointerUp(event(80,70));
  assert.equal(cropFactory,null,'pointerup never auto-submits');
  assert.deepEqual(captured,[1,-1]);
  assert.deepEqual(plain(refs[3].current.bounds),{x:10,y:10,width:70,height:60});
  root.onPointerDown(event(1,1)); root.onPointerCancel(event(4,4));
  assert.deepEqual(plain(refs[3].current.bounds),{x:10,y:10,width:70,height:60});
  root.onPointerDown(event(1,1)); root.onLostPointerCapture(event(4,4));
  assert.equal(refs[3].current.dragging,false);
  keys.get('keydown')({key:'Enter',preventDefault(){}});
  assert.equal(crops,0,'confirm passes lazy work, no eager canvas');
  assert.equal(typeof cropFactory,'function'); assert.equal(cropFactory(),'encoded');
  assert.equal(crops,1);
  keys.get('keydown')({key:'Escape',preventDefault(){}}); assert.equal(cancelled,1);
  cleanups.forEach(fn=>fn?.());
});

test('confirmation retires queued frame reads without losing the translation identity', async () => {
  const session = new CaptureSession(), updates = [];
  await session.refresh(async () => ({sessionId: 1}), value => updates.push(value));
  const old = deferred();
  const read = session.refresh(() => old.promise, value => updates.push(value));
  assert.equal(session.beginConfirmation(1), true);
  old.resolve({sessionId: 1}); await read;
  await session.refresh(async () => null, value => updates.push(value));
  await session.refresh(async () => ({sessionId: 1}), value => updates.push(value));
  assert.equal(session.isCurrent(1), true);
  assert.equal(updates.length, 1, 'null native translation read must not unmount/abort local work');
  session.clear(1);
  await session.refresh(async () => ({sessionId: 1}), value => updates.push(value));
  assert.equal(session.isCurrent(1), false, 'cancelled identity must never revive');
  await session.refresh(async () => ({sessionId: 2}), value => updates.push(value));
  assert.equal(session.isCurrent(2), true);
  assert.equal(session.beginConfirmation(1), false);
});

test('cancellation from lazy crop suppresses model discovery and delivery', async () => {
  let active = true;
  const events = [];
  await confirmCapture(1, () => active, async () => events.push('release'),
    async () => events.push('model'), async () => events.push('deliver'),
    () => { events.push('crop'); active = false; return 'image'; });
  assert.deepEqual(events, ['release', 'crop']);
});

test('thumbnail failure stays explicit and failed recopy clears a previous copied state', async () => {
  const exports = {}, state = [], effects = [];
  let cursor = 0, failCopy = false;
  const jsx = (type, props) => ({type, ...props});
  const source = readFileSync(new URL('../src/features/translator/components/ScreenshotResultCard.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText, {exports, window: {addEventListener(){}, removeEventListener(){}}, require(id) {
    if (id === 'react') return {useRef: v => ({current:v}),useEffect: fn => effects.push(fn), useState(initial) {
      const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], value => {state[index] = value;}];
    }};
    if (id === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (id.includes('i18n')) return {useI18n: () => ({t: key => key})};
    if (id.includes('systemClipboard')) return {copyTextToClipboard: async () => {if (failCopy) throw Error('clipboard');}};
    if (id.includes('resultWindow')) return resultWindow;
    if (id.includes('/errors')) return loadTs('../src/features/translator/lib/errors.ts');
    if (id.includes('translatorStore')) return {};
    if (id.includes('/models')) return models;
    if (id.includes('settingsStore')) return {};
    if (id.includes('/core')) return {invoke: async () => {}};
    if (id.includes('/window')) return {getCurrentWindow: () => ({startDragging: async () => {}})};
    throw Error(id);
  }});
  function render() {
    cursor = 0;
    const nodes = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {nodes.push(node); walk(node.children);}
    }
    walk(exports.ScreenshotResultCard({result: {imageBase64:'bad', original:null, translated:'text', elapsedMs:5}}));
    return nodes;
  }
  let nodes = render();
  nodes.find(n => n.type === 'img').onError();
  nodes = render();
  assert.equal(nodes.some(n => n.type === 'img'), false);
  assert.ok(nodes.some(n => n.role === 'alert' && n.children === 'translator.screenshot.imageFailed'));
  nodes.find(n => n.type === 'button').onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().find(n => n.type === 'button').children, 'translator.status.copied');
  failCopy = true;
  render().find(n => n.type === 'button').onClick();
  await new Promise(resolve => setImmediate(resolve));
  nodes = render();
  assert.equal(nodes.find(n => n.type === 'button').children, 'translator.status.copy');
  assert.ok(nodes.some(n => n.role === 'alert' && n.children === 'translator.screenshot.copyFailed'));
});

test('full card chain awaits release/loading before lazy crop, thumbnail ACK, model and same opening delivery', async () => {
  const events = [], thumb = deferred();
  const pending = confirmCapture(4, () => true,
    async () => { events.push('release'); events.push('loading'); },
    async image => { assert.equal(image, 'crop'); events.push('model'); return 'translated'; },
    async text => { assert.equal(text, 'translated'); events.push('success'); },
    () => { events.push('crop'); return 'crop'; }, () => {}, () => 1,
    image => { assert.equal(image, 'crop'); events.push('thumbnail'); return thumb.promise; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['release','loading','crop','thumbnail']);
  thumb.resolve(); await pending;
  assert.deepEqual(events, ['release','loading','crop','thumbnail','model','success']);
  for (const fail of ['release', 'loading', 'crop', 'thumbnail', 'model']) {
    const events = [];
    await assert.rejects(confirmCapture(4, () => true,
      async () => { events.push('release'); if (fail === 'release') throw Error(fail);
        events.push('loading'); if (fail === 'loading') throw Error(fail); },
      async () => { events.push('model'); throw Error('model'); },
      async () => events.push('success'),
      () => { events.push('crop'); if (fail === 'crop') throw Error(fail); return 'crop'; },
      () => {}, () => 1,
      async () => { events.push('thumbnail'); if (fail === 'thumbnail') throw Error(fail); }));
    const order = ['release', 'loading', 'crop', 'thumbnail', 'model'];
    assert.deepEqual(events, order.slice(0, order.indexOf(fail) + 1));
  }
});

test('same opening revision handles lost retained reads and rejects old same-session updates without resetting resize sequence', () => {
  const s = new resultWindow.ResultWindowSession();
  const loading = {generation:4,revision:0,mode:'screenshot',card:{sessionId:7,phase:'loading'},result:null};
  assert.equal(s.accept(loading), true);
  assert.equal(s.measure(310).sequence, 1);
  const success = {...loading, revision:2,card:{sessionId:7,phase:'success'}};
  assert.equal(s.accept(success), true);
  assert.equal(s.accept({...loading,revision:1}), false);
  assert.equal(s.accept(loading), false);
  assert.equal(s.measure(320).sequence, 2);
  assert.equal(s.accept({...loading,generation:5,mode:'input',card:null}), true);
  assert.equal(s.accept({...success,revision:3}), false);
  assert.equal(s.measure(320).sequence, 1);
  const cold = new resultWindow.ResultWindowSession();
  assert.equal(cold.accept(success), true);
  assert.equal(cold.current.card.phase, 'success');
});

test('CSS-to-frozen-frame selection uses actual scale at every DPI and excludes non-finite geometry', () => {
  for (const scale of [1,1.25,1.5,2]) {
    const physical = crop.scaleRectToImage({x:20,y:40,width:100,height:80},1920/scale,1080/scale,1920,1080);
    assert.deepEqual(plain(physical),{x:20*scale,y:40*scale,width:100*scale,height:80*scale});
    const anchor = {...physical,x:-1920+physical.x,y:-1080+physical.y};
    assert.equal(anchor.x,-1920+20*scale); assert.equal(anchor.y,-1080+40*scale);
  }
  for (const bad of [NaN,Infinity,-Infinity]) {
    assert.equal(crop.scaleRectToImage({x:bad,y:0,width:30,height:30},100,100,200,200),null);
    assert.equal(crop.scaleRectToImage({x:0,y:0,width:30,height:30},bad,100,200,200),null);
  }
});

test('same card loading/error/success has localized status, real timer cleanup, success-only copy and Esc/drag', async () => {
  const exports = {}, state = [], effects = [], timers = new Map(), callbacks = new Map(), calls = [];
  let cursor = 0, nextTimer = 0;
  const jsx = (type,props) => ({type,...props});
  const source = readFileSync(new URL('../src/features/translator/components/ScreenshotResultCard.tsx',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports, Date: {now:()=>2500}, window:{
      addEventListener:(key,fn)=>callbacks.set(key,fn),removeEventListener:key=>callbacks.delete(key),
      setInterval:(fn)=>{timers.set(++nextTimer,fn);return nextTimer;},clearInterval:id=>timers.delete(id),
    },require(id){
      if(id==='react') return {useRef:v=>({current:v}),useEffect:fn=>effects.push(fn),useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=v;}];}};
      if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
      if(id.includes('i18n'))return {useI18n:()=>({t:key=>key})};
      if(id.includes('systemClipboard'))return {copyTextToClipboard:async text=>calls.push(['copy',text])};
      if(id.includes('resultWindow'))return resultWindow;
      if(id.includes('/errors'))return loadTs('../src/features/translator/lib/errors.ts');
      if(id.includes('translatorStore'))return {};
      if(id.includes('/models'))return models;
      if(id.includes('settingsStore'))return {};
      if(id.includes('/core'))return {invoke:async name=>calls.push([name])};
      if(id.includes('/window'))return {getCurrentWindow:()=>({startDragging:async()=>calls.push(['drag'])})};
      throw Error(id);
    }});
  function render(phase,result=null){cursor=0;const nodes=[];
    function walk(node){if(Array.isArray(node))return node.forEach(walk);if(node&&typeof node==='object'){nodes.push(node);walk(node.children);}}
    walk(exports.ScreenshotResultCard({result,card:{phase,sessionId:7,imageBase64:result?.imageBase64??'',startedAt:1000,elapsedMs:2345}}));return nodes;
  }
  let nodes=render('loading');
  assert.ok(nodes.some(n=>n.role==='status'&&n.children==='translator.screenshot.loading'));
  assert.ok(nodes.some(n=>Array.isArray(n.children)&&n.children[0]==='1.50'));
  assert.equal(nodes.find(n=>n.type==='button').disabled,true);
  nodes.find(n=>n.type==='button').onClick();assert.deepEqual(calls,[]);
  const cleanups=effects.map(fn=>fn()).filter(Boolean);assert.equal(timers.size,1);
  callbacks.get('keydown')({key:'Escape'});
  nodes.find(n=>n.type==='article').onMouseDown({button:0,target:{closest:()=>false}});
  assert.deepEqual(calls,[['translator_hide'],['drag']]);
  cleanups.forEach(fn=>fn());assert.equal(timers.size,0);assert.equal(callbacks.size,0);
  nodes=render('error');
  assert.ok(nodes.some(n=>n.role==='alert'&&n.children==='translator.error.invalidResponse'));
  assert.equal(nodes.find(n=>n.type==='button').disabled,false);
  assert.ok(nodes.some(n=>n.type==='button' && n.children==='translator.retry'));
  assert.equal(nodes.some(n=>n.type==='section'),false);
  const result={translated:'译文',original:'source',imageBase64:'real',elapsedMs:999};
  nodes=render('success',result);
  assert.equal(nodes.find(n=>n.type==='button').disabled,false);
  assert.deepEqual(nodes.filter(n=>n.type==='p').map(n=>n.children),['译文','source']);
  assert.ok(nodes.some(n=>Array.isArray(n.children)&&n.children[0]==='2.35'));
  assert.equal(nodes.find(n=>n.type==='img').src,'data:image/png;base64,real');
  nodes.find(n=>n.type==='button').onClick();await Promise.resolve();
  assert.deepEqual(calls.at(-1),['copy','译文']);
});

for (const outcome of ['success', 'release-failure', 'crop-failure', 'thumbnail-failure', 'model-failure', 'obsolete-model-failure']) {
test(`CaptureWindowApp actual callbacks preserve opening identity and fail closed: ${outcome}`, async () => {
  const exports = {}, effects = [], refs = [], state = [], events = [];
  let ri = 0, si = 0, frame = {sessionId:9,capture:{width:1920,height:1080,originX:-1920,originY:-1080,imageBase64:'frame'}};
  const invoke = async (command,args) => {
    events.push([command,args]);
    if(command==='translator_take_capture')return frame;
    if(command==='translator_capture_confirm') {
      if(outcome==='release-failure')throw Error('native release failed');
      return 33;
    }
    if(command==='translator_update_thumbnail' && outcome==='thumbnail-failure')throw Error('thumbnail rejected');
    if(command==='translator_list_models')return [];
    if(command==='translator_translate_image') {
      if(outcome==='obsolete-model-failure') {
        frame = {sessionId:10,capture:frame.capture};
        await refs[0].current.refresh(async()=>frame,()=>{});
        throw Error('old model failed');
      }
      if(outcome==='model-failure')throw Error('model failed');
      return {translated:'ok',original:'source',imageBase64:'crop',elapsedMs:2};
    }
    // Native identity gates reject stale error/end just as they reject stale success.
    if(command==='translator_capture_failed' && outcome==='obsolete-model-failure')throw Error('stale opening');
  };
  const jsx=(type,props)=>({type,...props});
  const source=readFileSync(new URL('../src/features/translator/api/CaptureWindowApp.tsx',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,performance,console:{debug(){},error(){}},document:{documentElement:{dataset:{},style:{}},body:{style:{}},getElementById:()=>({style:{}})},require(id){
      if(id==='react')return {useEffect:fn=>effects.push(fn),useCallback:fn=>fn,useRef(initial){const i=ri++;return refs[i]??=( {current:initial});},useState(initial){const i=si++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];}};
      if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
      if(id.includes('/core'))return {invoke};
      if(id.includes('/event'))return {listen:async()=>()=>{}};
      if(id.includes('ScreenshotOverlay'))return {ScreenshotOverlay:'overlay'};
      if(id.includes('translatorStore'))return {useTranslatorStore:{getState:()=>({models:[],targetLang:'auto'})}};
      if(id.includes('/models'))return {resolveTranslatorModel:()=>null};
      if(id.includes('captureSession'))return {CaptureSession,confirmCapture};
      if(id.includes('settingsStore'))return {useSettingsStore:{getState:()=>({load:async()=>{}})}};
      if(id.endsWith('.css'))return {};
      throw Error(id);
    }});
  exports.CaptureWindowApp();effects.forEach(fn=>fn());
  await new Promise(resolve=>setImmediate(resolve));
  ri=0;si=0;const overlay=exports.CaptureWindowApp();
  overlay.onConfirm(()=>{events.push(['crop']);if(outcome==='crop-failure')throw Error('canvas');return 'crop';},{x:25,y:50,width:200,height:100});
  await new Promise(resolve=>setImmediate(resolve));
  const confirm=events.find(e=>e[0]==='translator_capture_confirm');
  assert.deepEqual(plain(confirm[1]),{sessionId:9,anchor:{x:-1895,y:-1030,width:200,height:100}});
  const names=events.map(e=>e[0]);
  if(outcome!=='success') {
    assert.equal(names.includes('translator_deliver_result'),false);
    assert.equal(names.includes('translator_capture_ready'),false,'failure cannot revive fullscreen');
    assert.equal(names.includes('translator_show'),false,'failure cannot open another window');
    assert.equal(names.includes('translator_capture_failed'),outcome!=='release-failure');
    if(outcome==='release-failure')assert.equal(names.includes('crop'),false);
    if(['release-failure','crop-failure','thumbnail-failure'].includes(outcome)) {
      assert.equal(names.includes('translator_list_models'),false);
      assert.equal(names.includes('translator_translate_image'),false);
    }
    if(outcome==='obsolete-model-failure') {
      assert.equal(refs[0].current.isCurrent(10),true,'old failure must not clear the newer capture');
      assert.equal(names.includes('translator_capture_end'),false,'old failure must not cancel the newer capture');
    } else assert.equal(names.includes('translator_capture_end'),true);
    for(const [name,args] of events.filter(([name])=>['translator_capture_failed','translator_capture_end'].includes(name))) {
      assert.equal(args.sessionId,9,name);
      if(name==='translator_capture_failed')assert.equal(args.generation,33);
    }
    return;
  }
  for(const [a,b] of [['translator_capture_confirm','crop'],['crop','translator_update_thumbnail'],['translator_update_thumbnail','translator_list_models'],['translator_list_models','translator_translate_image']]){
    assert.ok(names.indexOf(a)<names.indexOf(b),`${a} before ${b}`);
  }
  for(const name of ['translator_update_thumbnail','translator_translate_image']){
    const args=events.find(e=>e[0]===name)[1];assert.equal(args.sessionId,9);assert.equal(args.generation,33);
  }
});

}

test('TranslatorWindowApp subscribes before retained recovery and ignores a late read behind terminal events', async () => {
  for (const phase of ['loading', 'success', 'error']) {
    const effects=[], refs=[], state=[], events=[], retained=deferred();
    let ri=0,si=0,listener;
    const jsx=(type,props,key)=>({type,...props,key});
    const exports=loadTs('../src/features/translator/api/TranslatorWindowApp.tsx', {
      'react':{useEffect:fn=>effects.push(fn),useRef(initial){const i=ri++;return refs[i]??={current:initial};},
        useState(initial){const i=si++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=v;}];}},
      'react/jsx-runtime':{jsx,jsxs:jsx},
      '@tauri-apps/api/core':{invoke:async name=>{events.push(name);return retained.promise;}},
      '@tauri-apps/api/event':{listen:async (_name,fn)=>{events.push('subscribe');listener=fn;return ()=>{};}},
      '../components/ScreenshotResultCard':{ScreenshotResultCard:'card'},
      '../components/TranslatorPanel':{TranslatorPanel:'panel'},
      '../lib/resultWindow':resultWindow,
      './translatorStore':{useTranslatorStore:{getState:()=>({loadModels(){},bindOpening(){},clear(){events.push('clear');}})}},
      '../../../shared/preferences/settingsStore':{useSettingsStore:{getState:()=>({load:async()=>{}})}},
      '../../../App.css':{},
    },{document:{documentElement:{dataset:{},style:{}},body:{style:{}},getElementById:()=>null,querySelector:()=>null}});
    exports.TranslatorWindowApp();
    const cleanups=effects.map(fn=>fn()).filter(Boolean);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(events.slice(0,2),['subscribe','translator_take_opening']);
    const opening={generation:8,revision:2,mode:'screenshot',text:'',
      card:{sessionId:9,phase,imageBase64:'crop',startedAt:1000,elapsedMs:50},
      result:phase==='success'?{translated:'ok',original:null,imageBase64:'crop',elapsedMs:50}:null};
    listener({payload:opening});
    retained.resolve({...opening,revision:0,card:{...opening.card,phase:'loading'}});
    await new Promise(resolve=>setImmediate(resolve));
    ri=0;si=0;
    const tree=exports.TranslatorWindowApp();
    assert.equal(tree.children.type,'card');
    assert.equal(tree.children.card.phase,phase);
    assert.equal(tree.children.key,8);
    assert.equal(events.filter(e=>e==='clear').length,1,'same opening revisions cannot clear/remount state');
    cleanups.forEach(fn=>fn());
  }
});

test('invalidation while thumbnail ACK is pending suppresses model and terminal delivery',async()=>{
  let active=true;const thumb=deferred(),events=[];
  const pending=confirmCapture(1,()=>active,async()=>events.push('release/loading'),
    async()=>events.push('model'),async()=>events.push('success'),()=> 'crop',()=>{},()=>0,
    ()=>{events.push('thumbnail');return thumb.promise;});
  await new Promise(resolve=>setImmediate(resolve));active=false;thumb.resolve();await pending;
  assert.deepEqual(events,['release/loading','thumbnail']);
});

test('text setters invalidate native immediately before debounce and reject stale completion', async () => {
  const calls = [], pending = [];
  let state;
  const create = init => {
    const get = () => state;
    const set = value => { state = {...state, ...value}; };
    const store = () => {};
    store.getState = get; store.setState = set;
    state = init(set,get); return store;
  };
  const settings = {translatorModelKey:'',translatorPrompt:'',update:async()=>{}};
  const store = loadTs('../src/features/translator/api/translatorStore.ts', {
    '@tauri-apps/api/core': {invoke(command,args) {
      calls.push([command,plain(args)]);
      if(command==='translator_translate_text') { const d=deferred();pending.push(d);return d.promise; }
      return Promise.resolve();
    }},
    'zustand':{create},
    '../../../shared/preferences/settingsStore':{useSettingsStore:{getState:()=>settings,subscribe(){}}},
    '../lib/models':models,
    '../lib/errors':loadTs('../src/features/translator/lib/errors.ts'),
  }).useTranslatorStore;
  state.bindOpening(12);
  store.setState({models:[{providerId:'p',modelId:'m',isDefault:true}]});
  state.setInput('old');
  assert.equal(calls.at(-1)[0],'translator_invalidate');
  const old = state.translate(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,1);
  state.setInput('new');
  assert.equal(calls.at(-1)[0],'translator_invalidate','setter invalidation does not wait 600ms');
  pending[0].resolve({translated:'stale'});await old;
  assert.equal(state.result,'');
  const current=state.translate();await new Promise(resolve=>setImmediate(resolve));
  pending[1].resolve({translated:'accepted'});await current;
  assert.equal(state.result,'accepted');
  state.setTargetLang('ja');assert.equal(state.result,'');assert.equal(calls.at(-1)[0],'translator_invalidate');
  state.setModel('p:::m');assert.equal(calls.at(-1)[0],'translator_invalidate');
  const retry=state.translate();await new Promise(resolve=>setImmediate(resolve));
  pending[2].reject('SECRET raw provider response');await retry;
  assert.equal(state.error,'');assert.equal(state.errorKey,'translator.error.invalidResponse');
  assert.equal(calls.filter(([n])=>n==='translator_translate_text').length,3,'no automatic request on failure');
});

test('model preference acknowledgement does not invalidate its replacement text attempt', async () => {
  let state, subscriber;
  const saved = deferred(), response = deferred(), calls = [];
  const settings = {translatorModelKey:'', translatorPrompt:'', update:async (_key, value) => {
    await saved.promise;
    const previous = {...settings}; settings.translatorModelKey = value;
    subscriber(settings, previous);
  }};
  const store = loadTs('../src/features/translator/api/translatorStore.ts', {
    '@tauri-apps/api/core':{invoke(command,args) {
      calls.push([command,args]);
      return command === 'translator_translate_text' ? response.promise : Promise.resolve();
    }},
    zustand:{create(init) {
      const get=()=>state, set=value=>{state={...state,...value};};
      state=init(set,get); return {getState:get,setState:set};
    }},
    '../../../shared/preferences/settingsStore':{useSettingsStore:{getState:()=>settings,subscribe:fn=>{subscriber=fn;}}},
    '../lib/models':models, '../lib/errors':loadTs('../src/features/translator/lib/errors.ts'),
  }).useTranslatorStore;
  state.bindOpening(18);
  store.setState({input:'source',models:[{providerId:'p',modelId:'m',isDefault:true}]});
  state.setModel('p:::m');
  const pending=state.translate(); await new Promise(resolve=>setImmediate(resolve));
  const before=calls.filter(([name])=>name==='translator_invalidate').length;
  saved.resolve(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(([name])=>name==='translator_invalidate').length,before);
  response.resolve({translated:'new model result'}); await pending;
  assert.equal(state.result,'new model result'); assert.equal(state.loading,false);
  subscriber({translatorModelKey:'other:::model'},{translatorModelKey:'p:::m'});
  assert.equal(calls.filter(([name])=>name==='translator_invalidate').length,before+1);
  assert.equal(state.result,'');
});

test('duplicate native screenshot submission cannot retire the original capture lease', () => {
  const requests=readFileSync('src-tauri/src/features/translator/requests.rs','utf8');
  assert.match(requests,/if result\.as_ref\(\)\.err\(\)\.map\(String::as_str\) != Some\("translator_busy"\) \{\s*super::lifecycle::finish_translation\(session_id\)/);
});

test('unknown provider errors are never displayed', () => {
  const errors = loadTs('../src/features/translator/lib/errors.ts');
  assert.equal(errors.translatorErrorMessage('Bearer SECRET image unsupported raw body').key,'translator.error.invalidResponse');
  for (const code of ['auth','quota','rate','timeout','network','storage']) {
    assert.equal(errors.translatorErrorMessage(`translator_${code}`).key,`translator.error.${code}`);
  }
});

test('screenshot manual retry is same generation, current settings, duplicate-disabled and never show/focus/recapture', async () => {
  const calls=[], states=[], refs=[], wait=deferred();let cursor=0,refCursor=0;
  const jsx=(type,props)=>({type,...props});
  const component=loadTs('../src/features/translator/components/ScreenshotResultCard.tsx',{
    react:{useEffect(){},useRef(initial){return refs[refCursor++]??={current:initial};},
      useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=v];}},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    '@tauri-apps/api/core':{invoke:async(name,args)=>{calls.push([name,plain(args)]);return wait.promise;}},
    '@tauri-apps/api/window':{},
    '../../../shared/i18n/index':{useI18n:()=>({t:k=>k})},
    '../../../shared/platform/systemClipboard':{},
    '../lib/resultWindow':resultWindow,
    '../lib/errors':loadTs('../src/features/translator/lib/errors.ts'),
    '../lib/models':models,
    '../api/translatorStore':{useTranslatorStore:{getState:()=>({loadModels:async()=>{},targetLang:'ja',selectedModelKey:'new:::vision',models:[{providerId:'new',modelId:'vision',isDefault:true}]})}},
    '../../../shared/preferences/settingsStore':{useSettingsStore:{getState:()=>({load:async()=>{}})}},
  });
  const nodes=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(n&&typeof n==='object'){nodes.push(n);walk(n.children);}}
  walk(component.ScreenshotResultCard({generation:41,result:null,card:{phase:'error',errorCode:'translator_auth',imageBase64:'crop',startedAt:0,elapsedMs:1}}));
  const retry=nodes.find(n=>n.type==='button'&&n.children==='translator.retry');
  retry.onClick();retry.onClick();await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['translator_retry_image',{generation:41,targetLang:'ja',providerId:'new',modelId:'vision'}]);
  wait.resolve();await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);
});
