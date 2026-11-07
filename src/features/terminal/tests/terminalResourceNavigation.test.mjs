import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const sourceText = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter((node) => !ts.isImportDeclaration(node)
    && !(ts.isExportDeclaration(node) && node.moduleSpecifier)).map((node) => node.getText(source)).join("\n");
  const output = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, ...dependencies }, { filename: path });
  return exports;
}
const navigation = load("../lib/terminalResourceNavigation.ts");
const pane = load("../api/terminalPaneTree.ts");
const workspan = load("../api/terminalWorkspan.ts", pane);
const visibility = load("../lib/terminalTabVisibility.ts", pane);
const layout = load("../lib/terminalStoreLayout.ts", visibility);
const plain = (value) => JSON.parse(JSON.stringify(value));

// Execute the real setActive implementation, with only persistence/native boundaries mocked.
const storeText = readFileSync(new URL("../store/terminalStore.ts", import.meta.url), "utf8");
const activeText = storeText.slice(storeText.indexOf("    setActive: (id) => {"), storeText.indexOf("    setWorkspanModeEnabled:"));
function fixture(hidden = true, secondWorkspan = true) {
  const first = workspan.createTerminalWorkspan("w1", "p1", "a");
  const second = workspan.createTerminalWorkspan("w2", "p2", "b");
  const deep = { type: "split", id: "outer", direction: "horizontal", ratio: 0.5,
    first: pane.createPaneLeaf("left", ["a"], "a"),
    second: { type: "split", id: "inner", direction: "vertical", ratio: 0.5,
      first: pane.createPaneLeaf("middle", ["c"], "c"), second: pane.createPaneLeaf("deep", ["b"], "b") } };
  if (!secondWorkspan) first.paneTree = deep;
  const spans = secondWorkspan ? [first, second] : [first];
  let state = { sessions: [{ id: "a", title: "A" }, { id: "b", title: "B", tabHidden: hidden }, { id: "c", title: "C" }],
    dormantRestoredSessionIds: new Set(),
    ...layout.buildWorkspanMirror(spans, "w1"), fullscreenPaneId: "p1" };
  const calls = [];
  const deps = { ...pane, ...workspan, ...layout,
    get: () => state, set: (update) => { state = { ...state, ...update }; },
    scheduleSaveActiveId: (id) => calls.push(["persistActive", id]),
    persistWorkspanState: () => calls.push(["persistLayout"]),
    queueSshSessionPersistence: async () => calls.push(["persistUnhide"]),
  };
  const output = ts.transpileModule(`globalThis.action = ({${activeText}}).setActive;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, deps);
  const options = {
    exists: (id) => state.sessions.some((session) => session.id === id),
    showTerminal: () => calls.push(["showTerminal"]),
    setActive: (id) => { calls.push(["setActive", id]); deps.action(id); },
  };
  return { options, calls, get state() { return state; },
    delete(id) { state.sessions = state.sessions.filter((session) => session.id !== id); } };
}

for (const hidden of [true, false]) for (const otherSpan of [true, false]) {
  test(`canonical inspection ${hidden ? "hidden" : "visible"}, ${otherSpan ? "other workspan" : "deep split"} uses source IDs without enrollment or process operations`, () => {
    const f = fixture(hidden, otherSpan);
    const beforeTree = plain(f.state.workspans.map((span) => span.paneTree));
    assert.equal(navigation.navigateTerminalResource("b", f.options), true);
    assert.equal(f.state.activeSessionId, "b");
    assert.equal(f.state.activeWorkspanId, otherSpan ? "w2" : "w1");
    assert.equal(f.state.activePaneId, otherSpan ? "p2" : "deep");
    assert.equal(f.state.sessions.find((session) => session.id === "b").tabHidden, hidden ? false : hidden);
    assert.equal(f.state.fullscreenPaneId, null);
    assert.deepEqual(f.calls.slice(0, 2), [["showTerminal"], ["setActive", "b"]]);
    assert.deepEqual(f.state.workspans.flatMap((span) => [...workspan.collectWorkspanSessionIds(span)]).sort(),
      otherSpan ? ["a", "b"] : ["a", "b", "c"]);
    // Same topology and memberships; only source active tabs can change.
    const shape = (tree) => tree.type === "leaf" ? [tree.id, [...tree.sessionIds]] : [tree.id, shape(tree.first), shape(tree.second)];
    assert.deepEqual(f.state.workspans.map((span) => plain(shape(span.paneTree))), beforeTree.map(shape));
    assert.equal(f.calls.some(([operation]) => /create|restore|kill|close|addMember/.test(operation)), false);
  });
}

test("deleted target does nothing, including no view change or process operation", () => {
  const f = fixture();
  f.delete("b");
  const before = plain(f.state);
  assert.equal(navigation.navigateTerminalResource("b", f.options), false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(plain(f.state), before);
});

for (const eventName of ["cli-manager:terminal-session-target", navigation.TERMINAL_RESOURCE_TARGET_EVENT]) {
  test(`canonical listener validates live targets and cleans up: ${eventName}`, () => {
    const listeners = new Map(), calls = [], effects = [];
    let sessions = [{ id: "live" }];
    const { useTerminalNavigationListeners } = load("../hooks/useTerminalNavigationListeners.ts", {
      ...navigation, TERMINAL_SESSION_TARGET_EVENT: "cli-manager:terminal-session-target", useEffect: (fn) => effects.push(fn),
      showProjectSpace: () => calls.push("project"),
      window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => {
        assert.equal(listeners.get(name), fn); listeners.delete(name);
      } },
      useTerminalStore: { getState: () => ({ sessions }) },
      useHistoryStore: { getState: () => ({ closeHistory: () => calls.push("history") }) },
    });
    useTerminalNavigationListeners({ setActive: (id) => calls.push(id), setActiveWorkspaceTab: (tab) => calls.push(tab) });
    const cleanups = effects.map((fn) => fn());
    assert.deepEqual([...listeners.keys()].sort(), ["cli-manager:terminal-session-target", navigation.TERMINAL_RESOURCE_TARGET_EVENT].sort());
    const target = listeners.get(eventName);
    for (const event of [{}, { detail: {} }, { detail: { sessionId: 4 } }, { detail: { sessionId: "deleted" } }]) target(event);
    assert.deepEqual(calls, []);
    target({ detail: { sessionId: "live" } });
    assert.deepEqual(calls, ["project", "history", "terminal", "live"]);
    sessions = [];
    target({ detail: { sessionId: "live" } });
    assert.equal(calls.length, 4, "listener rechecks live state instead of restoring a deleted owner");
    cleanups.forEach((fn) => fn());
    assert.equal(listeners.size, 0);
  });
}
