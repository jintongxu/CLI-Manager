import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the actual store/actions/pure layout code, replacing native boundaries only.
function load(path, dependencies = {}) {
  const sourceText = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(source)).join("\n");
  const output = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(output, { exports, ...dependencies }, { filename: path });
  return exports;
}
const status = load("../lib/terminalStatus.ts");
const sidebar = load("../../../shared/lib/sidebarTerminalOrder.ts");
const metadata = load("../store/terminalSidebarMetadata.ts", sidebar);
const pane = load("../api/terminalPaneTree.ts");
const workspan = load("../api/terminalWorkspan.ts", pane);
const visibility = load("../lib/terminalTabVisibility.ts", pane);
const layout = load("../lib/terminalStoreLayout.ts", visibility);
const plain = (value) => JSON.parse(JSON.stringify(value));

const agent = load("../../agents/api/agentTerminal.ts");

function fixture(sessions = [], workspans = [], daemon = [], projects = [], worktrees = []) {
  const calls = [];
  const persisted = {
    sessions, workspans, activeSessionId: sessions[0]?.id ?? null, activeWorkspanId: workspans[0]?.id ?? null, splits: [],
    async saveSessions(value) { calls.push(["saveSessions", plain(value)]); this.sessions = value; },
    async saveActiveSessionId(value) { calls.push(["saveActive", value]); this.activeSessionId = value; },
    async saveWorkspans(value, id) { calls.push(["saveWorkspans", plain(value)]); this.workspans = value; this.activeWorkspanId = id; },
    async saveSplits(value) { this.splits = value; },
  };
  const dependencies = {
    ...metadata, ...pane, ...workspan, ...visibility, ...layout,
    resolveNextSessionIdForShortcut: pane.getNextSessionIdForShortcut,
    unsplitPaneLeaf: pane.unsplitPaneLeaf,
    terminalProcessManager: {
      async create() { calls.push(["create"]); return "recreated"; },
      async write(id, value) { calls.push(["write", id, value]); },
      async close(id) { calls.push(["close", id]); },
      async subscribeStatus(id, callback) { calls.push(["subscribe", id]); callbacks.set(id, callback); return () => calls.push(["unlisten", id]); },
    },
    async invoke(command) { calls.push(["invoke", command]); return daemon; },
    useSessionStore: { getState: () => persisted },
    useSettingsStore: { getState: () => ({ workspanEnabled: true, unsplitBehavior: "merge" }) },
    TERMINAL_STORE_IN_TAURI: false,
    async getOsPlatform() { return "windows"; },
    async garbageCollectProviderSnapshots() {}, async garbageCollectProjectExtensionSnapshots() {},
    isCliManagerSyncArtifactText: () => false,
    resolveDaemonAttachTaskStatus: status.resolveDaemonAttachTaskStatus, resolveDaemonAttachUpdatedAt: () => "now",
    resolveAttachedDaemonSession: (ps) => ps ?? {},
    useProjectStore: { getState: () => ({ projects, worktrees }) },
    ...agent,
    recordCrashActivity() {}, summarizeStartupCmd: () => null,
    buildTabStatusUpdate: status.buildTabStatusUpdate,
    detectCliResumeKind: () => null,
    normalizeDirectCodexStartupCommand: (value) => value,
    async resolvePtyLaunch() { return { shell: "bash", invokeArgs: {} }; },
    normalizeShellKey: () => "bash",
    logError() {}, logInfo() {}, logWarn() {}, logTerminalExitStatus() {},
    releaseRemoteHistoryConsumer() {}, releaseProviderSnapshot() {}, releaseProjectExtensionSnapshot() {},
    clearProjectEditorWorkspacesIfUnused() {},
    applyPtyStatusToSessions: (items) => items,
    toast: { info() {}, success() {}, warning() {} },
    translateCurrent: (key) => key,
  };
  Object.assign(dependencies, load("../lib/terminalLaunch.ts", dependencies));
  // Keep native/provider launch boundaries mocked, but use actual metadata helpers.
  dependencies.resolvePtyLaunch = async (options) => {
    calls.push(["launch", plain(options)]);
    return { shell: "powershell", invokeArgs: {}, startupHandledByLaunch: true,
      startupCmd: options.startupCmd === "" ? undefined : options.startupCmd ?? projects.find((p) => p.id === options.projectId)?.cli_tool };
  };
  Object.assign(dependencies, load("../lib/terminalStoreLayout.ts", dependencies));
  const callbacks = new Map();
  const lifecycle = load("../store/terminalTabLifecycle.ts", dependencies);
  let state;
  const api = { getState: () => state, setState(update) { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; } };
  let persistenceQueue = Promise.resolve();
  dependencies.createTerminalRuntime = () => ({
    actions: {},
    createWorkspanId: () => "attached-workspan", createPaneId: () => "attached-pane",
    queueSshSessionPersistence(value) {
      persistenceQueue = persistenceQueue.then(() => persisted.saveSessions(value));
      return persistenceQueue;
    },
    scheduleSaveActiveId: (id) => calls.push(["scheduleActive", id]),
    clearPendingSubagentPanesForParent() {}, stopSubagentTranscriptRetry() {},
    subagentCloseTimers: new Map(), clearHookRunningTimeout() {}, persistSshConnectionStateAfterPtyStatus() {},
  });
  dependencies.createTerminalTabLifecycle = lifecycle.createTerminalTabLifecycle;
  dependencies.create = (initialize) => { state = initialize(api.setState, api.getState, api); return api; };
  load("../store/terminalStore.ts", dependencies);
  api.setState({ sessions, ...layout.buildWorkspanMirror(workspans, workspans[0]?.id ?? null, sessions) });
  return { api, calls, persisted, callbacks, dependencies, settled: () => persistenceQueue };
}
function session(id, extra = {}) { return { id, title: id, ...extra }; }
function span(id, paneId, sessionId) { return workspan.createTerminalWorkspan(id, paneId, sessionId); }

test("ordinary close hides without close/unlisten/layout deletion; reopen activates the same ID without create", async () => {
  const backing = [span("w", "p", "a")];
  const { api, calls, settled } = fixture([session("a")], backing);
  const listener = () => calls.push(["listenerDisposed"]);
  api.setState({ statusListeners: { a: listener }, sessionStatuses: { a: "running" } });
  await api.getState().hideSession("a");
  assert.equal(api.getState().sessions[0].tabHidden, true);
  assert.equal(api.getState().workspans, backing);
  assert.equal(api.getState().statusListeners.a, listener);
  assert.equal(api.getState().activeSessionId, null);
  assert.equal(api.getState().activeWorkspanId, null);
  assert.equal(api.getState().sessionStatuses.a, "running");
  api.getState().reopenSession("a");
  await settled();
  assert.equal(api.getState().activeSessionId, "a");
  assert.equal(api.getState().activePaneId, "p");
  assert.equal(api.getState().sessions[0].tabHidden, false);
  assert.equal(calls.some(([kind]) => ["close", "create", "listenerDisposed"].includes(kind)), false);
});

for (const hidden of [false, true]) {
  test(`explicit navigation to a ${hidden ? "hidden" : "visible"} session outside fullscreen exits focus mode atomically`, async () => {
    const backing = { ...span("w", "p1", "a"), paneTree: { type: "split", id: "split", direction: "horizontal", ratio: 0.5,
      first: pane.createPaneLeaf("p1", ["a"], "a"), second: pane.createPaneLeaf("p2", ["b"], "b") } };
    const { api, calls, settled } = fixture([session("a"), session("b", { tabHidden: hidden })], [backing]);
    api.getState().setFullscreenPaneId("p1");
    api.getState().reopenSession("b");
    const state = api.getState();
    assert.equal(state.activeSessionId, "b");
    assert.equal(state.activePaneId, "p2");
    assert.equal(state.fullscreenPaneId, null);
    assert.equal(state.sessions[1].tabHidden, false);
    const { useTerminalVisibleLayouts } = load("../hooks/useTerminalVisibleLayouts.ts", {
      ...metadata, ...pane, ...workspan, ...visibility, useMemo: (calculate) => calculate(),
    });
    const result = useTerminalVisibleLayouts(state.workspans, state.sessions, null,
      state.activeWorkspanId, state.activeSessionId, state.fullscreenPaneId);
    assert.equal(result.activeFullscreenPaneId, null, "the selected pane is not hidden by focus mode");
    assert.equal(result.activeSession.id, "b");
    assert.equal(result.mountedWorkspanLayouts[0].visiblePaneIds.has("p2"), true);
    assert.equal(state.workspans[0].paneTree.second.id, "p2");
    assert.deepEqual([...workspan.collectWorkspanSessionIds(state.workspans[0])], ["a", "b"]);
    await settled();
    assert.equal(calls.some(([kind]) => ["create", "close", "unlisten"].includes(kind)), false);
  });

  test(`same-pane explicit navigation preserves fullscreen for ${hidden ? "hidden" : "visible"} tabs`, () => {
    const backing = { ...span("w", "p", "a"), paneTree: pane.createPaneLeaf("p", ["a", "b"], "a") };
    const { api } = fixture([session("a"), session("b", { tabHidden: hidden })], [backing]);
    api.getState().setFullscreenPaneId("p");
    api.getState().setActive("a");
    assert.equal(api.getState().fullscreenPaneId, "p", "reselecting active session preserves focus mode");
    api.getState().setActive("b");
    assert.equal(api.getState().activeSessionId, "b");
    assert.equal(api.getState().fullscreenPaneId, "p");
    api.getState().setActiveWorkspan("w");
    assert.equal(api.getState().fullscreenPaneId, "p", "reselecting current Workspan preserves focus mode");
    api.getState().setActive("missing");
    assert.equal(api.getState().fullscreenPaneId, "p", "invalid navigation is a no-op");
  });
}

for (const action of ["setActive", "reopenSession", "setActiveWorkspan"]) {
  test(`${action} across Workspans exits fullscreen without recreating sessions`, () => {
    const { api, calls } = fixture([session("a"), session("b")], [span("w1", "p1", "a"), span("w2", "p2", "b")]);
    api.getState().setFullscreenPaneId("p1");
    api.getState()[action](action === "setActiveWorkspan" ? "w2" : "b");
    assert.equal(api.getState().activeWorkspanId, "w2");
    assert.equal(api.getState().activeSessionId, "b");
    assert.equal(api.getState().fullscreenPaneId, null);
    api.getState().setActiveWorkspan("w1");
    assert.equal(api.getState().fullscreenPaneId, null, "returning does not restore stale fullscreen");
    assert.equal(calls.some(([kind]) => ["create", "close"].includes(kind)), false);
  });
}

test("hide falls back across tabs, deep panes and adjacent Workspans while keeping backing trees intact", async () => {
  const tree = { type: "split", id: "root", direction: "horizontal", ratio: 0.5,
    first: pane.createPaneLeaf("p1", ["a", "b"], "a"),
    second: { type: "split", id: "nested", direction: "vertical", ratio: 0.5,
      first: pane.createPaneLeaf("p2", ["c"], "c"), second: pane.createPaneLeaf("p3", ["d"], "d") } };
  const backing = [span("before", "before-pane", "before"),
    { ...span("w", "p1", "a"), paneTree: tree }, span("after", "after-pane", "after")];
  const { api } = fixture(["a", "b", "c", "d", "before", "after"].map((id) => session(id)), backing);
  api.getState().setActive("a");
  const original = plain(api.getState().workspans);
  await api.getState().hideSession("a");
  assert.equal(api.getState().activeSessionId, "b");
  await api.getState().hideSession("b");
  assert.equal(api.getState().activeSessionId, "c");
  await api.getState().hideSession("c");
  assert.equal(api.getState().activeSessionId, "d");
  await api.getState().hideSession("d");
  assert.equal(api.getState().activeSessionId, "after");
  assert.deepEqual(plain(api.getState().workspans), original);
  assert.deepEqual([...visibility.visibleTerminalSessionIds(api.getState().sessions, new Set(["a", "before"]))], ["before"]);
});

test("pseudo kinds delegate to destructive close; explicit deletion still removes hidden PTYs", async () => {
  for (const kind of ["file-editor", "subagent-transcript", "synced-history", "ephemeral-pi"]) {
    const { api } = fixture([session("pseudo", { kind })], [span("w", "p", "pseudo")]);
    const closed = [];
    api.setState({ closeSession: async (id) => closed.push(id) });
    await api.getState().hideSession("pseudo");
    assert.deepEqual(closed, ["pseudo"]);
    assert.equal(api.getState().sessions[0].tabHidden, undefined);
  }
  const { api, calls } = fixture([session("a")], [span("w", "p", "a")]);
  await api.getState().hideSession("a");
  await api.getState().closeSession("a");
  assert.equal(api.getState().sessions.length, 0);
  assert.equal(api.getState().workspans.length, 0);
  assert.equal(calls.some(([kind, id]) => kind === "close" && id === "a"), true);
});

test("keyboard navigation excludes hidden tabs and all-hidden Workspans", async () => {
  const backing = [span("w", "p", "a"), span("hidden", "hp", "h"), span("other", "op", "b")];
  const { api } = fixture([session("a"), session("h", { tabHidden: true }), session("b")], backing);
  assert.equal(api.getState().getNextSessionIdForShortcut(1), "b");
  await api.getState().hideSession("a");
  await api.getState().hideSession("b");
  assert.equal(api.getState().getNextSessionIdForShortcut(1), null);
});

for (const daemon of [false, true]) {
  test(`restore ${daemon ? "daemon attach" : "recreate"} preserves hidden state, backing ownership and legacy default`, async () => {
    for (const tabHidden of [true, undefined]) {
      const original = session("a", { tabHidden, sidebarPinned: tabHidden ? true : undefined, sidebarOrder: tabHidden ? 7 : undefined });
      const { api, calls, callbacks } = fixture([original], [span("w", "p", "a")], daemon ? [{ sessionId: "a", alive: true }] : []);
      await api.getState().restoreSessions(new Map(), {});
      const restored = api.getState().sessions[0];
      assert.equal(api.getState().tabNotifications[restored.id] ?? "none", "none", "no command/task signal must not restore running");
      assert.equal(restored.tabHidden, tabHidden);
      assert.equal(restored.sidebarPinned, original.sidebarPinned);
      assert.equal(restored.sidebarOrder, original.sidebarOrder);
      assert.equal(restored.id, daemon ? "a" : "recreated");
      assert.equal(api.getState().workspans[0].paneTree.sessionIds[0], restored.id);
      assert.equal(api.getState().activeSessionId, tabHidden ? null : restored.id);
      assert.equal(calls.some(([kind]) => kind === "create"), !daemon);
      callbacks.get(restored.id)({ status: "exited" });
      assert.equal(api.getState().sessions[0].tabHidden, tabHidden, "background exit must not reopen");
      assert.equal(api.getState().activeSessionId, tabHidden ? null : restored.id);
    }
  });
}

test("render contracts keep backing trees and xterm mounted even after the last visible tab is hidden", () => {
  const view = readFileSync(new URL("../components/TerminalTabsView.tsx", import.meta.url), "utf8");
  const leaf = readFileSync(new URL("../components/PaneLeafView.tsx", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../hooks/useTerminalTabsController.tsx", import.meta.url), "utf8");
  assert.match(view, /mountedWorkspanLayouts\.length > 0/);
  assert.match(view, /node=\{layout\.paneTree\}/);
  assert.match(view, /visibleNode=\{layout\.visiblePaneTree\}/);
  assert.match(view, /visibleSessions\.length === 0/);
  assert.match(leaf, /paneSessions\.map\(\(session\)/);
  assert.match(leaf, /<XTermTerminal/);
  assert.match(controller, /await hideSession\(sessionId\)/);
  assert.match(controller, /visibleSessionIds=\{visibleSessionIds\}/);
  assert.match(controller, /!isHideableTerminalSession\(session\)/);
});

test("visible layouts intersect scope and hidden, retain backing keys, and render all-hidden as empty", () => {
  const { useTerminalVisibleLayouts } = load("../hooks/useTerminalVisibleLayouts.ts", {
    ...metadata, ...pane, ...workspan, ...visibility, useMemo: (calculate) => calculate(),
  });
  const backing = [span("hidden", "hp", "h"), span("visible", "vp", "v")];
  const sessions = [session("h", { tabHidden: true }), session("v")];
  let result = useTerminalVisibleLayouts(backing, sessions, null, "hidden", "h", null);
  assert.equal(result.mountedWorkspanLayouts.length, 2);
  assert.equal(result.mountedWorkspanLayouts[0].paneTree, backing[0].paneTree);
  assert.equal(result.mountedWorkspanLayouts[0].visiblePaneTree, null);
  assert.equal(result.effectiveActiveSessionId, "v");
  assert.deepEqual(plain(result.visibleWorkspanLayouts[0].closeSessionIds), ["v"]);
  result = useTerminalVisibleLayouts(backing, sessions, new Set(["h"]), "hidden", "h", null);
  assert.equal(result.mountedWorkspanLayouts.length, 2);
  assert.equal(result.visibleWorkspanLayouts.length, 0);
  assert.equal(result.visibleSessions.length, 0);
  assert.equal(result.activeSession, null);
  const split = { ...backing[1], paneTree: { type: "split", id: "s", direction: "horizontal", ratio: 0.5,
    first: backing[1].paneTree, second: pane.createPaneLeaf("empty") } };
  result = useTerminalVisibleLayouts([split], [session("v")], null, "visible", "v", null);
  assert.equal(result.mountedWorkspanLayouts[0].visiblePaneTree, split.paneTree, "ordinary empty splits keep legacy geometry");
});

test("merge unsplit retains hidden members; explicit close unsplit cleans hidden resources", async () => {
  for (const behavior of ["merge", "close"]) {
    const backing = { ...span("w", "p1", "a"), paneTree: { type: "split", id: "s", direction: "horizontal", ratio: 0.5,
      first: pane.createPaneLeaf("p1", ["a", "h"], "a"), second: pane.createPaneLeaf("p2", ["b"], "b") } };
    const { api, calls, dependencies } = fixture([session("a"), session("h", { tabHidden: true }), session("b")], [backing]);
    dependencies.useSettingsStore.getState = () => ({ unsplitBehavior: behavior, workspanEnabled: true });
    await api.getState().unsplitTerminal("a");
    assert.equal(api.getState().sessions.some((item) => item.id === "h"), behavior === "merge");
    assert.equal(calls.some(([kind, id]) => kind === "close" && id === "h"), behavior === "close");
    if (behavior === "merge") assert.equal(api.getState().sessions.find((item) => item.id === "h").tabHidden, true);
    assert.equal(api.getState().activeSessionId, behavior === "merge" ? "a" : "b");
  }
});

test("remote handoff may be hidden/reopened, but explicit deletion remains locked", async () => {
  const { api, calls } = fixture([session("a", { remoteHandoff: { phase: "hosted" } })], [span("w", "p", "a")]);
  await api.getState().hideSession("a");
  await api.getState().closeSession("a");
  assert.equal(api.getState().sessions.length, 1);
  assert.equal(api.getState().sessions[0].tabHidden, true);
  api.getState().reopenSession("a");
  assert.equal(api.getState().activeSessionId, "a");
  assert.equal(calls.some(([kind]) => kind === "close" || kind === "create"), false);
});

test("background runtime shell status updates do not reopen or focus hidden PTYs", () => {
  const { api, dependencies } = fixture([session("a", { tabHidden: true, shell: "cmd" })], [span("w", "p", "a")]);
  const status = load("../lib/terminalStatus.ts");
  const { createTerminalRuntime } = load("../store/terminalRuntime.ts", {
    ...dependencies, ...status,
    isShellRuntimeMonitoringEnabled: () => true,
    resolveAgentTerminalMetadata: () => ({ isAgentSession: false }),
  });
  const runtime = createTerminalRuntime(api.setState, api.getState, api);
  runtime.actions.handleShellRuntimeEvent({ sessionId: "a", event: "command_started", origin: "osc" });
  assert.equal(api.getState().tabStatuses.a.shell, "running");
  assert.equal(api.getState().sessions[0].tabHidden, true);
  assert.equal(api.getState().activeSessionId, null);
});


test("sidebar actions validate partitions, append pin transitions and never change layout/stored array order", async () => {
  const sessions = [session("a", { projectId: "p" }), session("b", { projectId: "p", tabHidden: true }),
    session("c", { projectId: "p", sidebarPinned: true }), session("foreign", { projectId: "q" }),
    session("wt", { projectId: "p", worktreeId: "w" }), session("pseudo", { projectId: "p", kind: "ephemeral-pi" })];
  const backing = [span("w", "pane", "a")];
  const { api, calls, settled } = fixture(sessions, backing);
  const before = api.getState();
  const ids = () => sidebar.getSidebarTerminals(api.getState().sessions, "p").map((item) => item.id).join(",");
  assert.equal(ids(), "c,a,b");
  assert.equal(before.reorderSidebarSessions("a", "c"), false);
  assert.equal(before.reorderSidebarSessions("a", "foreign"), false);
  assert.equal(before.reorderSidebarSessions("a", "wt"), false);
  assert.equal(before.setSidebarPinned("pseudo", true), false);
  assert.equal(before.reorderSidebarSessions("a", "b"), true);
  assert.equal(ids(), "c,b,a");
  assert.equal(before.setSidebarPinned("a", true), true);
  assert.equal(ids(), "c,a,b");
  assert.equal(before.setSidebarPinned("c", false), true);
  assert.equal(ids(), "a,b,c");
  assert.equal(before.moveSidebarSession("c", -1), true);
  assert.equal(ids(), "a,c,b");
  assert.equal(before.moveSidebarSession("a", -1), false);
  const after = api.getState();
  assert.equal(after.workspans, before.workspans);
  assert.equal(after.paneTree, before.paneTree);
  for (const key of ["activeSessionId", "activePaneId", "activeWorkspanId", "fullscreenPaneId", "splits", "sessionStatuses", "statusListeners"]) assert.equal(after[key], before[key]);
  assert.deepEqual(after.sessions.map((item) => item.id), sessions.map((item) => item.id));
  assert.equal(after.sessions[3], sessions[3]);
  await settled();
  assert.equal(calls.filter(([kind]) => kind === "saveSessions").length, 4);
  assert.equal(calls.some(([kind]) => ["create", "close", "saveWorkspans", "scheduleActive"].includes(kind)), false);
});


test("daemon restore and direct attach preserve explicit task states and use none/done fallback independent of alive", async () => {
  for (const alive of [true, false]) for (const taskStatus of [undefined, "invalid", "none", "running", "attention", "done", "failed"]) {
    const expected = ["none", "running", "attention", "done", "failed"].includes(taskStatus) ? taskStatus : alive ? "none" : "done";
    assert.equal(status.resolveDaemonAttachTaskStatus({ alive, taskStatus }), expected);
    const meta = { sessionId: "a", alive, taskStatus };
    const original = session("a", { tabHidden: true });
    const restored = fixture([original], [span("w", "p", "a")], [meta]);
    await restored.api.getState().restoreSessions(new Map(), {});
    assert.equal(restored.api.getState().tabNotifications.a, expected);
    assert.equal(restored.api.getState().sessionStatuses.a, alive ? "running" : "exited");
    assert.ok(!restored.calls.some(([kind]) => kind === "create"));
    const attached = fixture([], [], [meta]);
    await attached.api.getState().attachDaemonSession("a");
    assert.equal(attached.api.getState().tabNotifications.a, expected);
    assert.equal(attached.api.getState().sessionStatuses.a, alive ? "running" : "exited");
    assert.ok(!attached.calls.some(([kind]) => kind === "create"));
  }
});


test("actual new shell and PTY running callbacks never fabricate task-running; exit still completes", async () => {
  const { api, calls, callbacks } = fixture();
  await api.getState().createSession(undefined, undefined, "Empty");
  assert.equal(api.getState().sessionStatuses.recreated, "running");
  assert.equal(api.getState().tabNotifications.recreated ?? "none", "none");
  callbacks.get("recreated")({ status: "running" });
  assert.equal(api.getState().tabNotifications.recreated ?? "none", "none");
  api.setState(status.buildTabStatusUpdate(api.getState(), "recreated", "hook", "done", "now"));
  callbacks.get("recreated")({ status: "running" });
  assert.equal(api.getState().tabNotifications.recreated, "done");
  callbacks.get("recreated")({ status: "error" });
  assert.equal(api.getState().tabNotifications.recreated, "failed");
  assert.ok(!calls.some(([kind]) => kind === "write"));
  const store = readFileSync(new URL("../store/terminalStore.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /status === "running" \? "running"/);
});

test("top task consumer uses notification none by default and only explicit running", () => {
  const tabs = load("../lib/terminalTabsModel.ts");
  assert.equal(tabs.getWorkspanNotification(["empty"], {}), "none");
  assert.equal(tabs.getWorkspanNotification(["empty", "task"], { empty: "none", task: "running" }), "running");
  assert.equal(tabs.getWorkspanNotification(["task"], { task: "done" }), "done");
  assert.equal(tabs.getWorkspanNotification(["task"], { task: "attention" }), "attention");
  assert.equal(tabs.getWorkspanNotification(["task"], { task: "failed" }), "failed");
});


test("actual split PTY life stays independent of task state and exit completes", async () => {
  const { api, callbacks, calls } = fixture([session("a")], [span("w", "p", "a")]);
  const id = await api.getState().splitTerminal("a", "horizontal");
  assert.equal(id, "recreated");
  callbacks.get(id)({ status: "running" });
  assert.equal(api.getState().tabNotifications[id] ?? "none", "none");
  callbacks.get(id)({ status: "exited" });
  assert.equal(api.getState().tabNotifications[id], "done");
  assert.ok(!calls.some(([kind]) => kind === "write"));
});

test("disabled startup restoration clears snapshots without running restore/commands", () => {
  const app = readFileSync(new URL("../../../app/App.tsx", import.meta.url), "utf8");
  const start = app.indexOf("if (!terminalSessionRestoreEnabled)");
  assert.ok(start > 0);
  const disabled = app.slice(start, app.indexOf("} else if (!hasRestorable)", start));
  assert.match(disabled, /useSessionStore.getState\(\).clear\(\)/);
  assert.doesNotMatch(disabled, /restoreSessions|attachDaemonSession|createSession|\.write\(/);
});

function monitoredRuntime(f, enabled = true) {
  const { createTerminalRuntime } = load("../store/terminalRuntime.ts", {
    ...f.dependencies, ...status, isShellRuntimeMonitoringEnabled: () => enabled,
  });
  return createTerminalRuntime(f.api.setState, f.api.getState, f.api).actions;
}

for (const worktreeId of [undefined, "wt"]) {
  test(`actual create classifies explicit plain ${worktreeId ? "worktree" : "project"} shell and accepts monitored commands`, async () => {
    const f = fixture([], [], [], [{ id: "project", cli_tool: "codex" }],
      worktreeId ? [{ id: worktreeId, project_id: "project", status: "active" }] : []);
    await f.api.getState().createSession("project", "/repo", "Shell", "", undefined, "powershell", undefined, worktreeId);
    const created = f.api.getState().sessions[0];
    assert.equal(created.isAgentSession, false);
    assert.equal(created.cliTool, undefined);
    assert.equal(created.startupCmd, "", "retain explicit no-inherit intent even when launch handles startup");
    assert.equal(created.worktreeId, worktreeId);
    assert.equal(f.persisted.sessions[0].isAgentSession, false);
    const runtime = monitoredRuntime(f);
    runtime.handleShellRuntimeEvent({ sessionId: created.id, event: "command_started", origin: "osc" });
    assert.equal(f.api.getState().tabNotifications[created.id], "running");
    runtime.handleShellRuntimeEvent({ sessionId: created.id, event: "command_finished", exitCode: 0, origin: "osc" });
    assert.equal(f.api.getState().tabNotifications[created.id], "done");
    runtime.handleShellRuntimeEvent({ sessionId: created.id, event: "command_started", origin: "osc" });
    runtime.handleShellRuntimeEvent({ sessionId: created.id, event: "prompt_shown", origin: "osc" });
    assert.equal(f.api.getState().tabNotifications[created.id], "done");
    runtime.handleShellRuntimeEvent({ sessionId: created.id, event: "command_started", origin: "osc" });
    runtime.handleShellRuntimeEvent({ sessionId: created.id, event: "command_finished", exitCode: 1, origin: "osc" });
    assert.equal(f.api.getState().tabNotifications[created.id], "failed");
  });
}

for (const startupCmd of [undefined, "codex"]) {
  test(`actual ${startupCmd === undefined ? "inherited" : "explicit"} Agent creation still ignores shell events`, async () => {
    const f = fixture([], [], [], [{ id: "project", cli_tool: "codex" }]);
    await f.api.getState().createSession("project", "/repo", "Agent", startupCmd);
    const created = f.api.getState().sessions[0];
    assert.equal(created.isAgentSession, true);
    assert.equal(created.cliTool, "codex");
    assert.equal(created.startupCmd, "codex");
    assert.equal(monitoredRuntime(f).handleShellRuntimeEvent({ sessionId: created.id, event: "command_started", origin: "osc" }), null);
    assert.equal(f.api.getState().tabNotifications[created.id] ?? "none", "none");
  });
}

test("ephemeral Pi overrides explicit plain startup intent and disabled monitoring ignores plain events", async () => {
  const f = fixture([], [], [], [{ id: "project", cli_tool: "codex" }]);
  await f.api.getState().createSession("project", "/repo", "Pi", "", undefined, "powershell", undefined,
    undefined, undefined, undefined, undefined, undefined, { sessionKind: "ephemeral-pi" });
  assert.equal(f.api.getState().sessions[0].isAgentSession, true);
  assert.equal(f.api.getState().sessions[0].cliTool, "pi");
  assert.equal(monitoredRuntime(f).handleShellRuntimeEvent({ sessionId: "recreated", event: "command_started", origin: "osc" }), null);
  const plainShell = fixture([], [], [], [{ id: "project", cli_tool: "codex" }]);
  await plainShell.api.getState().createSession("project", "/repo", "Shell", "");
  assert.equal(monitoredRuntime(plainShell, false).handleShellRuntimeEvent({ sessionId: "recreated", event: "command_started", origin: "osc" }), null);
  assert.equal(plainShell.api.getState().tabNotifications.recreated ?? "none", "none");
});

test("actual project/worktree plain split preserves no-inherit intent and accepts command_started", async () => {
  const f = fixture([session("a")], [span("w", "p", "a")], [], [{ id: "project", cli_tool: "codex" }],
    [{ id: "wt", project_id: "project", status: "active" }]);
  await f.api.getState().splitTerminal("a", "horizontal", { projectId: "project", worktreeId: "wt", startupCmd: "" });
  const created = f.api.getState().sessions.find((s) => s.id === "recreated");
  assert.equal(created.isAgentSession, false);
  assert.equal(created.cliTool, undefined);
  assert.equal(created.startupCmd, "");
  monitoredRuntime(f).handleShellRuntimeEvent({ sessionId: created.id, event: "command_started", origin: "osc" });
  assert.equal(f.api.getState().tabNotifications[created.id], "running");
});

for (const startupCmd of ["", undefined]) {
  test(`plain recreate does not resume/inherit project Agent (${JSON.stringify(startupCmd)})`, async () => {
    const project = { id: "project", cli_tool: "codex" };
    const f = fixture([session("a", { projectId: project.id, worktreeId: "wt", isAgentSession: false, startupCmd })],
      [span("w", "p", "a")], [], [project]);
    // A CLI-configured project would otherwise make resume detection classify this as Codex.
    f.dependencies.detectCliResumeKind = () => "codex";
    await f.api.getState().restoreSessions(new Map([[project.id, project]]), {});
    assert.equal(f.calls.find(([kind]) => kind === "launch")[1].startupCmd, "");
    const created = f.api.getState().sessions[0];
    assert.equal(created.isAgentSession, false);
    assert.equal(created.startupCmd, "");
    monitoredRuntime(f).handleShellRuntimeEvent({ sessionId: created.id, event: "command_started", origin: "osc" });
    assert.equal(f.api.getState().tabNotifications[created.id], "running");
  });
}

test("new-tab and duplicate launch paths preserve an inherited explicit plain classification", () => {
  const controller = readFileSync(new URL("../hooks/useTerminalTabsController.tsx", import.meta.url), "utf8");
  const newTab = controller.slice(controller.indexOf("const handleNewTab ="), controller.indexOf("const handleNewAnonymousPiSession"));
  assert.match(newTab, /sourceSession\?\.isAgentSession === false && !sourceSession\.startupCmd\s*\? "" : projectLaunchOptions\?\.startupCmd/);
  const duplicate = controller.slice(controller.indexOf("const handleDuplicateSession ="));
  assert.match(duplicate, /session\.isAgentSession === false && !session\.startupCmd \? "" : normalizeDirectCodexStartupCommand\(session\.startupCmd\)/);
});
