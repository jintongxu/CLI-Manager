import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks = {}) {
  const filename = resolve(path);
  const exports = {};
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => mocks[name] ?? load(resolve(dirname(filename), `${name}.ts`), mocks) });
  return exports;
}
const model = load("src/features/terminal/lib/terminalNavigationModel.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (entries) => Array.from(entries, (entry) => entry.id);
const empty = () => ({ pinnedIds: [], recentIds: [] });
const session = (id, extra = {}) => ({ id, title: `Terminal ${id}`, cwd: "C:/repo", projectId: "p", ...extra });
function input(sessions = [session("a"), session("b")], extra = {}) {
  return { sessions, sessionStatuses: Object.fromEntries(sessions.map((s) => [s.id, "running"])),
    projects: [{ id: "p", name: "Project Alpha", path: "C:/repo", group_id: "child" }],
    worktrees: [{ id: "wt", project_id: "p", name: "task-branch", display_name: "Feature tree", short_label: "W2", path: "C:/trees/feature" }],
    groups: [{ id: "root" }, { id: "child", parent_id: "root" }], scope: { kind: "all" },
    currentSessionId: "a", ...extra };
}

test("scope includes hidden runtime terminals, excludes pseudo/background/remote-owned rows but retains disconnected/exited terminals", () => {
  const sessions = [session("a", { tabHidden: true }), session("pi", { kind: "ephemeral-pi" }),
    ...["file-editor", "subagent-transcript", "synced-history"].map((kind) => session(kind, { kind })),
    session("background", { transientBackground: true }), session("handoff", { remoteHandoff: { phase: "active" } }),
    session("dead"), session("unknown"), session("ssh", { environmentType: "ssh", connectionState: "connected" }),
    session("offline", { connectionState: "disconnected" }), session("outside", { projectId: "q", cwd: "D:/other" })];
  const data = input(sessions, { scope: { kind: "project", projectId: "p" } });
  data.sessionStatuses.dead = "exited";
  delete data.sessionStatuses.unknown;
  assert.deepEqual(ids(model.buildTerminalNavigationModel(data, empty()).entries), ["a", "pi", "dead", "unknown", "ssh", "offline"]);
  data.scope = { kind: "group", groupId: "root" };
  assert.deepEqual(ids(model.buildTerminalNavigationModel(data, empty()).entries), ["a", "pi", "dead", "unknown", "ssh", "offline"]);
});

test("worktree scope and project fallback use canonical path/identity resolution", () => {
  const data = input([session("tree", { projectId: undefined, cwd: "C:\\trees\\feature\\src", tabHidden: true }), session("a")],
    { scope: { kind: "worktree", projectId: "p", worktreeId: "wt" } });
  const entries = model.buildTerminalNavigationModel(data, empty()).entries;
  assert.deepEqual(ids(entries), ["tree"]);
  assert.equal(entries[0].project.id, "p");
});

test("search covers title, project, worktree names/short label and normalized paths", () => {
  const data = input([session("tree", { title: "Builder", worktreeId: "wt", cwd: "C:/trees/feature/src" })]);
  for (const query of ["builder", "PROJECT alpha", "Feature tree", "w2", "task-branch", "c:\\trees\\feature", "  builder   alpha  "]) {
    assert.equal(model.buildTerminalNavigationModel({ ...data, query }, empty()).matchingCount, 1, query);
  }
  assert.equal(model.buildTerminalNavigationModel({ ...data, query: "absent" }, empty()).matchingCount, 0);
});

test("recent and other partition the unified list without duplicates", () => {
  const result = model.buildTerminalNavigationModel(input([session("a"), session("a"), session("b"), session("c")]),
    { pinnedIds: [], recentIds: ["a", "a"] });
  assert.deepEqual(ids(result.groups.recent), ["a"]);
  assert.deepEqual(ids(result.groups.other), ["b", "c"]);
  assert.deepEqual(Object.keys(result.groups), ["recent", "other"]);
});

test("quick list fills the scoped head so its length plus remainder equals total entries", () => {
  const data = input(Array.from({ length: 6 }, (_, i) => session(`t${i}`)), { currentSessionId: null });
  const result = model.buildTerminalNavigationModel(data, empty());
  assert.deepEqual(ids(result.quickEntries), ["t0", "t1", "t2", "t3", "t4"]);
  assert.equal(result.entries.length - result.quickEntries.length, 1);
  const grouped = Object.values(result.groups).flat();
  assert.equal(grouped.length, result.entries.length);
  // A narrower range must recount, not reuse the unfiltered total.
  const scoped = model.buildTerminalNavigationModel({ ...data, scope: { kind: "project", projectId: "q" } }, empty());
  assert.equal(scoped.entries.length, 0);
  assert.equal(scoped.quickEntries.length, 0);
});

test("quick list is current plus four, stable pins before MRU; status/output cannot reorder", () => {
  let memory = empty();
  for (const id of ["a", "b", "c", "d", "e", "f"]) memory = model.visitTerminalNavigation(memory, id);
  memory = model.toggleTerminalNavigationPin(memory, "b");
  memory = model.toggleTerminalNavigationPin(memory, "c");
  const data = input(["a", "b", "c", "d", "e", "f"].map((id) => session(id)));
  assert.deepEqual(ids(model.buildTerminalNavigationModel(data, memory).quickEntries), ["a", "b", "c", "f", "e"]);
  data.sessions[1].initialTerminalOutput = "new output";
  data.sessions[1].title = "renamed";
  assert.deepEqual(ids(model.buildTerminalNavigationModel(data, memory).quickEntries), ["a", "b", "c", "f", "e"]);
  memory = model.toggleTerminalNavigationPin(memory, "b");
  memory = model.toggleTerminalNavigationPin(memory, "b");
  assert.deepEqual(Array.from(memory.pinnedIds), ["c", "b"]);
  const pruned = model.pruneTerminalNavigationMemory(memory, new Set(["a", "b", "c"]));
  assert.deepEqual(Array.from(pruned.recentIds), ["c", "b", "a"]);
  assert.equal(model.pruneTerminalNavigationMemory(pruned, new Set(["a", "b", "c"])), pruned);
});

test("activation accepts every eligible scoped session and rejects stale or out-of-scope targets", () => {
  const data = input([session("a"), session("b", { tabHidden: true }), session("outside", { projectId: "q", cwd: "D:/other" })],
    { scope: { kind: "project", projectId: "p" } });
  assert.deepEqual(plain(model.resolveTerminalNavigationActivation(data, "a")), { sessionId: "a", unhide: false });
  assert.deepEqual(plain(model.resolveTerminalNavigationActivation(data, "b")), { sessionId: "b", unhide: true });
  for (const id of ["closed", "outside"]) assert.equal(model.resolveTerminalNavigationActivation(data, id), null);
});

// Minimal deterministic hook runner: effects/state are exercised without a DOM dependency.
function hookRunner() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((d, j) => d !== slots[i][j])) effects.push(fn); slots[i] = deps; },
  };
  const { useTerminalNavigation } = load("src/features/terminal/hooks/useTerminalNavigation.ts", { react });
  return (data) => { cursor = 0; effects = []; const value = useTerminalNavigation(data); effects.forEach((fn) => fn()); return value; };
}

test("hook remains window-local; scope and status updates retain order; closing prunes pins and MRU", () => {
  const render = hookRunner();
  let data = input();
  render(data);
  let value = render(data);
  value.togglePin("a");
  data = { ...data, currentSessionId: "b" };
  render(data);
  value = render(data);
  assert.deepEqual(Array.from(value.memory.recentIds), ["b", "a"]);
  const otherWindow = hookRunner();
  assert.deepEqual(Array.from(otherWindow(data).memory.pinnedIds), []);
  data = { ...data, scope: { kind: "project", projectId: "missing" }, sessions: [...data.sessions], sessionStatuses: { ...data.sessionStatuses } };
  render(data);
  value = render(data);
  assert.deepEqual(Array.from(value.memory.pinnedIds), ["a"]);
  assert.deepEqual(Array.from(value.memory.recentIds), ["b", "a"]);
  data = { ...data, sessions: [session("b")] };
  value = render(data);
  assert.deepEqual(Array.from(value.memory.pinnedIds), []);
  assert.deepEqual(Array.from(value.memory.recentIds), ["b"]);
});


test("local range filters before quick-list capping and retains complete memory", () => {
  const data = input([...Array.from({ length: 6 }, (_, i) => session(`a${i}`)), session("b", { projectId: "q", cwd: "D:/other" })],
    { currentSessionId: "a0", projects: [{ id: "p", path: "C:/repo" }, { id: "q", path: "D:/other" }] });
  const memory = { pinnedIds: ["a1", "a2", "a3", "a4", "a5", "b"], recentIds: ["b"] };
  assert.equal(model.buildTerminalNavigationModel(data, memory).quickEntries.length, 5);
  const scoped = model.buildTerminalNavigationModel(data, memory, "q");
  assert.deepEqual(ids(scoped.quickEntries), ["b"]);
  assert.equal(scoped.matchingCount, 1);
  assert.equal(memory.pinnedIds.length, 6);
});

test("sidebar project/group/worktree boundaries reconcile incompatible local projects", () => {
  const data = input([session("a", { worktreeId: "wt" }), session("b", { projectId: "q", cwd: "D:/other" })], {
    projects: [{ id: "p", path: "C:/repo", group_id: "child" }, { id: "q", path: "D:/other" }] });
  for (const scope of [{ kind: "project", projectId: "p" }, { kind: "group", groupId: "root" }, { kind: "worktree", projectId: "p", worktreeId: "wt" }]) {
    const result = model.buildTerminalNavigationModel({ ...data, scope }, { pinnedIds: ["a"], recentIds: [] }, "q");
    assert.equal(result.range, "all");
    assert.deepEqual(ids(result.entries), ["a"]);
    assert.deepEqual(ids(result.quickEntries), ["a"]);
  }
  assert.equal(model.buildTerminalNavigationModel(data, empty(), "p").range, "p");
  assert.equal(model.buildTerminalNavigationModel(data, empty(), "independent").range, "independent");
  assert.equal(model.buildTerminalNavigationModel({ ...data, sessions: [] }, empty(), "p").range, "all");
});

test("ordinary entries follow persisted navigation order for drag sorting", () => {
  const data = input([session("a"), session("b"), session("c")], { navigationOrder: ["c", "a", "b"] });
  assert.deepEqual(ids(model.buildTerminalNavigationModel(data, empty()).entries), ["c", "a", "b"]);
});

test("unified navigation retains hidden sessions and uses one canonical order", () => {
  const data = input([session("a"), session("b", { tabHidden: true }), session("c")], { navigationOrder: ["c", "b", "a"] });
  const result = model.buildTerminalNavigationModel(data, { pinnedIds: ["a"], recentIds: ["b"] });
  assert.deepEqual(ids(result.entries), ["c", "b", "a"]);
  assert.equal(result.totalCount, 3);
  assert.equal(result.entries.some((entry) => "inCurrentWork" in entry), false);
});

test("projectGroups and totalCount share one source with the tab-row entries", () => {
  const data = input([session("a"), session("b"), session("c", { projectId: undefined, cwd: "D:/loose" })]);
  const result = model.buildTerminalNavigationModel(data, empty());
  assert.equal(result.totalCount, 3);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(ids(result.projectGroups.flatMap((group) => group.entries)), ids(result.entries));
  const independent = result.projectGroups.find((group) => group.key === model.TERMINAL_NAVIGATION_INDEPENDENT_KEY);
  assert.deepEqual(ids(independent.entries), ["c"]);
  assert.equal(independent.label, "");
});

test("same-name projects are disambiguated with the project id and grouped separately", () => {
  const data = input([session("a"), session("b", { projectId: "q", cwd: "D:/other" })], {
    projects: [{ id: "p", name: "Same", path: "C:/repo" }, { id: "q", name: "Same", path: "D:/other" }] });
  const result = model.buildTerminalNavigationModel(data, empty());
  const labels = plain(result.projectGroups.map((group) => group.label));
  assert.deepEqual(labels, ["Same · p", "Same · q"]);
  assert.equal(result.totalCount, 2);
  // A unique name is not decorated.
  const unique = model.buildTerminalNavigationModel(input([session("a")]), empty()).projectGroups[0].label;
  assert.equal(unique, "Project Alpha");
});

test("group tree follows range and the complete scoped collection", () => {
  const data = input([session("a"), session("b", { projectId: "q", cwd: "D:/other" })], {
    projects: [{ id: "p", name: "Alpha", path: "C:/repo" }, { id: "q", name: "Beta", path: "D:/other" }] });
  const scoped = model.buildTerminalNavigationModel(data, empty(), "q");
  assert.deepEqual(plain(scoped.projectGroups.map((group) => group.label)), ["Beta"]);
  assert.equal(scoped.totalCount, 1);
  const unified = model.buildTerminalNavigationModel(data, empty());
  assert.deepEqual(ids(unified.projectGroups.flatMap((group) => group.entries)), ["a", "b"]);
  assert.equal(unified.totalCount, 2);
});

test("drawer Close others uses exactly eligible scoped entries, including hidden and exited terminals", () => {
  const sessions = [session("a"), session("hidden", { tabHidden: true }), session("pi", { kind: "ephemeral-pi" }),
    session("offline", { environmentType: "ssh", connectionState: "disconnected" }), session("exited"),
    ...["file-editor", "subagent-transcript", "synced-history"].map((kind) => session(kind, { kind })),
    session("remote", { remoteHandoff: { phase: "active" } }), session("transient", { transientBackground: true }),
    session("outside", { projectId: "q", cwd: "D:/other" }), session("hidden", { tabHidden: true })];
  const data = input(sessions, { scope: { kind: "project", projectId: "p" }, query: "no matches" });
  data.sessionStatuses.exited = "exited";
  const expected = ["hidden", "pi", "offline", "exited"];
  assert.deepEqual(Array.from(model.collectTerminalNavigationCloseOtherIds(data)), expected);
  assert.deepEqual(Array.from(model.collectTerminalNavigationCloseOtherIds({ ...data, scope: { kind: "group", groupId: "root" } })), expected);
  assert.deepEqual(Array.from(model.collectTerminalNavigationCloseOtherIds({ ...data, currentSessionId: "file-editor" })), ["a", ...expected]);
  assert.deepEqual(Array.from(model.collectTerminalNavigationCloseOtherIds({ ...data, sessions: [session("a")] })), []);
});

test("drawer Close others is not capped to quick entries and resolves worktree scope", () => {
  const sessions = Array.from({ length: 8 }, (_, i) => session(`tree${i}`, { worktreeId: "wt", tabHidden: i > 3 }));
  const data = input([...sessions, session("main")], {
    currentSessionId: "tree0", scope: { kind: "worktree", projectId: "p", worktreeId: "wt" },
  });
  assert.deepEqual(Array.from(model.collectTerminalNavigationCloseOtherIds(data)), sessions.slice(1).map((s) => s.id));
  assert.deepEqual(Array.from(model.collectTerminalNavigationCloseOtherIds({ ...data, sessions: sessions.slice(0, 2) })), ["tree1"]);
});

test("controller drawer batch resolves fresh store sessions and preserves the active terminal through the canonical close guard", () => {
  const source = readFileSync(resolve("src/features/terminal/hooks/useTerminalTabsController.tsx"), "utf8");
  const callback = source.slice(source.indexOf("  const handleCloseOtherNavigationSessions ="), source.indexOf("  const confirmCloseSessions ="));
  assert.match(callback, /useTerminalStore\.getState\(\)/);
  assert.match(callback, /collectTerminalNavigationCloseOtherIds\(/);
  assert.match(callback, /sessions: state\.sessions, sessionStatuses: state\.sessionStatuses/);
  assert.match(callback, /scope: terminalScopeValue/);
  assert.match(callback, /handleCloseSessions\(sessionIds, undefined, effectiveActiveSessionId \? \[effectiveActiveSessionId\] : \[\]\)/);
  assert.doesNotMatch(callback, /visibleSessions|destroy|closeSessionIds\(/);
  const calls = [];
  const stale = session("stale");
  let runtimeSessions = [session("a"), stale];
  const run = new Function("useCallback", "useTerminalStore", "collectTerminalNavigationCloseOtherIds",
    "projects", "worktrees", "groups", "terminalScopeValue", "effectiveActiveSessionId", "handleCloseSessions",
    `${callback}; return handleCloseOtherNavigationSessions;`)(
    (fn) => fn, { getState: () => ({ sessions: runtimeSessions, sessionStatuses: {} }) },
    model.collectTerminalNavigationCloseOtherIds, [], [], [], { kind: "all" }, "a", (...args) => calls.push(args));
  runtimeSessions = [session("a"), session("hidden", { tabHidden: true }), session("editor", { kind: "file-editor" }),
    session("transcript", { kind: "subagent-transcript" }), session("remote", { remoteHandoff: {} }),
    session("background", { transientBackground: true })];
  run();
  assert.deepEqual(plain(calls), [[["hidden"], null, ["a"]]]);
});

test("multiple sessions in a single project do not make its name ambiguous", () => {
  const result = model.buildTerminalNavigationModel(input(), empty());
  assert.equal(result.projectGroups[0].label, "Project Alpha");
});
