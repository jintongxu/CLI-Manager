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
function fixture(member = false, hidden = true, secondWorkspan = true) {
  const first = workspan.createTerminalWorkspan("w1", "p1", "a");
  const second = workspan.createTerminalWorkspan("w2", "p2", "b");
  const deep = { type: "split", id: "outer", direction: "horizontal", ratio: 0.5,
    first: pane.createPaneLeaf("left", ["a"], "a"),
    second: { type: "split", id: "inner", direction: "vertical", ratio: 0.5,
      first: pane.createPaneLeaf("middle", ["c"], "c"), second: pane.createPaneLeaf("deep", ["b"], "b") } };
  if (!secondWorkspan) first.paneTree = deep;
  const spans = secondWorkspan ? [first, second] : [first];
  let state = { sessions: [{ id: "a", title: "A" }, { id: "b", title: "B", tabHidden: hidden }, { id: "c", title: "C" }],
    ...layout.buildWorkspanMirror(spans, "w1"), fullscreenPaneId: "p1" };
  const calls = [], currentWorkIds = member ? ["a", "b"] : ["a"];
  let mode = true;
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
    currentWorkMode: mode, currentWorkSessionIds: currentWorkIds,
    activateCurrentWork: (id) => { assert.ok(currentWorkIds.includes(id)); calls.push(["activateMember", id]); },
    leaveCurrentWork: () => { mode = false; calls.push(["leave"]); },
    showTerminal: () => calls.push(["showTerminal"]),
    setActive: (id) => { calls.push(["setActive", id]); deps.action(id); },
  };
  return { options, calls, currentWorkIds, get state() { return state; }, get mode() { return mode; },
    delete(id) { state.sessions = state.sessions.filter((session) => session.id !== id); } };
}

for (const member of [true, false]) for (const hidden of [true, false]) for (const otherSpan of [true, false]) {
  test(`inspection ${member ? "member" : "nonmember"}, ${hidden ? "hidden" : "visible"}, ${otherSpan ? "other workspan" : "deep split"} uses source IDs without enrollment or process operations`, () => {
    const f = fixture(member, hidden, otherSpan);
    const beforeIds = [...f.currentWorkIds];
    const beforeTree = plain(f.state.workspans.map((span) => span.paneTree));
    assert.equal(navigation.navigateTerminalResource("b", f.options), true);
    assert.deepEqual(f.currentWorkIds, beforeIds);
    assert.equal(f.state.activeSessionId, "b");
    assert.equal(f.state.activeWorkspanId, otherSpan ? "w2" : "w1");
    assert.equal(f.state.activePaneId, otherSpan ? "p2" : "deep");
    assert.equal(f.state.sessions.find((session) => session.id === "b").tabHidden, hidden ? false : hidden);
    assert.equal(f.state.fullscreenPaneId, null);
    assert.equal(f.mode, member);
    if (member) assert.deepEqual(f.calls[0], ["activateMember", "b"]);
    else assert.deepEqual(f.calls.slice(0, 3), [["leave"], ["showTerminal"], ["setActive", "b"]]);
    assert.deepEqual(f.state.workspans.flatMap((span) => [...workspan.collectWorkspanSessionIds(span)]).sort(),
      otherSpan ? ["a", "b"] : ["a", "b", "c"]);
    // Same topology and memberships; only source active tabs can change.
    const shape = (tree) => tree.type === "leaf" ? [tree.id, [...tree.sessionIds]] : [tree.id, shape(tree.first), shape(tree.second)];
    assert.deepEqual(f.state.workspans.map((span) => plain(shape(span.paneTree))), beforeTree.map(shape));
    assert.equal(f.calls.some(([operation]) => /create|restore|kill|close|addMember/.test(operation)), false);
  });
}

test("deleted target does nothing, including no view change or membership mutation", () => {
  const f = fixture(false);
  f.delete("b");
  assert.equal(navigation.navigateTerminalResource("b", f.options), false);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.currentWorkIds, ["a"]); assert.equal(f.mode, true);
});

test("ordinary mode source target does not enter current work", () => {
  const f = fixture(false);
  f.options.currentWorkMode = false;
  navigation.navigateTerminalResource("b", f.options);
  assert.deepEqual(f.calls.slice(0, 2), [["showTerminal"], ["setActive", "b"]]);
});

test("actual extracted listener validates event and live sessions before resource navigation", () => {
  const listeners = new Map(), calls = [];
  const effects = [];
  const { useTerminalNavigationListeners } = load("../hooks/useTerminalNavigationListeners.ts", {
    ...navigation, useEffect: (fn) => effects.push(fn),
    CURRENT_WORK_ACTION_EVENT: "action", CURRENT_WORK_TARGET_EVENT: "target",
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) },
    useTerminalStore: { getState: () => ({ sessions: [{ id: "live" }] }) },
    useHistoryStore: { getState: () => ({ closeHistory: () => calls.push("history") }) },
  });
  useTerminalNavigationListeners({ currentWorkMode: true, currentWorkSessionIds: ["member"],
    currentWorkActiveSessionId: "member", activeSessionId: "member",
    activateCurrentWork: () => calls.push("member"), activateCurrentWorkSession: () => { assert.fail("inspection cannot use add-capable action"); },
    leaveCurrentWork: () => calls.push("leave"), clearCurrentWork() {}, toggleCurrentWork() {}, removeCurrentWorkSessions() {},
    setActive: (id) => calls.push(id), setActiveWorkspaceTab: (tab) => calls.push(tab),
  });
  const cleanups = effects.map((fn) => fn());
  const target = listeners.get(navigation.TERMINAL_RESOURCE_TARGET_EVENT);
  target({ detail: { sessionId: "deleted" } }); target({ detail: {} }); assert.deepEqual(calls, []);
  target({ detail: { sessionId: "live" } });
  assert.deepEqual(calls, ["leave", "history", "terminal", "live"]);
  cleanups.forEach((fn) => fn()); assert.equal(listeners.size, 0);
});

test("current-work member in deep split exits incompatible current-work fullscreen without changing members", () => {
  const calls = [], listeners = new Map();
  const tree = { type: "split", id: "s", direction: "horizontal", ratio: 0.5,
    first: pane.createPaneLeaf("focus", ["a"], "a"), second: pane.createPaneLeaf("deep", ["b"], "b") };
  const { useTerminalNavigationListeners } = load("../hooks/useTerminalNavigationListeners.ts", {
    ...navigation, ...pane, useEffect: (fn) => fn(),
    CURRENT_WORK_ACTION_EVENT: "action", CURRENT_WORK_TARGET_EVENT: "target",
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} },
    useTerminalStore: { getState: () => ({ sessions: [{ id: "a" }, { id: "b" }] }) },
  });
  const ids = ["a", "b"];
  useTerminalNavigationListeners({ currentWorkMode: true, currentWorkSessionIds: ids,
    currentWorkPaneTree: tree, currentWorkFullscreenPaneId: "focus",
    toggleCurrentWorkPaneFullscreen: (id) => calls.push(["unfocus", id]),
    activateCurrentWork: (id) => calls.push(["activate", id]),
    setActive: (id) => calls.push(["source", id]),
  });
  listeners.get(navigation.TERMINAL_RESOURCE_TARGET_EVENT)({ detail: { sessionId: "b" } });
  assert.deepEqual(calls, [["unfocus", "focus"], ["activate", "b"], ["source", "b"]]);
  assert.deepEqual(ids, ["a", "b"]);
});
