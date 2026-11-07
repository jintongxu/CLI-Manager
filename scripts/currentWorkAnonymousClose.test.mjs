import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(path, dependencies = {}) {
 const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
 }).outputText;
 const exports = {};
 vm.runInNewContext(code, {exports, require(name) {
  assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
 }});
 return exports;
}
const visibility = compile("../src/features/terminal/lib/terminalTabVisibility.ts", {
 "../api/terminalPaneTree": compile("../src/features/terminal/api/terminalPaneTree.ts"),
});
const {createTerminalTabLifecycle} = compile("../src/features/terminal/store/terminalTabLifecycle.ts", {
 "../api/sessionStore": {useSessionStore: {getState: () => ({})}},
 "../lib/terminalStoreLayout": {}, "../api/terminalWorkspan": {},
 "../lib/terminalTabVisibility": visibility,
});
const {closeTerminalTab} = compile("../src/features/terminal/api/terminalBatchClose.ts");
function fixture() {
 const closed = [];
 const original = [{id: "pi", kind: "ephemeral-pi"}, {id: "shell", kind: "pty", title: "Anonymous Pi"},
  {id: "project-pi", kind: "pty", projectId: "project", cliTool: "pi"}, {id: "outside", kind: "ephemeral-pi"}];
 const state = {sessions: original, async closeSession(id) {
  closed.push(id); state.sessions = state.sessions.filter(s => s.id !== id);
 }};
 Object.assign(state, createTerminalTabLifecycle(patch => Object.assign(state, patch), () => state,
  async () => assert.fail("anonymous sessions must not enter durable hide persistence")));
 return {state, closed, original};
}
test("canonical tab close destroys anonymous Pi rather than hiding or removing membership", async () => {
 const {state, closed} = fixture();
 await closeTerminalTab("pi", () => state);
 assert.deepEqual(closed, ["pi"]);
 assert.deepEqual(state.sessions.map(s => s.id), ["shell", "project-pi", "outside"]);
 await closeTerminalTab("pi", () => state);
 assert.deepEqual(closed, ["pi"], "stale close is harmless");
});
test("anonymous classification is explicit, never inferred from title or CLI label", () => {
 const {original} = fixture();
 assert.equal(visibility.isHideableTerminalSession(original[0]), false);
 assert.equal(visibility.isHideableTerminalSession(original[1]), true);
 assert.equal(visibility.isHideableTerminalSession(original[2]), true);
});
test("rejected canonical anonymous close preserves ownership and propagates failure", async () => {
 const {state, original} = fixture();
 state.closeSession = async () => {throw new Error("close failed");};
 await assert.rejects(closeTerminalTab("pi", () => state), /close failed/);
 assert.equal(state.sessions, original);
 assert.equal(state.sessions[0].tabHidden, undefined);
});
test("canonical controller and navigation expose no membership join/remove authority", () => {
 for (const path of ["hooks/useTerminalTabsController.tsx", "hooks/useTerminalNavigationListeners.ts",
  "components/TerminalTabsView.tsx", "components/TerminalNavigationAdapter.tsx"]) {
  const source = readFileSync(new URL(`../src/features/terminal/${path}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /useCurrentWorkSessionController|addCurrentWorkSession|removeCurrentWorkSessions|toggleCurrentWork|clearCurrentWork/);
 }
});
