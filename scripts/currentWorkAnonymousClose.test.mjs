import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compile(path, dependencies = {}) {
 const source = readFileSync(new URL(path, import.meta.url), "utf8");
 const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
 const exports = {};
 vm.runInNewContext(code, {exports, require(name) {
  assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
 }, window: {addEventListener() {}, removeEventListener() {}}});
 return exports;
}
const tree = compile("../src/features/terminal/api/terminalPaneTree.ts");
const model = compile("../src/features/terminal/lib/currentWorkModel.ts");
let cells, cursor, effects;
const react = {
 useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
  return [cells[i], next => {cells[i] = typeof next === "function" ? next(cells[i]) : next;}]; },
 useRef(initial) { const i = cursor++; return cells[i] ??= {current: initial}; },
 useCallback(fn, deps) {const i = cursor++; const old = cells[i];
  if (!old || deps.some((value, n) => value !== old.deps[n])) cells[i] = {fn, deps}; return cells[i].fn;},
 useEffect(fn, deps) { const i = cursor++; const old = cells[i]; cells[i] = deps;
  if (!old || deps.some((value, n) => value !== old[n])) effects.push(fn); },
};
let state, saved, closed, errors;
function saveCurrentWork(...args) {saved.push(args);}
const {useCurrentWorkSessionController} = compile("../src/features/terminal/hooks/useCurrentWorkSessionController.ts", {
 react,
 "../api/sessionStore": {useSessionStore: selector => selector({saveCurrentWork})},
 "../state": {useTerminalStore: {getState: () => state}},
 "../api/currentWorkEvents": {CURRENT_WORK_SESSION_CREATED_EVENT: "created"},
 "../lib/currentWorkModel": model,
 "../api/terminalPaneTree": tree,
 "../../../shared/platform/logger": {logError: (...args) => errors.push(args)},
});
const plain = value => JSON.parse(JSON.stringify(value));
function setup(ids = ["pi", "shell", "pi2"], paneTree = null) {
 cells = []; cursor = 0; effects = []; saved = []; closed = []; errors = [];
 state = {sessions: [
  {id: "pi", kind: "ephemeral-pi"}, {id: "pi2", kind: "ephemeral-pi"},
  {id: "outside", kind: "ephemeral-pi"}, {id: "shell", kind: "pty", title: "Anonymous Pi"},
  {id: "project-pi", kind: "pty", projectId: "project", cliTool: "pi"},
  {id: "editor", kind: "file-editor"},
 ], async closeSession(id) {closed.push(id); state.sessions = state.sessions.filter(s => s.id !== id);}};
 const options = {sessionStoreLoaded: true, persistedSessionIds: ids, persistedActiveSessionId: ids[0] ?? null, persistedPaneTree: paneTree};
 const render = () => {cursor = 0; effects = []; const value = useCurrentWorkSessionController(options); effects.forEach(fn => fn()); return value;};
 return {render, controller: render(), options};
}

test("removing one anonymous Pi closes it and falls back to next active member", async () => {
 const s = setup(); s.controller.removeCurrentWorkSessions(["pi"]); await Promise.resolve();
 assert.deepEqual(closed, ["pi"]);
 const next = s.render();
 assert.deepEqual(plain(next.currentWorkSessionIds), ["shell", "pi2"]);
 assert.equal(next.currentWorkActiveSessionId, "shell");
 assert.deepEqual(plain(saved.at(-1)[0]), ["shell", "pi2"]);
});

test("mixed batch closes only actual anonymous members once, never outsiders or ordinary Pi", async () => {
 const s = setup(["pi", "shell", "project-pi", "editor", "pi2"]);
 s.controller.removeCurrentWorkSessions(["pi", "pi", "shell", "project-pi", "editor", "outside", "missing"]); await Promise.resolve();
 assert.deepEqual(closed, ["pi"]);
 assert.deepEqual(plain(s.render().currentWorkSessionIds), ["pi2"]);
 s.controller.removeCurrentWorkSessions(["pi"]); assert.deepEqual(closed, ["pi"]);
});

test("toggle removal uses close; toggle addition and leaving view do not close", async () => {
 const s = setup(); s.controller.toggleCurrentWork("pi"); await Promise.resolve();
 assert.deepEqual(closed, ["pi"]);
 s.controller.toggleCurrentWork("outside");
 s.controller.setCurrentWorkMode(false);
 assert.deepEqual(closed, ["pi"]);
 assert.ok(s.render().currentWorkSessionIds.includes("outside"));
});

test("clear selected preserves unselected anonymous sessions; clear all closes remaining anonymous", async () => {
 const s = setup(); s.controller.toggleCurrentWorkSelection("pi2");
 s.render().clearCurrentWork(); await Promise.resolve(); assert.deepEqual(closed, ["pi2"]);
 s.render().clearCurrentWork(); await Promise.resolve(); assert.deepEqual(closed, ["pi2", "pi"]);
 assert.deepEqual(plain(s.render().currentWorkSessionIds), []);
});

test("removing anonymous Pi in another pane collapses split without closing ordinary member", async () => {
 const layout = {type: "split", id: "split", direction: "horizontal", ratio: 0.5,
  first: {type: "leaf", id: "left", sessionIds: ["shell"], activeSessionId: "shell"},
  second: {type: "leaf", id: "right", sessionIds: ["pi"], activeSessionId: "pi"}};
 const s = setup(["shell", "pi"], layout); s.controller.removeCurrentWorkSessions(["pi"]); await Promise.resolve();
 assert.deepEqual(closed, ["pi"]);
 assert.equal(s.render().currentWorkPaneTree.type, "leaf");
 assert.deepEqual(plain(s.render().currentWorkPaneTree.sessionIds), ["shell"]);
});

test("restoring membership, reordering and view toggles never destroy anonymous sessions", () => {
 const s = setup(); s.controller.reorderCurrentWork("pi", "shell");
 s.controller.setCurrentWorkMode(true); s.render();
 s.options.persistedSessionIds = ["shell"]; s.render();
 assert.deepEqual(closed, []);
});

test("close rejection is logged without an unhandled rejection or closing other members", async () => {
 const s = setup(); state.closeSession = async id => {closed.push(id); throw new Error("close failed");};
 s.controller.removeCurrentWorkSessions(["pi"]); await Promise.resolve(); await Promise.resolve();
 assert.deepEqual(closed, ["pi"]); assert.equal(errors.length, 1);
 assert.equal(errors[0][1].sessionId, "pi");
});


test("explicit navigation add works outside current work, is idempotent, and preserves the auto-add gate", () => {
 const s = setup(["shell"]);
 s.controller.setCurrentWorkMode(false);
 let controller = s.render();
 controller.addCurrentWorkSession("outside");
 assert.deepEqual(plain(s.render().currentWorkSessionIds), ["shell"]);
 // Exercise the exact explicit-add adapter callback rather than a separate implementation.
 const view = readFileSync(new URL("../src/features/terminal/components/TerminalTabsView.tsx", import.meta.url), "utf8");
 const body = view.match(/onAdd=\{\(id\) => \{([^}]+)\}\}/)[1];
 function add(id) {
  controller = s.render();
  const callback = new Function("id", "currentWorkSessionIds", "toggleCurrentWork", body);
  callback(id, controller.currentWorkSessionIds, controller.toggleCurrentWork);
 }
 add("outside"); add("outside");
 assert.deepEqual(plain(s.render().currentWorkSessionIds), ["shell", "outside"]);
 assert.equal(s.render().currentWorkMode, false);
 assert.deepEqual(closed, []);
 s.render().setCurrentWorkMode(true);
 s.render().addCurrentWorkSession("pi");
 assert.deepEqual(plain(s.render().currentWorkSessionIds), ["shell", "outside", "pi"]);
});
