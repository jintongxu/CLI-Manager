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

test("canonical layout splits a dragged terminal independently at a pane edge", () => {
  sequence = 0;
  const initial = exports.createSinglePaneTree(["a", "b"], "a", createId);
  const result = exports.splitExistingSessionToPaneEdge(initial, "b", initial.id, "right", createId);
  assert.equal(result.changed, true);
  assert.deepEqual(plain(exports.collectPaneLeaves(result.tree).map((pane) => pane.sessionIds)), [["a"], ["b"]]);
  assert.equal(result.tree.direction, "horizontal");
  assert.equal(result.activeSessionId, "b");
  assert.deepEqual(plain(initial.sessionIds), ["a", "b"], "source layout stays immutable");
});

test("canonical panes own bodies, context and activation without a parallel current-work target", () => {
  const component = readFileSync(new URL("../components/PaneLeafView.tsx", import.meta.url), "utf8");
  assert.match(component, /paneSessions\.map\(\(session\)/);
  assert.match(component, /key=\{session.id\}/);
  assert.match(component, /<FileEditorPane/);
  assert.match(component, /<XTermTerminal/);
  assert.doesNotMatch(component, /createPortal|currentWorkPortalTargets|currentWorkActiveSessionId/);
  const view = readFileSync(new URL("../components/TerminalTabsView.tsx", import.meta.url), "utf8");
  assert.match(view, /mountedWorkspanLayouts\.map/);
  assert.match(view, /node=\{layout.paneTree\}/);
  assert.doesNotMatch(view, /CurrentWorkPaneTarget|CurrentWorkTabBar|removeCurrentWork/);
});

test("canonical pane unsplit merges its sessions without closing terminals", () => {
  sequence = 0;
  const initial = exports.createSinglePaneTree(["a", "b"], "a", createId);
  const split = exports.splitExistingSessionToPaneEdge(initial, "b", initial.id, "right", createId);
  const rightPane = exports.collectPaneLeaves(split.tree)[1];
  const restored = exports.unsplitPaneLeaf(split.tree, rightPane.id, "merge");
  assert.deepEqual(plain(exports.collectPaneLeaves(restored.tree).map((pane) => pane.sessionIds)), [["a", "b"]]);
  assert.deepEqual(plain(restored.closedSessionIds), []);
});

test("canonical layout moves a terminal between its own panes", () => {
  sequence = 0;
  const initial = exports.createSinglePaneTree(["a", "b"], "a", createId);
  const split = exports.splitExistingSessionToPaneEdge(initial, "b", initial.id, "bottom", createId);
  const panes = exports.collectPaneLeaves(split.tree);
  const moved = exports.moveSessionToPane(split.tree, panes[1].id, panes[0].id, "b");
  assert.deepEqual(plain(exports.collectPaneLeaves(moved.tree).map((pane) => pane.sessionIds)), [["a", "b"]]);
});

test("canonical SSH split keeps editor and PTY IDs distinct without cloning either owner", () => {
  sequence = 0;
  const sessions = [{ id: "ssh", kind: "pty", environmentType: "ssh", sshHostId: "host" },
    { id: "editor", kind: "file-editor", projectId: "remote-project" }];
  const initial = exports.createSinglePaneTree(sessions.map(s => s.id), "ssh", createId);
  const result = exports.splitExistingSessionToPaneEdge(initial, "editor", initial.id, "right", createId);
  assert.equal(result.changed, true);
  assert.equal(result.tree.direction, "horizontal");
  assert.deepEqual(plain(exports.collectPaneLeaves(result.tree).map(p => p.sessionIds)), [["ssh"], ["editor"]]);
  assert.equal(result.activeSessionId, "editor");
  assert.equal(sessions[0].kind, "pty");
  assert.equal(sessions[1].kind, "file-editor");
});
