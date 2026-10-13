import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./terminalPaneTree.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const plain = (value) => JSON.parse(JSON.stringify(value));
let sequence = 0;
const createId = () => `current-work:${++sequence}`;

test("current-work layout splits a dragged terminal independently at a pane edge", () => {
  sequence = 0;
  const initial = exports.createSinglePaneTree(["a", "b"], "a", createId);
  const result = exports.splitExistingSessionToPaneEdge(initial, "b", initial.id, "right", createId);
  assert.equal(result.changed, true);
  assert.deepEqual(plain(exports.collectPaneLeaves(result.tree).map((pane) => pane.sessionIds)), [["a"], ["b"]]);
  assert.equal(result.tree.direction, "horizontal");
  assert.equal(result.activeSessionId, "b");
  assert.deepEqual(plain(initial.sessionIds), ["a", "b"], "source layout stays immutable");
});

test("current-work pane target exposes title, context and active state", () => {
  const component = readFileSync(new URL("../components/CurrentWorkPaneTarget.tsx", import.meta.url), "utf8");
  assert.match(component, /ui-current-work-pane-header/);
  assert.match(component, /formatTerminalTabContext\(session, project, worktree\)/);
  assert.match(component, /data-active=\{active \? "true" : "false"\}/);
  assert.match(component, /onClick=\{\(\) => onActivate\(session\.id\)\}/);
  assert.match(component, /showHeader &&/);
  assert.match(component, /Undo2/);
  assert.match(component, /Maximize2/);
  assert.match(component, /Minimize2/);
  assert.match(component, /terminal\.currentWork\.removeNamed/);
  const view = readFileSync(new URL("../components/TerminalTabsView.tsx", import.meta.url), "utf8");
  assert.match(view, /compact=\{Boolean\(currentWorkHasSplit\)\}/);
  assert.match(view, /showHeader=\{Boolean\(currentWorkHasSplit\)\}/);
  assert.match(view, /!currentWorkMode && \([\s\S]*<TerminalCurrentContext/);
});

test("current-work pane unsplit merges its sessions without closing terminals", () => {
  sequence = 0;
  const initial = exports.createSinglePaneTree(["a", "b"], "a", createId);
  const split = exports.splitExistingSessionToPaneEdge(initial, "b", initial.id, "right", createId);
  const rightPane = exports.collectPaneLeaves(split.tree)[1];
  const restored = exports.unsplitPaneLeaf(split.tree, rightPane.id, "merge");
  assert.deepEqual(plain(exports.collectPaneLeaves(restored.tree).map((pane) => pane.sessionIds)), [["a", "b"]]);
  assert.deepEqual(plain(restored.closedSessionIds), []);
});

test("current-work layout moves a terminal between its own panes", () => {
  sequence = 0;
  const initial = exports.createSinglePaneTree(["a", "b"], "a", createId);
  const split = exports.splitExistingSessionToPaneEdge(initial, "b", initial.id, "bottom", createId);
  const panes = exports.collectPaneLeaves(split.tree);
  const moved = exports.moveSessionToPane(split.tree, panes[1].id, panes[0].id, "b");
  assert.deepEqual(plain(exports.collectPaneLeaves(moved.tree).map((pane) => pane.sessionIds)), [["a", "b"]]);
});
