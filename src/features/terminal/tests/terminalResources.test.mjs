import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
function loader(mocks = {}) {
  mocks = { "@tauri-apps/api/core": { invoke() { assert.fail("unexpected native call"); } }, ...mocks };
  const cache = new Map();
  function load(path) {
    const full = resolve(root, path);
    if (cache.has(full)) return cache.get(full);
    const exports = {};
    cache.set(full, exports);
    const output = ts.transpileModule(readFileSync(full, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(output, { exports, TextEncoder, Error, Set, console, setInterval, clearInterval,
      document: mocks.document,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith(".")) return load(resolve(dirname(full), `${name}.ts`));
        throw new Error(`Unmocked dependency ${name}`);
      },
    }, { filename: full });
    return exports;
  }
  return load;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const row = (sessionId, bytes = 123, extra = {}) => ({ sessionId, status: "complete", reasonCodes: [], rootPid: 42,
  rootCreatedFiletime: "134444444444444444", coverage: "job_members", enumeratedCount: 2, observedCount: 2,
  workingSetSumBytes: bytes, ...extra });
const snapshot = (ids = ["a"]) => ({ sampledAt: 1700000000000, daemonEpoch: "epoch", revision: "90071992547409930", rows: ids.map((id) => row(id)) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fakeClock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setInterval(fn, ms) { timers.set(++id, { fn, ms, at: now + ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; next[1].at += next[1].ms; next[1].fn();
      }
      now = end;
    },
    get size() { return timers.size; },
  };
}
function pollFixture() {
  const calls = [], changes = [], clock = fakeClock();
  const api = loader({ "@tauri-apps/api/core": { invoke() { assert.fail("unexpected native call"); } } })("lib/terminalResourcePolling.ts");
  const gate = { busy: false, waiting: new Set() };
  const request = (ids) => { const result = deferred(); calls.push({ ids: [...ids], ...result }); return result.promise; };
  const make = () => api.createTerminalResourcePoller(request, (state) => changes.push(state), gate, clock);
  return { calls, changes, clock, make, get state() { return changes.at(-1); } };
}

test("native API uses session IDs only; DTO copies exact privacy allowlist and precision strings", async () => {
  const calls = [];
  const value = snapshot();
  value.env = "secret"; value.rows[0].command = "secret"; value.rows[0].executable = "secret";
  const api = loader({ "@tauri-apps/api/core": { async invoke(...args) { calls.push(args); return value; } } })("api/terminalResources.ts");
  const result = await api.getTerminalResources(["a", "a"]);
  assert.deepEqual(plain(calls), [["terminal_resources_get_snapshot", { sessionIds: ["a"] }]]);
  assert.equal(result.revision, "90071992547409930");
  assert.equal(result.rows[0].rootCreatedFiletime, "134444444444444444");
  assert.deepEqual(Object.keys(result).sort(), ["daemonEpoch", "revision", "rows", "sampledAt"]);
  assert.deepEqual(Object.keys(result.rows[0]).sort(), Object.keys(row("a")).sort());
  assert.doesNotMatch(JSON.stringify(result), /secret|command|executable|env/);
});

test("native API validates pre-dedup 64 bound and UTF8 ID lengths without invoking", async () => {
  let count = 0;
  const api = loader({ "@tauri-apps/api/core": { invoke() { count++; } } })("api/terminalResources.ts");
  for (const ids of [Array(65).fill("a"), [""], ["中".repeat(86)]]) await assert.rejects(api.getTerminalResources(ids), /invalid_request/);
  assert.equal(count, 0);
});

test("DTO rejects foreign/duplicate rows, unsafe numbers, unknown reasons, fabricated empty zero", () => {
  const api = loader()("api/terminalResources.ts");
  for (const rows of [[row("foreign")], [row("a"), row("a")], [row("a", NaN)],
    [row("a", 0, { observedCount: 0 })], [row("a", 1, { status: "unavailable" })],
    [row("a", 1, { reasonCodes: ["raw-secret-os-error"] })]]) {
    assert.throws(() => api.parseTerminalResourceSnapshot({ ...snapshot(), rows }, ["a"]), /unavailable/);
  }
  const unknown = row("a", null, { status: "unavailable", observedCount: 0, reasonCodes: ["unsupported_remote"] });
  assert.equal(api.parseTerminalResourceSnapshot({ ...snapshot(), rows: [unknown] }, ["a"]).rows[0].workingSetSumBytes, null);
});

test("only fixed native errors may be exposed", () => {
  const api = loader()("api/terminalResources.ts");
  assert.equal(api.terminalResourceError(new Error("token=secret C:/private")), "terminal_resources_unavailable");
  assert.equal(api.terminalResourceError("terminal_resources_unsupported"), "terminal_resources_unsupported");
});

test("original PTY IDs dedup with hidden/Pi sessions, excluding metadata and foreign handoffs", () => {
  const model = loader()("lib/terminalResourceModel.ts");
  const sessions = [{ id: "a", tabHidden: true }, { id: "a" }, { id: "b", kind: "ephemeral-pi" },
    { id: "editor", kind: "file-editor" }, { id: "history", kind: "synced-history" },
    { id: "agent", kind: "subagent-transcript" }, { id: "foreign", remoteHandoff: {} }];
  assert.deepEqual(plain(model.terminalResourceSessions(sessions)).map((s) => s.id), ["a", "b"]);
  assert.equal(model.terminalResourceSessions(sessions)[0].tabHidden, true);
});

test("64 original-ID pages precede local sorting, valid desc/unknown-last/stable-ID; no global top", () => {
  const model = loader()("lib/terminalResourceModel.ts");
  const sessions = Array.from({ length: 66 }, (_, i) => ({ id: String(i).padStart(3, "0") }));
  const page = model.terminalResourcePage(sessions, 0);
  assert.equal(page.sessions.length, 64); assert.equal(page.pages, 2);
  const rows = [row("001", 0), row("002", 99), row("003", 99), row("004", null, { observedCount: 0 }), row("065", 9999)];
  const sorted = model.sortTerminalResourcePage(page.sessions, rows);
  assert.deepEqual(plain(sorted.slice(0, 4)).map((s) => s.id), ["002", "003", "001", "000"]);
  assert.equal(sorted.some((s) => s.id === "065"), false);
  assert.equal(model.terminalResourcePage(sessions, 999).page, 1);
});

test("polls immediately and at 2500ms, never overlaps even while timer/manual refresh fire", async () => {
  const f = pollFixture(), p = f.make();
  p.configure(true, ["a"], "client-1");
  assert.equal(f.calls.length, 1);
  f.clock.tick(10000); void p.refresh(); assert.equal(f.calls.length, 1);
  f.calls[0].resolve(snapshot()); await flush(); assert.equal(f.calls.length, 1);
  f.clock.tick(2499); assert.equal(f.calls.length, 1);
  f.clock.tick(1); assert.equal(f.calls.length, 2);
  p.dispose(); f.calls[1].resolve(snapshot()); await flush();
});

for (const late of ["success", "error"]) test(`hide/page/session/incarnation changes discard late ${late} and wake after settlement`, async () => {
  const f = pollFixture(), p = f.make();
  p.configure(true, ["a"], "client-1");
  p.configure(false, ["a"], "client-1"); f.clock.tick(10000);
  p.configure(true, ["b"], "client-2");
  assert.equal(f.calls.length, 1); assert.equal(f.state.snapshot, null);
  if (late === "success") f.calls[0].resolve(snapshot()); else f.calls[0].reject("terminal_resources_owner_rejected");
  await flush();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].ids, ["b"]);
  assert.equal(f.state.error, null); assert.equal(f.state.snapshot, null);
  f.calls[1].resolve(snapshot(["b"])); await flush(); assert.equal(f.state.snapshot.rows[0].sessionId, "b");
  p.dispose();
});

test("unmount/new panel keeps one unresolved native call globally", async () => {
  const f = pollFixture(), p = f.make();
  p.configure(true, ["a"], "same"); p.dispose();
  const next = f.make(); next.configure(true, ["b"], "same");
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(snapshot()); await flush(); assert.equal(f.calls.length, 2);
  assert.equal(f.state.snapshot, null); next.dispose(); f.calls[1].resolve(snapshot(["b"])); await flush();
  assert.equal(f.clock.size, 0);
});

test("hidden view stays stopped on settlement; empty pages never invoke", async () => {
  const f = pollFixture(), p = f.make();
  p.configure(true, ["a"], "same"); p.configure(false, ["a"], "same");
  f.calls[0].resolve(snapshot()); await flush(); f.clock.tick(30000);
  assert.equal(f.calls.length, 1); assert.equal(f.state.snapshot, null);
  p.configure(true, [], "same"); f.clock.tick(10000); assert.equal(f.calls.length, 1); p.dispose();
});

// Execute the actual React hook with deterministic effect scheduling and document/native mocks.
function hookFixture() {
  const slots = [], effects = [], calls = [], listeners = new Map();
  let cursor = 0, disconnect;
  const document = { visibilityState: "visible", addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (value) => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; const previous = slots[i];
      if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  react.useLayoutEffect = react.useEffect;
  const api = loader({ react, document,
    "../api/TerminalProcessManager": { terminalProcessManager: { subscribeDisconnect(fn) { disconnect = fn; return () => { disconnect = undefined; }; } } },
    "@tauri-apps/api/core": { invoke(command, payload) { const result = deferred(); calls.push({ command, payload, ...result }); return result.promise; } },
  })("hooks/useTerminalResources.ts");
  return { calls, document, listeners,
    render(active = true, ids = ["a"], identity = "native-client-1") { cursor = 0; const result = api.useTerminalResources(active, ids, identity); effects.splice(0).forEach((fn) => fn()); return result; },
    visibility(state) { document.visibilityState = state; listeners.get("visibilitychange")(); },
    disconnect() { disconnect(); },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("actual hook gates document/panel visibility and drops pending native results on transport incarnation", async () => {
  const f = hookFixture();
  f.render(false); assert.equal(f.calls.length, 0);
  f.render(); assert.equal(f.calls.length, 1);
  f.visibility("hidden"); f.render();
  f.calls[0].resolve(snapshot()); await flush(); assert.equal(f.render().snapshot, null);
  f.visibility("visible"); f.render(); assert.equal(f.calls.length, 2);
  f.disconnect(); f.render(); assert.equal(f.calls.length, 2);
  f.calls[1].reject("terminal_resources_owner_rejected"); await flush();
  assert.equal(f.calls.length, 3); assert.equal(f.render().error, null);
  f.calls[2].resolve(snapshot()); await flush(); assert.equal(f.render().snapshot.daemonEpoch, "epoch");
  f.dispose();
});

test("bilingual copy covers all reasons and explains page-local/shared-page semantics; no kill control", () => {
  const load = loader();
  const zh = load("../../shared/i18n/messages/terminal.zh-CN.ts").zh;
  const en = load("../../shared/i18n/messages/terminal.en-US.ts").en;
  for (const reason of load("api/terminalResources.ts").TERMINAL_RESOURCE_REASONS) {
    assert.ok(zh[`terminal.resources.reason.${reason}`]); assert.ok(en[`terminal.resources.reason.${reason}`]);
  }
  assert.match(en["terminal.resources.explanation"], /Shared pages.*not private memory/);
  assert.match(en["terminal.resources.pageSort"], /Not a global ranking/);
  const panel = readFileSync(resolve(root, "components/TerminalResourcesPanel.tsx"), "utf8");
  assert.match(panel, /hour12: false/);
  assert.doesNotMatch(panel, /hardKill|closeSession|interruptSession|envVars|startupCmd/);
});

test("actual SystemResourcesPanel defaults to System and pauses its collector while Terminals is selected", () => {
  const sourceText = readFileSync(resolve(root, "components/SystemResourcesPanel.tsx"), "utf8");
  const source = ts.createSourceFile("SystemResourcesPanel.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = source.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(source)).join("\n");
  const output = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const collector = [], exports = {};
  let tab = "system";
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(output, { exports, require: () => ({ jsx, jsxs: jsx }),
    useI18n: () => ({ t: (key) => key }), useId: () => "resource-instance",
    useState: () => [tab, (value) => { tab = value; }], useMemo: (fn) => fn(),
    useSettingsStore: (select) => select({ systemResourceCardVisibility: { system: true }, systemResourceCardOrder: ["system"] }),
    SYSTEM_RESOURCE_CARD_KEYS: ["system"], TERM_PANEL: {}, panelColorTint: () => "color",
    useSystemResources: (active) => { collector.push(active); return { snapshot: null, history: [], loading: false, error: null, refresh() {} }; },
    TerminalResourcesPanel: "TerminalResourcesPanel", TerminalPanelHeader: "TerminalPanelHeader", Server: "Server", RefreshCw: "RefreshCw",
  });
  const flatten = (element) => !element || typeof element !== "object" ? [] : [element,
    ...[element.props?.children].flat(Infinity).flatMap(flatten)];
  const render = (props) => flatten(exports.SystemResourcesPanel({ open: true, ...props }));
  let tree = render();
  assert.equal(collector.at(-1), true);
  const terminals = tree.find((element) => element.props?.role === "tab" && element.props.children === "terminal.resources.terminalsTab");
  terminals.props.onClick(); tree = render();
  assert.equal(collector.at(-1), false);
  assert.equal(tree.find((element) => element.type === "TerminalResourcesPanel").props.active, true);
  tree = render({ visible: false });
  assert.equal(collector.at(-1), false);
  assert.equal(tree.find((element) => element.type === "TerminalResourcesPanel").props.active, false);
});

test("actual merged/independent composition stops resource polling when CSS hides the panel or history covers it", () => {
  function attribute(path, component, name) {
    const text = readFileSync(resolve(root, path), "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression;
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === component) {
        const prop = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === name);
        expression = prop?.initializer && ts.isJsxExpression(prop.initializer) ? prop.initializer.expression?.getText(source) : undefined;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(expression, `${path}: ${component}.${name} must carry real visibility`);
    return (values) => vm.runInNewContext(expression, values);
  }
  const independent = attribute("components/TerminalTabsView.tsx", "SystemResourcesPanel", "visible");
  const merged = attribute("components/TerminalTabsView.tsx", "TerminalSidePanel", "resourcesVisible");
  const forwarded = attribute("components/TerminalSidePanel.tsx", "SystemResourcesPanel", "visible");
  for (const terminalSidePanelVisible of [false, true]) for (const historyActive of [false, true]) {
    const values = { terminalSidePanelVisible, historyActive };
    const expected = terminalSidePanelVisible && !historyActive;
    assert.equal(independent(values), expected);
    assert.equal(merged(values), expected);
    assert.equal(forwarded({ resourcesVisible: merged(values), activeTab: "systemResources" }), expected);
    assert.equal(forwarded({ resourcesVisible: merged(values), activeTab: "stats" }), false);
  }
});
