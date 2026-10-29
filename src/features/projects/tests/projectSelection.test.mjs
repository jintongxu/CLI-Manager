import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const url = new URL("../hooks/useSidebarController.tsx", import.meta.url);
const file = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && ["handleSelectProject", "handleSelectProjectByKeyboard", "handleSelectWorktree"].includes(node.name.text)) {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);
function fixture({ selected = [], anchor = null, scoped = true } = {}) {
  const state = { selectedId: "old", projects: new Set(selected), worktrees: new Set(["w1"]), groups: new Set(["g1"]) };
  const calls = [];
  const update = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const env = {
    setSelectedId: update("selectedId"), setSelectedProjectIds: update("projects"),
    setSelectedWorktreeIds: update("worktrees"), setSelectedGroupIds: update("groups"),
    selectionAnchorRef: { current: anchor }, selectedProjectIds: state.projects,
    visibleProjectIds: ["p1", "p2", "p3"], projectScopedTerminalViewEnabled: scoped,
    onTerminalScopeChange: (...args) => calls.push(["scope", ...args]),
    activateFirstProjectSession: (...args) => { calls.push(["activate", ...args]); return true; },
    closeHistory: () => calls.push(["history"]),
  };
  return { state, calls, env, run(name, ...args) {
    const callback = callbacks.get(name); assert.ok(callback, name);
    const js = ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return vm.runInNewContext(js, env)(...args);
  } };
}

test("ordinary mouse selection preserves the page with scoped navigation enabled or disabled", () => {
  for (const scoped of [true, false]) {
    const f = fixture({ scoped });
    f.run("handleSelectProject", {}, { id: "p2" });
    assert.equal(f.state.selectedId, "p2");
    assert.deepEqual([...f.state.projects], ["p2"]);
    assert.equal(f.state.groups.size, 0);
    assert.equal(f.state.worktrees.size, 0);
    assert.equal(f.env.selectionAnchorRef.current, "p2");
    assert.deepEqual(f.calls, []);
  }
});

test("Ctrl/Cmd toggle and Shift ranges change only sidebar selection", () => {
  for (const key of ["ctrlKey", "metaKey"]) {
    const add = fixture({ selected: ["p1"] });
    add.run("handleSelectProject", { [key]: true }, { id: "p2" });
    assert.deepEqual([...add.state.projects], ["p1", "p2"]);
    assert.deepEqual(add.calls, []);
    const remove = fixture({ selected: ["p2"] });
    remove.state.selectedId = "p2";
    remove.run("handleSelectProject", { [key]: true }, { id: "p2" });
    assert.equal(remove.state.projects.size, 0);
    assert.equal(remove.state.selectedId, null);
    assert.deepEqual(remove.calls, []);
  }
  for (const additive of [false, true]) {
    const f = fixture({ selected: ["p3"], anchor: "p1" });
    f.run("handleSelectProject", { shiftKey: true, ctrlKey: additive }, { id: "p2" });
    assert.deepEqual([...f.state.projects], additive ? ["p3", "p1", "p2"] : ["p1", "p2"]);
    assert.equal(f.env.selectionAnchorRef.current, "p1");
    assert.deepEqual(f.calls, []);
  }
});

test("keyboard project selection does not navigate, including pinned-row callers", () => {
  const f = fixture();
  f.run("handleSelectProjectByKeyboard", { id: "p2" });
  assert.equal(f.state.selectedId, "p2");
  assert.deepEqual([...f.state.projects], ["p2"]);
  assert.deepEqual(f.calls, []);
});

test("explicit Worktree selection still scopes and opens the selected Worktree", () => {
  const f = fixture();
  f.env.dispatchCurrentWorkTarget = id => f.calls.push(["current-work", id]);
  f.env.visibleWorktreeIds = ["w1"];
  f.env.worktreeSelectionAnchorRef = { current: null };
  f.env.selectedWorktreeIds = new Set();
  f.env.projectById = new Map([["p1", { id: "p1" }]]);
  f.env.activateFirstWorktreeSession = id => { f.calls.push(["worktree", id]); return "terminal1"; };
  f.env.openWorktreeSession = () => { throw new Error("existing Worktree should be reused"); };
  f.run("handleSelectWorktree", {}, { id: "w1", project_id: "p1" });
  assert.equal(f.state.selectedId, "w1");
  assert.ok(f.calls.some(([type]) => type === "scope"));
  assert.ok(f.calls.some(([type]) => type === "worktree"));
});
