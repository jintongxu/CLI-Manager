import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const read = (file) => readFileSync(new URL(`../src/features/terminal/${file}`, import.meta.url), "utf8");
const compile = (file, require = () => { throw Error("unexpected dependency"); }, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require, ...globals });
  return exports;
};
const { BtwThreadModel } = compile("lib/btwThreadModel.ts");
const protocol = compile("lib/btwWindowProtocol.ts");
const tick = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };

// Execute the actual hook and reader bootstrap against a provider-free in-memory native IPC.
function transportHarness() {
  let session = null, onIntent, sequence = 0, events = new Set();
  const calls = [], releases = [], asks = [];
  let delayPublish = null;
  const backend = async (label, command, args = {}) => {
    calls.push([label, command, args]);
    if (command === "btw_window_register") {
      assert.equal(label, "main");
      onIntent = args.onIntent; session = { epoch: `native-${++sequence}`, revision: 0, snapshot: null, commandSession: 0 };
      events.forEach((callback) => callback({ payload: null }));
      return session.epoch;
    }
    if (command === "btw_window_publish") {
      assert.equal(label, "main");
      if (delayPublish) await delayPublish;
      if (args.snapshot.ownerEpoch === session?.epoch && args.snapshot.revision > session.revision) {
        session.revision = args.snapshot.revision; session.snapshot = args.snapshot;
        events.forEach((callback) => callback({ payload: args.snapshot }));
      }
      return;
    }
    if (command === "btw_window_release") {
      if (session?.epoch === args.ownerEpoch) { session = null; events.forEach((callback) => callback({ payload: null })); }
      return;
    }
    assert.equal(label, "btw-thread");
    if (command === "btw_window_ready") return { snapshot: session?.snapshot ?? null, commandSession: session ? ++session.commandSession : 1 };
    if (command === "btw_window_intent") { onIntent.onmessage(args.intent); return; }
    throw Error(command);
  };
  const model = new BtwThreadModel({ context: async () => ({ available: true, text: "snapshot", truncated: false, reason: null }),
    ask: (request) => new Promise((resolve) => asks.push({ request, resolve })),
    cancel: async () => {}, listen: async () => () => {} });
  const create = () => { model.stage("quote", { terminalId: "test", sessionId: "pi-test", reason: null });
    model.setQuestion("why"); model.submit(); const id = model.getSnapshot().entries.at(-1).id; model.open(id); return id; };
  const ownerEffects = [];
  let settingValues = { theme: "dark", lightThemePalette: "warm-paper", darkThemePalette: "dracula-purple" };
  const settingSubscribers = new Set();
  const dataset = {};
  const settings = { getState: () => settingValues, subscribe: (callback) => {
    settingSubscribers.add(callback); return () => settingSubscribers.delete(callback);
  }, setState: () => {} };
  const { useBtwNativeWindow } = compile("hooks/useBtwNativeWindow.ts", (name) => {
    if (name === "react") return { useEffect: (setup) => ownerEffects.push(setup) };
    if (name === "@tauri-apps/api/core") return { Channel: class {}, invoke: (cmd, args) => backend("main", cmd, args) };
    if (name.endsWith("shared/i18n/index")) return { getCurrentLanguage: () => "en-US" };
    if (name.endsWith("settingsStore")) return { useSettingsStore: settings };
    if (name === "../lib/btwWindowProtocol") return protocol;
    throw Error(name);
  }, { queueMicrotask, console });
  useBtwNativeWindow(model);
  const childEffects = [], states = [];
  let hookIndex = 0;
  const refs = [];
  const { default: Child } = compile("api/BtwWindowApp.tsx", (name) => {
    if (name === "react") return {
      useState: (initial) => { const index = hookIndex++; if (!(index in states)) states[index] = initial;
        return [states[index], (value) => { states[index] = value; }]; },
      useRef: (initial) => { const index = hookIndex++; return refs[index] ??= { current: initial }; },
      useEffect: (setup) => { if (!childEffects.length) childEffects.push(setup); },
    };
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "@tauri-apps/api/core") return { invoke: (cmd, args) => backend("btw-thread", cmd, args) };
    if (name === "@tauri-apps/api/event") return { listen: async (_event, callback) => {
      events.add(callback); return () => { events.delete(callback); releases.push(callback); };
    } };
    if (name.endsWith("shared/i18n/index")) return { translate: (_lang, key) => key, detectPreferredLanguage: () => "en-US" };
    if (name.endsWith("settingsStore")) return { useSettingsStore: settings };
    if (name === "../components/BtwThreadDialog") return { BtwThreadReader: "Reader" };
    if (name === "../lib/btwWindowProtocol") return protocol;
    if (name.endsWith(".css")) return {};
    throw Error(name);
  }, { document: { documentElement: { dataset } }, crypto: { randomUUID: () => `intent-${++sequence}` } });
  const render = () => { hookIndex = 0; const tree = Child(); return tree.props.children?.find?.((node) => node?.type === "Reader") ?? tree; };
  render();
  return { model, create, asks, calls, releases, render, dataset,
    deliverAgain: (intent) => onIntent.onmessage(intent),
    changeSettings: (values) => { settingValues = { ...settingValues, ...values }; settingSubscribers.forEach((cb) => cb()); },
    ownerSetup: ownerEffects[0], childSetup: childEffects[0],
    pausePublish: (promise) => { delayPublish = promise; } };
}

test("real main hook + child bootstrap: StrictMode, ready replay, atomic send, dedup, close and unmount", async () => {
  const h = transportHarness();
  const probe = h.ownerSetup(); probe();
  const ownerCleanup = h.ownerSetup();
  const childProbe = h.childSetup(); childProbe();
  const childCleanup = h.childSetup();
  const id = h.create(); await tick();
  assert.equal(h.calls.filter(([, command]) => command === "btw_window_register").length, 1);
  assert.equal(h.asks.length, 1);
  let reader = h.render(); assert.equal(reader.type, "Reader"); assert.equal(reader.props.thread.id, id);
  h.asks[0].resolve("answer"); await tick(); reader = h.render();
  reader.props.model.setDraft(id, "latest keystroke");
  reader.props.model.send(id); await tick();
  assert.equal(h.asks.length, 2); assert.equal(h.asks[1].request.messages.at(-1).content, "latest keystroke");
  const sent = h.calls.findLast(([, command, args]) => command === "btw_window_intent" && args.intent.action === "send");
  // Same native callback delivery is deduplicated by the owner, not by the mock inference.
  h.deliverAgain(sent[2].intent);
  reader.props.model.send(id); await tick(); assert.equal(h.asks.length, 2);
  assert.ok(sent[2].intent.ownerEpoch.startsWith("native-"));
  reader = h.render(); reader.props.model.open(null); await tick(); assert.equal(h.model.getSnapshot().openId, null);
  h.model.open(id); await tick(); assert.equal(h.render().props.thread.status, "pending");
  assert.equal(h.asks.length, 2);
  ownerCleanup(); await tick();
  assert.equal(h.render().type, "main");
  childCleanup(); assert.ok(h.releases.length >= 2); h.model.dispose();
});

test("stream coalescing preserves same-thread reopen reveal and does not issue parallel publish", async () => {
  const h = transportHarness(); const cleanup = h.ownerSetup(); await tick();
  let release; const delayed = new Promise((resolve) => { release = resolve; }); h.pausePublish(delayed);
  const id = h.create(); await tick();
  h.model.setDraft(id, "a"); h.model.open(id); h.model.setDraft(id, "ab"); await tick();
  const before = h.calls.filter(([, command]) => command === "btw_window_publish").length;
  release(); await tick();
  const publications = h.calls.filter(([, command]) => command === "btw_window_publish");
  assert.equal(publications.length, before + 1);
  assert.equal(publications.at(-1)[2].snapshot.thread.draft, "ab");
  assert.equal(publications.at(-1)[2].reveal, true);
  cleanup(); h.model.dispose(); await tick();
});

test("selected palettes propagate through publish, ready replay, live updates and reopen", async () => {
  const h = transportHarness(); const cleanup = h.ownerSetup();
  const id = h.create(); await tick(); const childCleanup = h.childSetup(); await tick();
  assert.equal(h.dataset.theme, "dark");
  assert.equal(h.dataset.lightPalette, "warm-paper");
  assert.equal(h.dataset.darkPalette, "dracula-purple");
  const snapshot = h.calls.findLast(([, cmd]) => cmd === "btw_window_publish")[2].snapshot;
  assert.equal(snapshot.lightThemePalette, "warm-paper");
  assert.equal(snapshot.darkThemePalette, "dracula-purple");
  h.changeSettings({ theme: "light", lightThemePalette: "apple-mist", darkThemePalette: "github-dark" }); await tick();
  assert.equal(h.dataset.theme, "light");
  assert.equal(h.dataset.lightPalette, "apple-mist");
  assert.equal(h.dataset.darkPalette, "github-dark");
  childCleanup(); const reopenedCleanup = h.childSetup(); h.model.open(id); await tick();
  assert.equal(h.dataset.lightPalette, "apple-mist");
  assert.equal(h.dataset.darkPalette, "github-dark");
  reopenedCleanup(); cleanup(); h.model.dispose(); await tick();
});
