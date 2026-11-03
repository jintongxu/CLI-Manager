import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const base = "../src/features/terminal/";
function load(path, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(base + path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in deps, id); return deps[id]; } });
  return exports;
}
const controller = load("hooks/terminalResourceDeletion.ts");
const model = load("lib/terminalResourceModel.ts", { "../api/terminalResources": { TERMINAL_RESOURCE_PAGE_SIZE: 64 } });
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test("real store strict-close branch waits for ephemeral Pi PTY and propagates failure", async () => {
  const source = readFileSync(new URL(base + "store/terminalStore.ts", import.meta.url), "utf8");
  const start = source.indexOf("      if (requireBackendClose &&");
  const end = source.indexOf("      const isTranscript =", start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("closingSession", "requireBackendClose", "closeTerminalSource",
    "terminalProcessManager", "releaseProviderSnapshot", "releaseProjectExtensionSnapshot", "id",
    source.slice(start, end));
  for (const kind of [undefined, "pty", "ephemeral-pi"]) {
    const pending = gate(), calls = [], releases = [];
    let settled = false;
    const session = { id: "s", kind };
    const operation = run(session, true, async value => { calls.push(value); await pending.promise; },
      {}, () => releases.push("provider"), () => releases.push("extension"), "s").then(() => { settled = true; });
    await Promise.resolve();
    assert.deepEqual(calls, [session]); assert.equal(settled, false); assert.deepEqual(releases, []);
    pending.resolve(); await operation; assert.equal(releases.length, 2);
    await assert.rejects(run(session, true, async () => { throw new Error("close failed"); },
      {}, () => assert.fail("must retain provider"), () => assert.fail("must retain extension"), "s"), /close failed/);
  }
});
function fixture(extra = {}, source = {}) {
  let sessions = [{ id: "s", title: "Shell", createdAtMs: 1, ...source }];
  const original = sessions[0], calls = [], errors = [], busy = [];
  const input = {
    t: (key, values) => key + JSON.stringify(values ?? {}),
    getSession: id => sessions.find(s => s.id === id),
    closeSession: async (id, strict) => { calls.push([id, strict]); sessions = sessions.filter(s => s.id !== id); },
    confirm: async () => true, setPending: id => busy.push(id), showError: text => errors.push(text), ...extra,
  };
  return { original, input, calls, errors, busy, run: controller.createTerminalResourceDeletion(input),
    get sessions() { return sessions; }, set sessions(v) { sessions = v; } };
}
test("cancel confirms danger and exact target, retains session and clears pending", async () => {
  let options;
  const f = fixture({ confirm: async value => { options = value; return false; } });
  await f.run(f.original);
  assert.equal(options.danger, true); assert.match(options.message, /Shell/); assert.match(options.message, /\"id\":\"s\"/);
  assert.equal(f.sessions.length, 1); assert.deepEqual(f.calls, []); assert.deepEqual(f.busy, ["s", null]);
});
test("pending synchronously covers confirmation and backend completion; duplicates suppressed", async () => {
  const confirm = gate(), close = gate();
  const f = fixture({ confirm: () => confirm.promise, closeSession: async (id, strict) => { f.calls.push([id, strict]); await close.promise; f.sessions = []; } });
  const first = f.run(f.original);
  assert.deepEqual(f.busy, ["s"]); await f.run(f.original); assert.equal(f.calls.length, 0);
  confirm.resolve(true); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.calls, [["s", true]]);
  assert.equal(f.sessions.length, 1); await f.run(f.original); assert.equal(f.calls.length, 1);
  close.resolve(); await first; assert.equal(f.sessions.length, 0); assert.deepEqual(f.busy, ["s", null]);
});
test("failed strict close retains target, shows error, releases guard for retry", async () => {
  let fail = true;
  const f = fixture({ closeSession: async (id, strict) => { f.calls.push([id, strict]); if (fail) throw Error("backend failed"); f.sessions = []; } });
  await f.run(f.original); assert.equal(f.sessions.length, 1); assert.match(f.errors[0], /deleteFailed/);
  assert.equal(f.busy.at(-1), null); fail = false; await f.run(f.original); assert.equal(f.calls.length, 2); assert.equal(f.sessions.length, 0);
});
for (const change of ["missing", "createdAtMs", "environmentType", "sshHostId", "wslDistroName", "kind", "remoteHandoff", "cwd"]) {
  test(`confirmation aborts if live target changes: ${change}`, async () => {
    const g = gate(); const f = fixture({ confirm: () => g.promise }); const p = f.run(f.original);
    f.sessions = change === "missing" ? [] : [{ ...f.original, [change]: change === "createdAtMs" ? 2 : change === "remoteHandoff" ? { phase: "ready" } : "changed" }];
    g.resolve(true); await p; assert.equal(f.calls.length, 0); assert.match(f.errors[0], /deleteChanged/); assert.equal(f.busy.at(-1), null);
  });
}
test("legacy identity cannot be replaced; stale rendered target cannot open confirmation", async () => {
  let confirmed = 0; const f = fixture({ confirm: async () => { confirmed++; return true; } }, { createdAtMs: undefined });
  f.sessions = [{ ...f.original }]; await f.run(f.original); assert.equal(confirmed, 0); assert.equal(f.calls.length, 0);
  const g = gate(), other = fixture({ confirm: () => g.promise }, { createdAtMs: undefined });
  const p = other.run(other.original); other.sessions = [{ ...other.original }]; g.resolve(true); await p; assert.equal(other.calls.length, 0);
});
for (const source of [
  { environmentType: "local" }, { environmentType: "wsl", wslDistroName: "Ubuntu" },
  { environmentType: "ssh", sshHostId: "host" }, { tabHidden: true }, { kind: "ephemeral-pi" },
]) test(`strict close supports ${JSON.stringify(source)} without sampling/launch prerequisites`, async () => {
  const f = fixture({}, { ...source, projectId: "other", worktreeId: "missing", cwd: undefined });
  await f.run(f.original); assert.deepEqual(f.calls, [["s", true]]); assert.equal(f.sessions.length, 0);
});
test("presentation and connection status changes do not change process identity", async () => {
  const g = gate(), f = fixture({ confirm: () => g.promise }); const p = f.run(f.original);
  f.sessions = [{ ...f.original, title: "renamed", tabHidden: true, connectionState: "disconnected" }];
  g.resolve(true); await p; assert.deepEqual(f.calls, [["s", true]]);
});
test("last-page deletion recomputes subscribed originals and clamps, including empty list", async () => {
  const f = fixture(); f.sessions = Array.from({ length: 65 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, title: "shell", createdAtMs: i }));
  const before = model.terminalResourcePage(model.terminalResourceSessions(f.sessions), 1);
  assert.equal(before.sessions.length, 1); await f.run(before.sessions[0]);
  const after = model.terminalResourcePage(model.terminalResourceSessions(f.sessions), 1);
  assert.equal(after.page, 0); assert.equal(after.sessions.length, 64);
  f.sessions = [f.original]; await f.run(f.original);
  const empty = model.terminalResourcePage(model.terminalResourceSessions(f.sessions), 1);
  assert.equal(empty.page, 0); assert.equal(empty.pages, 1); assert.equal(empty.sessions.length, 0);
});

function panelHarness() {
  let cursor = 0; const hooks = [], confirmation = gate(), errors = [], calls = [];
  let sessions = [{ id: "s", title: "SSH shell", createdAtMs: 1, environmentType: "ssh", tabHidden: true }];
  const store = Object.assign(selector => selector({ sessions, sessionStatuses: { s: "exited" }, tabStatuses: {} }), {
    getState: () => ({ sessions, closeSession: async (id, strict) => { calls.push([id, strict]); sessions = []; } }),
  });
  const jsx = (type, props) => ({ type, props });
  const { TerminalResourcesPanel } = load("components/TerminalResourcesPanel.tsx", {
    react: {
      useMemo: fn => fn(),
      useRef: value => { const i = cursor++; return hooks[i] ??= { current: value }; },
      useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => { hooks[i] = value; }]; },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": { RefreshCw: "refresh", Trash2: "trash" },
    sonner: { toast: { error: message => errors.push(message) } },
    "../../../shared/ui/useAppConfirm": { useAppConfirm: () => ({ confirm: () => confirmation.promise, confirmDialog: { type: "dialog", props: {} } }) },
    "../../../shared/i18n": { useI18n: () => ({ t: key => key, language: "en-US" }) },
    "../../projects/api/projectStore": { useProjectStore: fn => fn({ projects: [] }) },
    "../../projects/api/worktreeStore": { useWorktreeStore: fn => fn({ worktrees: [] }) },
    "../../stats/api/termStatsUi": { TERM_PANEL: {} }, "../state": { useTerminalStore: store },
    "../api/terminalProject": { findWorktreeForSession: () => null, resolveProjectForSession: () => null },
    "../hooks/useTerminalResources": { useTerminalResources: () => ({ snapshot: null, error: "unsupported_remote", loading: false, refresh() {} }) },
    "../lib/terminalResourceModel": model, "../hooks/terminalResourceDeletion": controller,
    "../lib/terminalResourceNavigation": { dispatchTerminalResourceTarget: () => calls.push("locate") },
  });
  return { render: (active = true) => { cursor = 0; return TerminalResourcesPanel({ active }); }, confirmation, calls, errors };
}
function nodes(tree) { return !tree || typeof tree !== "object" ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
test("actual panel renders sibling locate/delete, preserves guard across rerenders and follows store removal", async () => {
  const h = panelHarness(), tree = h.render();
  const row = nodes(tree).find(n => n.type === "li"), buttons = nodes(row).filter(n => n.type === "button");
  assert.equal(buttons.length, 2); assert.equal(nodes(buttons[0]).filter(n => n.type === "button").length, 1);
  const first = buttons[1].props.onClick();
  let current = nodes(h.render()).find(n => n.type === "button" && n.props["aria-busy"]);
  assert.equal(current.props.disabled, true); current.props.onClick(); assert.equal(h.calls.length, 0);
  assert.ok(nodes(h.render(false)).some(n => n.type === "dialog"));
  h.confirmation.resolve(true); await Promise.resolve(); await Promise.resolve(); await first;
  assert.deepEqual(h.calls, [["s", true]]); assert.equal(nodes(h.render()).filter(n => n.type === "li").length, 0);
  assert.equal(h.errors.length, 0);
});
test("new deletion translations have exact locale parity", () => {
  const keys = lang => [...readFileSync(new URL(`../src/shared/i18n/messages/terminal.${lang}.ts`, import.meta.url), "utf8").matchAll(/"(terminal\.resources\.(?:delete\w*|deleting))":/g)].map(m => m[1]).sort();
  assert.equal(keys("en-US").length, 7); assert.deepEqual(keys("en-US"), keys("zh-CN"));
});
