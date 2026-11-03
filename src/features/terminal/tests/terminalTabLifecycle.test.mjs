import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the actual store/actions/pure layout code, replacing native boundaries only.
function load(path, dependencies = {}) {
  const sourceText = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter((node) => !ts.isImportDeclaration(node) && !(ts.isExportDeclaration(node) && node.moduleSpecifier)).map((node) => node.getText(source)).join("\n");
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
const currentWork = load("../lib/currentWorkModel.ts");
const batchClose = load("../api/terminalBatchClose.ts");
const layout = load("../lib/terminalStoreLayout.ts", { ...visibility, ...currentWork });
const plain = (value) => JSON.parse(JSON.stringify(value));
const rendererPolicy = load("../types/xTermModel.ts");
const hiddenDisplay = load("../lib/hiddenTerminalDisplayLifecycle.ts");

const naming = load("../lib/terminalSessionNaming.ts", {
  CLI_TOOL_DESCRIPTORS: [{ id: "pi", command: "pi", label: "Pi" }, { id: "claude", command: "claude", label: "Claude" }, { id: "codex", command: "codex", label: "Codex" }],
  normalizeShellKey: (shell) => shell,
});
const agent = load("../../agents/api/agentTerminal.ts");
const worktreeAdmission = load("../lib/worktreeSessionAdmission.ts");

test("close-other batch never calls close for current-work protected sessions", async () => {
  const closed = [];
  await batchClose.closeTerminalSessions(
    ["outside-a", "current-a", "outside-b", "current-b"],
    ["current-a", "current-b"],
    async (sessionId) => closed.push(sessionId),
    () => assert.fail("close should not fail"),
  );
  assert.deepEqual(closed, ["outside-a", "outside-b"]);
});

test("hidden terminal display disposal waits 60 seconds and restores when visible", () => {
  let now = 0;
  const timers = new Map();
  let nextTimerId = 1;
  const scheduler = {
    setTimeout(callback, delayMs) {
      const id = nextTimerId++;
      timers.set(id, { callback, dueAt: now + delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const advanceTo = (target) => {
    now = target;
    for (const [id, timer] of [...timers]) {
      if (timer.dueAt <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  let disposed = 0;
  let restored = 0;
  const lifecycle = hiddenDisplay.createHiddenTerminalDisplayLifecycle(
    () => { disposed += 1; },
    () => { restored += 1; },
    scheduler,
  );
  lifecycle.update({ enabled: true, visible: false });
  assert.equal(timers.size, 1);
  advanceTo(hiddenDisplay.HIDDEN_TERMINAL_DISPOSE_DELAY_MS - 1);
  assert.equal(disposed, 0, "the display remains mounted before the 60-second boundary");
  advanceTo(hiddenDisplay.HIDDEN_TERMINAL_DISPOSE_DELAY_MS);
  assert.equal(disposed, 1, "the display disposes at the 60-second boundary");
  assert.equal(restored, 0);

  lifecycle.update({ enabled: true, visible: true });
  assert.equal(restored, 1);
  assert.equal(timers.size, 0);
  lifecycle.update({ enabled: true, visible: false });
  assert.equal(timers.size, 1);
  lifecycle.update({ enabled: true, visible: true });
  assert.equal(timers.size, 0, "becoming visible clears the pending disposal timer");
  lifecycle.update({ enabled: true, visible: false });
  assert.equal(timers.size, 1);
  lifecycle.update({ enabled: false, visible: false });
  assert.equal(timers.size, 0, "disabling low memory mode clears the pending disposal timer");
  lifecycle.dispose();
});

test("terminal renderer refreshes after the idle threshold but not before it", () => {
  const threshold = rendererPolicy.TERMINAL_IDLE_RENDER_REFRESH_MS;
  assert.equal(rendererPolicy.shouldRefreshTerminalRendererAfterIdle(0, threshold - 1), false);
  assert.equal(rendererPolicy.shouldRefreshTerminalRendererAfterIdle(0, threshold), true);
  assert.equal(rendererPolicy.shouldRefreshTerminalRendererAfterIdle(10_000, 10_000 + threshold + 1), true);
  assert.equal(rendererPolicy.shouldRefreshTerminalRendererAfterIdle(20_000, 19_999), false);
});

test("terminal idle recovery is shared by keyboard forwarding and paste input", () => {
  const controller = readFileSync(new URL("../hooks/useXTermController.ts", import.meta.url), "utf8");
  const input = readFileSync(new URL("../hooks/useTerminalInput.ts", import.meta.url), "utf8");
  assert.match(controller, /onInputActivity: \(terminal\) => terminalInputActivityRef\.current\(terminal\)/);
  assert.match(controller, /visibilityRestoreFallbackTimerRef/);
  assert.match(controller, /window\.setTimeout\(refresh, 250\)/);
  assert.match(input, /onInputActivity\?\.\(terminal\);[\s\S]*terminalProcessManager\.write/);
  assert.match(input, /const pasteText = \(terminal: Terminal, text: string\) =>[\s\S]*onInputActivity\?\.\(terminal\);[\s\S]*terminal\.paste/);
});

function fixture(sessions = [], workspans = [], daemon = [], projects = [], worktrees = [], launchOverrides = {}) {
  const calls = [];
  const persisted = {
    sessions, workspans, activeSessionId: sessions[0]?.id ?? null, activeWorkspanId: workspans[0]?.id ?? null, splits: [],
    currentWorkSessionIds: [], currentWorkActiveSessionId: null, currentWorkPaneTree: null,
    replaceCurrentWorkSession(sourceId, replacementId) {
      const next = currentWork.replaceCurrentWorkSession({ sessionIds: this.currentWorkSessionIds, activeSessionId: this.currentWorkActiveSessionId, paneTree: this.currentWorkPaneTree }, sourceId, replacementId);
      this.currentWorkSessionIds = next.sessionIds; this.currentWorkActiveSessionId = next.activeSessionId; this.currentWorkPaneTree = next.paneTree;
      calls.push(["replaceCurrentWork", sourceId, replacementId]);
    },
    async saveSessions(value) { calls.push(["saveSessions", plain(value)]); this.sessions = value; },
    async saveActiveSessionId(value) { calls.push(["saveActive", value]); this.activeSessionId = value; },
    async saveWorkspans(value, id) { calls.push(["saveWorkspans", plain(value)]); this.workspans = value; this.activeWorkspanId = id; },
    async saveCurrentWork(ids, activeId) { calls.push(["saveCurrentWork", ids, activeId]); this.currentWorkSessionIds = [...ids]; this.currentWorkActiveSessionId = activeId; },
    async saveSplits(value) { this.splits = value; },
  };
  const dependencies = {
    ...metadata, ...pane, ...workspan, ...visibility, ...layout, ...currentWork, ...naming, ...worktreeAdmission,
    startPtyOrphanReconcileHeartbeat() {},
    sshHostNameForLaunch: () => undefined,
    parseProjectEnvVars: () => undefined,
    formatTerminalCreateError: String,
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
    dispatchCurrentWorkSessionCreated(id, activate) { calls.push(["currentWorkCreated", id, activate]); },
    dispatchCurrentWorkSessionReplaced() { calls.push(["currentWorkReplaced"]); },
    async saveRecoverySnapshot(getTerminal) {
      const latest = getTerminal();
      await persisted.saveWorkspans(latest.workspans, latest.activeWorkspanId, latest.sessions);
      calls.push(["recoverySnapshot", plain({ sessions: latest.sessions, ids: persisted.currentWorkSessionIds, tree: persisted.currentWorkPaneTree })]);
    },
    useSettingsStore: { getState: () => ({ workspanEnabled: true, unsplitBehavior: "merge" }) },
    TERMINAL_STORE_IN_TAURI: false,
    reserveWorktreeLaunch: () => () => {},
    async getOsPlatform() { return "windows"; },
    async garbageCollectProviderSnapshots() {}, async garbageCollectProjectExtensionSnapshots() {},
    isCliManagerSyncArtifactText: () => false,
    resolveDaemonAttachTaskStatus: status.resolveDaemonAttachTaskStatus, resolveDaemonAttachUpdatedAt: () => "now",
    resolveAttachedDaemonSession: (ps) => ps ?? {},
    useProjectStore: { getState: () => ({ projects, worktrees, groups: [] }) },
    ...agent,
    recordCrashActivity() {}, summarizeStartupCmd: () => null,
    buildTabStatusUpdate: status.buildTabStatusUpdate,
    detectCliResumeKind: () => null,
    normalizeDirectCodexStartupCommand: (value) => value,
    isDirectCodexStartupCommand: (value) => /^codex(?:\s|$)/.test(value),
    async resolvePtyLaunch() { return { shell: "bash", invokeArgs: {} }; },
    normalizeShellKey: () => "bash",
    logError(...args) { calls.push(["logError", ...args]); }, logInfo() {}, logWarn() {}, logTerminalExitStatus() {},
    releaseRemoteHistoryConsumer() {}, releaseProviderSnapshot() {}, releaseProjectExtensionSnapshot() {},
    clearProjectEditorWorkspacesIfUnused() {},
    applyPtyStatusToSessions: (items) => items,
    toast: { error(...args) { calls.push(["toastError", ...args]); }, info() {}, success() {}, warning() {} },
    setTimeout(callback) { calls.push(["startupTimer", callback]); },
    translateCurrent: (key) => key,
  };
  Object.assign(dependencies, load("../lib/terminalLaunch.ts", dependencies));
  // Keep native/provider launch boundaries mocked, but use actual metadata helpers.
  dependencies.resolvePtyLaunch = async (options) => {
    calls.push(["launch", plain(options)]);
    return { shell: "powershell", invokeArgs: {}, startupHandledByLaunch: true,
      startupCmd: options.startupCmd === "" ? undefined : options.startupCmd ?? projects.find((p) => p.id === options.projectId)?.cli_tool,
      ...launchOverrides };
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
      persistenceQueue = persistenceQueue.catch(() => {}).then(() => persisted.saveSessions(value));
      return persistenceQueue;
    },
    scheduleSaveActiveId: (id) => calls.push(["scheduleActive", id]),
    clearPendingSubagentPanesForParent() {}, stopSubagentTranscriptRetry() {},
    subagentCloseTimers: new Map(), clearHookRunningTimeout() {}, persistSshConnectionStateAfterPtyStatus() {},
  });
  dependencies.createTerminalTabLifecycle = lifecycle.createTerminalTabLifecycle;
  dependencies.create = (initialize) => { state = initialize(api.setState, api.getState, api); return api; };
  Object.assign(dependencies, load("../../projects/api/groupPath.ts"));
  Object.assign(dependencies, load("../lib/terminalRecoveryEnvironment.ts", dependencies));
  Object.assign(dependencies, load("../lib/terminalRecoveryLayout.ts", dependencies));
  Object.assign(dependencies, load("../store/terminalSessionCandidate.ts", dependencies));
  Object.assign(dependencies, load("../store/terminalRecoveryCoordination.ts", dependencies));
  Object.assign(dependencies, load("../store/terminalSessionCreation.ts", dependencies));
  dependencies.assertLocalPty = dependencies.assertRecoverySource;
  Object.assign(dependencies, load("../store/terminalRecoveryActions.ts", dependencies));
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
  const terminal = readFileSync(new URL("../components/XTermTerminal.tsx", import.meta.url), "utf8");
  const hiddenDisplaySource = readFileSync(new URL("../lib/hiddenTerminalDisplayLifecycle.ts", import.meta.url), "utf8");
  const display = readFileSync(new URL("../hooks/useTerminalDisplay.ts", import.meta.url), "utf8");
  assert.match(view, /mountedWorkspanLayouts\.length > 0/);
  assert.match(view, /node=\{layout\.paneTree\}/);
  assert.match(view, /visibleNode=\{layout\.visiblePaneTree\}/);
  assert.match(view, /visibleSessions\.length === 0/);
  assert.match(leaf, /paneSessions\.map\(\(session\)/);
  assert.match(leaf, /<XTermTerminal/);
  assert.match(controller, /protectedSessionIds: readonly string\[\] = \[\], destroy = false/);
  assert.match(controller, /closeTerminalSessions\(sessionIds, protectedSessionIds, destroy \? destroySession : hideSession/);
  assert.match(controller, /visibleSessionIds=\{visibleSessionIds\}/);
  assert.match(controller, /destroy \|\| \(session\.kind \?\? "pty"\) !== "pty"/);
  assert.match(hiddenDisplaySource, /HIDDEN_TERMINAL_DISPOSE_DELAY_MS = 60_000/);
  assert.match(terminal, /Keep the xterm\/parser and PTY output consumer mounted/);
  assert.match(terminal, /<MountedXTermTerminal/);
  assert.doesNotMatch(terminal, /setDisplayMounted\(false\)/);
  assert.match(display, /if \(!isVisibleRef\.current\) \{[\s\S]*queueMicrotask\(flushPendingWrites\)/);
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


test("restore remaps and persists current-work sessions when recreated PTYs get new IDs", async () => {
  const originalSessions = [session("a"), session("b")];
  const f = fixture(originalSessions, [span("w", "p", "a")]);
  f.persisted.currentWorkSessionIds = ["b", "a", "missing"];
  f.persisted.currentWorkActiveSessionId = "a";
  let nextId = 0;
  f.dependencies.terminalProcessManager.create = async () => `recreated-${++nextId}`;

  await f.api.getState().restoreSessions(new Map(), {});

  assert.deepEqual(Array.from(f.api.getState().sessions, (item) => item.id), ["recreated-1", "recreated-2"]);
  assert.deepEqual([...f.persisted.currentWorkSessionIds], ["recreated-2", "recreated-1"]);
  assert.equal(f.persisted.currentWorkActiveSessionId, "recreated-1");
  assert.deepEqual(plain(f.calls.find(([kind]) => kind === "saveCurrentWork")), [
    "saveCurrentWork", ["recreated-2", "recreated-1"], "recreated-1",
  ]);
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
  assert.match(newTab, /resolveTerminalCreationContext/);
  assert.match(newTab, /undefined, context\.startupCmd/);
  const duplicate = controller.slice(controller.indexOf("const handleDuplicateSession ="));
  assert.match(duplicate, /session\.isAgentSession === false && !session\.startupCmd \? "" : normalizeDirectCodexStartupCommand\(session\.startupCmd\)/);
});

test("project batch hide calls real lifecycle only for live ordinary IDs; split members/processes survive sidebar reopening", async () => {
  const { hideProjectTerminalSessions } = load("../api/terminalProjectHide.ts", visibility);
  const sessions = [session("a", { projectId: "p" }), session("b", { projectId: "p" }),
    session("q", { projectId: "q" }), session("editor", { kind: "file-editor" }),
    session("transcript", { kind: "subagent-transcript" }), session("temp", { kind: "synced-history" })];
  const backing = [span("mixed", "pane", "a")];
  backing[0].paneTree.sessionIds = sessions.map(s => s.id);
  const { api, calls, settled } = fixture(sessions, backing);
  const listener = () => calls.push(["listenerDisposed"]);
  api.setState({ statusListeners: { a: listener, b: listener }, sessionStatuses: { a: "running", b: "running" } });
  const hidden = [], errors = [];
  await hideProjectTerminalSessions(["a", "b", "a", "editor", "transcript", "temp", "missing"],
    () => api.getState().sessions, async id => { hidden.push(id); await api.getState().hideSession(id); },
    (...args) => errors.push(args));
  assert.deepEqual(hidden, ["a", "b"]);
  assert.deepEqual(errors, []);
  assert.equal(api.getState().workspans, backing);
  assert.deepEqual(api.getState().sessions.map(s => s.id), sessions.map(s => s.id));
  assert.deepEqual(api.getState().sessions.filter(s => s.tabHidden).map(s => s.id), ["a", "b"]);
  assert.equal(api.getState().statusListeners.a, listener);
  assert.equal(api.getState().statusListeners.b, listener);
  assert.equal(api.getState().sessionStatuses.a, "running");
  for (const id of hidden) api.getState().reopenSession(id); // same entry used by sidebar reopen
  await settled();
  assert.equal(api.getState().activeSessionId, "b");
  assert.ok(api.getState().sessions.every(s => !s.tabHidden));
  assert.ok(!calls.some(([kind]) => ["close", "create", "unlisten", "listenerDisposed"].includes(kind)));
  assert.deepEqual(plain(api.getState().workspans[0].paneTree.sessionIds), sessions.map(s => s.id));
  assert.equal(api.getState().workspans[0].id, "mixed");
});

test("project hide handler revalidates each live kind after awaits, dedupes and continues safely on errors", async () => {
  const { hideProjectTerminalSessions } = load("../api/terminalProjectHide.ts", visibility);
  let sessions = [session("a"), session("b"), session("c")];
  const calls = [], errors = [];
  await hideProjectTerminalSessions(["a", "a", "b", "c"], () => sessions, async id => {
    calls.push(id);
    if (id === "a") {
      sessions = sessions.map(s => s.id === "b" ? { ...s, kind: "file-editor" } : s);
      throw new Error("hide failed");
    }
  }, (id, err) => errors.push([id, err.message]));
  assert.deepEqual(calls, ["a", "c"]);
  assert.deepEqual(errors, [["a", "hide failed"]]);
});


test("naming concurrent creates and split uses synchronous successful commit and project/worktree scopes", async () => {
  const f = fixture([session("a")], [span("w", "p", "a")]);
  let id = 0;
  f.dependencies.terminalProcessManager.create = async () => `new-${++id}`;
  await Promise.all([
    f.api.getState().createSession("project", "/repo", undefined, "pi"),
    f.api.getState().createSession("project", "/repo", undefined, "pi"),
    f.api.getState().splitTerminal("a", "horizontal", { projectId: "project", startupCmd: "pi" }),
  ]);
  assert.deepEqual(plain(f.api.getState().sessions.filter(s => s.id !== "a").map(s => s.title).sort()), ["Pi · 1", "Pi · 2", "Pi · 3"]);
  await f.api.getState().createSession("other", "/other", undefined, "pi");
  assert.equal(f.api.getState().sessions.at(-1).title, "Pi · 1");
  const first = f.api.getState().sessions.find(s => s.title === "Pi · 1" && s.projectId === "project");
  f.api.getState().renameSession(first.id, first.title);
  assert.equal(f.api.getState().sessions.find(s => s.id === first.id).titleNaming.source, "custom");
});

test("failed subscription and abandoned split do not consume numbering; pending restore metadata reserves ordinals", async () => {
  const pending = { ...session("pending"), projectId: "project", title: "custom", titleNaming: { source: "custom", base: "Pi", ordinal: 7 } };
  const f = fixture([], []);
  f.persisted.sessions = [pending];
  const subscribe = f.dependencies.terminalProcessManager.subscribeStatus;
  f.dependencies.terminalProcessManager.subscribeStatus = async () => { throw new Error("subscription"); };
  await assert.rejects(f.api.getState().createSession("project", "/repo", undefined, "pi"));
  assert.equal(f.api.getState().sessions.length, 0);
  f.dependencies.terminalProcessManager.subscribeStatus = subscribe;
  await f.api.getState().createSession("project", "/repo", undefined, "pi");
  assert.equal(f.api.getState().sessions[0].title, "Pi · 8");
});

for (const daemon of [false, true]) test(`restore naming and CLI identity unchanged (${daemon ? "attach" : "recreate"})`, async () => {
  for (const title of ["Terminal", "project", "Pi · 1", "task"]) {
    const original = { ...session("a"), title, cliSessionId: "conversation", titleNaming: title === "task" ? { source: "task" } : undefined };
    const f = fixture([original], [span("w", "p", "a")], daemon ? [{ sessionId: "a", alive: true }] : []);
    await f.api.getState().restoreSessions(new Map(), {});
    assert.equal(f.api.getState().sessions[0].title, title);
    assert.deepEqual(plain(f.api.getState().sessions[0].titleNaming ?? null), original.titleNaming ?? null);
    assert.equal(f.api.getState().sessions[0].cliSessionId, "conversation");
  }
});


test("abandoned split and failed persistence retain only successfully committed numbering", async () => {
  const f = fixture([session("a")], [span("w", "p", "a")]);
  const subscribe = f.dependencies.terminalProcessManager.subscribeStatus;
  f.dependencies.terminalProcessManager.subscribeStatus = async (id, callback) => {
    const unlisten = await subscribe(id, callback);
    f.api.setState({ sessions: [], workspans: [] });
    return unlisten;
  };
  assert.equal(await f.api.getState().splitTerminal("a", "horizontal", { startupCmd: "pi" }), null);
  assert.equal(f.api.getState().sessions.length, 0);
  f.dependencies.terminalProcessManager.subscribeStatus = subscribe;
  let count = 0;
  f.dependencies.terminalProcessManager.create = async () => `committed-${++count}`;
  f.persisted.saveSessions = async () => { throw new Error("disk"); };
  await f.api.getState().createSession(undefined, "/repo", undefined, "pi");
  assert.equal(f.api.getState().sessions[0].title, "Pi · 1");
  await f.api.getState().createSession(undefined, "/repo", undefined, "pi");
  assert.equal(f.api.getState().sessions[1].title, "Pi · 2");
});

for (const action of ["create", "split"]) {
  for (const failure of ["saveSessions", "saveActiveSessionId", "saveWorkspans", ...(action === "split" ? ["saveSplits"] : [])]) {
    test(`actual ${action} callback delivers startup and returns committed ID after ${failure} disk failure`, async () => {
      const f = fixture([session("a")], [span("w", "p", "a")], [], [], [], { startupHandledByLaunch: false });
      // Reject the persistence boundary at the same point as Store.save(), with
      // the PTY/layout already committed. Other snapshot steps must still run.
      if (failure === "saveSessions") {
        // Use the real sessionStore.set -> Store.save chain for the newly
        // introduced disk-flush rejection, not only a rejected action stub.
        const { useSessionStore: diskStore } = load("../api/sessionStore.ts", {
          create(initialize) {
            let state = initialize();
            return { getState: () => state, setState: update => { state = { ...state, ...update }; } };
          },
          Store: { load: async () => ({
            async set(key) { f.calls.push(["diskSet", key]); },
            async save() { f.calls.push(["diskFailure", "save"]); throw new Error("disk unavailable"); },
          }) },
          getCliManagerDataPaths: async () => ({ sessionsStorePath: "sessions.dev.json" }),
          singleFlight: fn => fn,
        });
        f.persisted.saveSessions = diskStore.getState().saveSessions;
      } else {
        f.persisted[failure] = async () => { f.calls.push(["diskFailure", failure]); throw new Error("disk unavailable"); };
      }
      const id = action === "create"
        ? await f.api.getState().createSession(undefined, "/repo", undefined, "codex")
        : await f.api.getState().splitTerminal("a", "horizontal", { cwd: "/repo", startupCmd: "codex" });
      assert.equal(id, "recreated", "a live terminal is not returned as a failed creation");
      assert.equal(f.api.getState().sessions.filter(s => s.id === id).length, 1);
      if (action === "split") {
        const timer = f.calls.find(([kind]) => kind === "startupTimer");
        assert.ok(timer, "startup dispatch scheduled despite snapshot rejection");
        timer[1]();
        await Promise.resolve();
      }
      assert.ok(f.calls.some(([kind, target, text]) => kind === "write" && target === id && text.includes("codex")));
      assert.ok(f.calls.some(([kind, key]) => kind === "toastError" && key === "saveSession.failed"));
      assert.ok(f.calls.some(([kind, message, detail]) => kind === "logError" && message === "Failed to persist committed terminal launch"
        && detail.sessionId === id && String(detail.err).includes("disk unavailable")));
      assert.ok(!f.calls.some(([kind, key]) => kind === "toastError" && /createFailed|splitCreateFailed/.test(key)));
      if (failure !== "saveActiveSessionId") assert.ok(f.calls.some(([kind]) => kind === "saveActive"));
      if (failure !== "saveWorkspans") assert.ok(f.calls.some(([kind]) => kind === "saveWorkspans"));
    });
  }
}

test("ordinary new context reaches actual create action as fresh project CLI, while explicit plain stays shell", async () => {
  const contextApi = load("../api/terminalCreationContext.ts", {
    ...load("../api/terminalProject.ts"),
    resolveProjectPath: project => project.path,
    parseProjectEnvVars: () => ({ PROJECT: "yes" }),
  });
  const project = { id: "project", path: "/repo", cli_tool: "codex", shell: "powershell" };
  const worktree = { id: "wt", project_id: "project", path: "/repo-wt", status: "active" };
  for (const plainShell of [false, true]) {
    const source = session("a", { projectId: project.id, worktreeId: worktree.id, cwd: "/repo-wt/sub", title: "Custom",
      cliSessionId: "old", startupCmd: plainShell ? "" : "codex resume old", isAgentSession: !plainShell });
    const context = contextApi.resolveTerminalCreationContext(source, [source], [project], [worktree], []);
    const f = fixture([source], [span("w", "p", "a")], [], [project], [worktree], { startupHandledByLaunch: false });
    const reused = await f.api.getState().createSession(context.projectId, context.cwd, undefined, context.startupCmd,
      context.envVars, context.shell, undefined, context.worktreeId, context.sshHostId);
    assert.equal(reused, "a");
    assert.equal(f.api.getState().sessions.length, 1);
    assert.equal(f.api.getState().sessions[0].title, "Custom");
    assert.equal(f.calls.some(([kind]) => kind === "create" || kind === "write"), false);
  }
});

for (const failure of ["create", "subscribe", "close", "cleanup", "save"]) {
  test(`recovery transaction fault ${failure} retains owned resources and distinguishes commit`, async () => {
    const f = fixture([session("a", { cwd: "/repo", createdAtMs: 7 })], [span("w", "p", "a")]);
    const manager = f.dependencies.terminalProcessManager;
    if (failure === "create") manager.create = async () => { throw new Error("create failure"); };
    if (failure === "subscribe") manager.subscribeStatus = async () => { throw new Error("subscribe failure"); };
    if (failure === "close" || failure === "cleanup") manager.close = async (id, strict) => {
      f.calls.push(["close", id, strict]);
      if (id === "a" || failure === "cleanup") throw new Error("close failure");
    };
    if (failure === "save") f.persisted.saveWorkspans = async () => { throw new Error("disk"); };
    await assert.rejects(f.api.getState().rebuildSession("a"), error => failure === "save"
      ? error.message === "terminal_recovery_persistence_failed" && error.committedSessionId === "recreated"
      : failure === "cleanup" ? error.message === "terminal_recovery_cleanup_failed" : true);
    const ids = f.api.getState().sessions.map(item => item.id);
    assert.equal(ids.includes("a"), failure !== "save");
    assert.equal(ids.includes("recreated"), failure === "cleanup" || failure === "save");
    if (failure === "create" || failure === "subscribe") assert.equal(f.calls.some(([kind, id]) => kind === "close" && id === "a"), false);
    if (failure === "cleanup") assert.ok(f.api.getState().workspans.some(w => workspan.collectWorkspanSessionIds(w).includes("recreated")));
  });
}

test("recovery subscribe+cleanup double failure keeps a visible retryable candidate", async () => {
  const f = fixture([session("a", { cwd: "/repo" })], [span("w", "p", "a")]);
  f.dependencies.terminalProcessManager.subscribeStatus = async () => { throw new Error("subscription"); };
  f.dependencies.terminalProcessManager.close = async () => { throw new Error("cleanup"); };
  await assert.rejects(f.api.getState().rebuildSession("a"), /terminal_recovery_cleanup_failed/);
  assert.deepEqual(plain(f.api.getState().sessions.map(s => s.id)), ["a", "recreated"]);
  assert.ok(f.api.getState().statusListeners.recreated);
});

test("recovery prepares unpublished status subscription, deduplicates, and commits latest multi-workspan layout", async () => {
  const f = fixture([session("a", { cwd: "/repo", createdAtMs: 1 }), session("b")], [span("w", "p", "a"), span("other", "other-pane", "b")]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const subscribe = f.dependencies.terminalProcessManager.subscribeStatus;
  f.dependencies.terminalProcessManager.subscribeStatus = async (id, callback) => {
    const unlisten = await subscribe(id, callback);
    callback({ status: "running" });
    assert.equal(f.api.getState().sessions.some(s => s.id === "recreated"), false);
    assert.equal(f.api.getState().sessionStatuses.recreated, undefined);
    await gate;
    return unlisten;
  };
  const first = f.api.getState().rebuildSession("a");
  const second = f.api.getState().rebuildSession("a");
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(([kind]) => kind === "close"), false);
  f.api.setState({ sessions: [...f.api.getState().sessions, session("concurrent")], workspans: [...f.api.getState().workspans.map(w => ({ ...w, customTitle: "latest" })), span("new", "new-pane", "concurrent")], activeWorkspanId: "other" });
  f.persisted.currentWorkSessionIds = ["b", "a", "concurrent"];
  f.persisted.currentWorkActiveSessionId = "b";
  f.persisted.currentWorkPaneTree = { type: "split", id: "cw-split", direction: "horizontal", ratio: 0.7,
    first: {type: "leaf", id: "cw-left", sessionIds: ["b", "concurrent"], activeSessionId: "b"},
    second: {type: "leaf", id: "cw-right", sessionIds: ["a"], activeSessionId: "a"} };
  release();
  assert.equal(await first, "recreated");
  assert.deepEqual(plain(f.persisted.currentWorkSessionIds), ["b", "recreated", "concurrent"]);
  assert.equal(f.persisted.currentWorkActiveSessionId, "b");
  assert.equal(f.persisted.currentWorkPaneTree.ratio, 0.7);
  assert.equal(f.persisted.currentWorkPaneTree.second.id, "cw-right");
  assert.deepEqual(plain(f.persisted.currentWorkPaneTree.second.sessionIds), ["recreated"]);
  assert.ok(f.calls.findIndex(([kind]) => kind === "replaceCurrentWork") < f.calls.findIndex(([kind]) => kind === "currentWorkReplaced"));
  assert.deepEqual(f.api.getState().sessions.map(s => s.id), ["recreated", "b", "concurrent"]);
  assert.equal(f.api.getState().workspans.length, 3);
  assert.equal(f.api.getState().workspans[0].customTitle, "latest");
  assert.equal(f.api.getState().activeSessionId, "b");
  assert.equal(f.api.getState().sessionStatuses.recreated, "running");
  assert.equal(f.calls.filter(([kind]) => kind === "create").length, 1);
  assert.equal(f.calls.some(([kind]) => kind === "write"), false);
  assert.equal(f.calls.find(([kind]) => kind === "launch")[1].startupCmd, "");
});

for (const strict of [false, true]) {
  test(`recovery close race strict=${strict} cancels before destruction without blocking unrelated close`, async () => {
    const f = fixture([session("a", { cwd: "/repo" }), session("b")], [span("w", "p", "a"), span("other", "other-pane", "b")]);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const subscribe = f.dependencies.terminalProcessManager.subscribeStatus;
    f.dependencies.terminalProcessManager.subscribeStatus = async (...args) => { await gate; return subscribe(...args); };
    const rebuild = f.api.getState().rebuildSession("a");
    await new Promise(resolve => setImmediate(resolve));
    const close = strict ? f.api.getState().hardKillSession("a") : f.api.getState().closeSession("a");
    await f.api.getState().closeSession("b");
    assert.equal(f.api.getState().sessions.some(s => s.id === "b"), false);
    release();
    await assert.rejects(rebuild, /terminal_recovery_session_changed/);
    await close;
    assert.equal(f.api.getState().sessions.length, 0);
  });
}

test("recovery environment preserves nondefault WSL UNC, POSIX cwd, inherited path and rejects foreign checkout/SSH", async () => {
  const f = fixture();
  const resolve = f.dependencies.resolveRecoveryEnvironment;
  const state = { projects: [{ id: "project", path: "stale", path_mode: "inherit", group_id: "g", shell: "pwsh" }], groups: [{ id: "g", bound_path: "/inherited" }], worktrees: [] };
  assert.equal(resolve(session("a", { projectId: "project" }), state).cwd, "/inherited");
  const wsl = session("a", { cwd: "/home/user/sub", shell: "wsl", environmentType: "wsl", wslDistroName: "Debian-Custom", envVars: { PATH: "/custom" } });
  const env = resolve(wsl, state);
  assert.equal(env.cwd, String.raw`\\wsl.localhost\Debian-Custom\home\user\sub`);
  assert.equal(env.envVars.PATH, "/custom");
  const unc = String.raw`\\wsl$\Existing\home\user`;
  assert.equal(resolve({ ...wsl, cwd: unc }, state).cwd, unc);
  assert.throws(() => resolve({ ...wsl, environmentType: "ssh" }, state), /unsupported_remote/);
  assert.throws(() => resolve(session("a", { projectId: "project" }), { ...state, projects: [{ ...state.projects[0], environment_type: "ssh" }] }), /unsupported_remote/);
  assert.throws(() => resolve(session("a", { projectId: "project", worktreeId: "wt" }), { ...state, worktrees: [{ id: "wt", project_id: "foreign", status: "active", path: "/wt" }] }), /worktree_missing/);
});

test("recovery resolved SSH is rejected before candidate creation or source close", async () => {
  const f = fixture([session("a", { cwd: "/repo" })], [span("w", "p", "a")], [], [], [], { environmentType: "ssh" });
  await assert.rejects(f.api.getState().rebuildSession("a"), /unsupported_remote/);
  assert.equal(f.calls.some(([kind]) => kind === "create" || kind === "close"), false);
});

test("recovery revalidates project SSH and source incarnation after candidate preparation", async () => {
  for (const change of ["ssh", "incarnation"]) {
    const project = { id: "project", path: "/repo" };
    const f = fixture([session("a", { projectId: project.id, cwd: "/repo", createdAtMs: 1 })], [span("w", "p", "a")], [], [project]);
    const subscribe = f.dependencies.terminalProcessManager.subscribeStatus;
    f.dependencies.terminalProcessManager.subscribeStatus = async (...args) => {
      const result = await subscribe(...args);
      if (change === "ssh") project.environment_type = "ssh";
      else f.api.setState({ sessions: [session("a", { cwd: "/new", createdAtMs: 2 })] });
      return result;
    };
    await assert.rejects(f.api.getState().rebuildSession("a"), /unsupported_remote|session_changed/);
    assert.equal(f.calls.some(([kind, id]) => kind === "close" && id === "a"), false);
    assert.ok(f.calls.some(([kind, id]) => kind === "close" && id === "recreated"));
  }
});

test("recovery ordinary close during source ACK closes replacement even when postcommit persistence fails", async () => {
  const f = fixture([session("a", { cwd: "/repo", createdAtMs: 1 })], [span("w", "p", "a")]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const close = f.dependencies.terminalProcessManager.close;
  let closeRequested;
  const ackStarted = new Promise(resolve => { closeRequested = resolve; });
  f.dependencies.terminalProcessManager.close = async (id, strict) => {
    if (id === "a") { closeRequested(); await gate; }
    return close(id, strict);
  };
  f.persisted.saveWorkspans = async () => { throw new Error("disk"); };
  const rebuild = f.api.getState().rebuildSession("a");
  const rejected = assert.rejects(rebuild, /persistence_failed/);
  await ackStarted;
  const closing = f.api.getState().closeSession("a").catch(error => { assert.match(String(error), /disk/); });
  release();
  await rejected;
  await closing;
  assert.equal(f.api.getState().sessions.length, 0);
  assert.ok(f.calls.some(([kind, id]) => kind === "close" && id === "recreated"));
});

test("recovery layout substitution retains empty pane nodes, ratios and other session IDs", () => {
  const { replaceRecoveryLayoutSession } = load("../lib/terminalRecoveryLayout.ts");
  const tree = { type: "split", id: "split", ratio: 0.37, direction: "horizontal", first: { type: "leaf", id: "pane", sessionIds: ["a", "b"], activeSessionId: "b" }, second: { type: "leaf", id: "empty", sessionIds: [], activeSessionId: null } };
  const result = replaceRecoveryLayoutSession([{ id: "w", paneTree: tree, activePaneId: "empty", activeSessionId: "b" }], "a", "new");
  assert.equal(result[0].paneTree.ratio, 0.37);
  assert.equal(result[0].activePaneId, "empty");
  assert.deepEqual(plain(result[0].paneTree.first.sessionIds), ["new", "b"]);
  assert.deepEqual(plain(result[0].paneTree.second), tree.second);
});

test("recovery emergency uses normal creation, deduplicates and close still targets source", async () => {
  const source = session("a", { cwd: "/repo", shell: "powershell", envVars: { CUSTOM: "yes" }, startupCmd: "codex resume old", cliSessionId: "old" });
  const f = fixture([source], [span("w", "p", "a")]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const subscribe = f.dependencies.terminalProcessManager.subscribeStatus;
  f.dependencies.terminalProcessManager.subscribeStatus = async (...args) => { await gate; return subscribe(...args); };
  const emergency = f.api.getState().openEmergencyTerminal("a");
  assert.equal(emergency, f.api.getState().openEmergencyTerminal("a"));
  await new Promise(resolve => setImmediate(resolve));
  const closing = f.api.getState().closeSession("a");
  release();
  assert.equal(await emergency, "recreated");
  await closing;
  assert.deepEqual(plain(f.api.getState().sessions.map(s => s.id)), ["recreated"]);
  assert.equal(f.api.getState().sessions[0].startupCmd, "");
  assert.equal(f.api.getState().sessions[0].cliSessionId, undefined);
  assert.equal(f.calls.some(([kind]) => kind === "write"), false);
  assert.equal(f.api.getState().activeSessionId, "recreated");
});


test("recovery source removed during close ACK cleans candidate and never resurrects membership", async () => {
 const f = fixture([session("a", {cwd:"/repo",createdAtMs:1}),session("b")],[span("w","p","a"),span("other","q","b")]);
 f.persisted.currentWorkSessionIds=["b"];
 f.dependencies.terminalProcessManager.close=async id=>{
  f.calls.push(["close",id]);
  if(id==="a") f.api.setState({sessions:f.api.getState().sessions.filter(s=>s.id!=="a"),workspans:[span("other","q","b")]});
 };
 await assert.rejects(f.api.getState().rebuildSession("a"),/session_changed/);
 assert.deepEqual(plain(f.api.getState().sessions.map(s=>s.id)),["b"]);
 assert.deepEqual(f.persisted.currentWorkSessionIds,["b"]);
 assert.ok(f.calls.some(([kind,id])=>kind==="close"&&id==="recreated"));
});

for (const status of ["exited", "error"]) {
  for (const cleanupFails of [false, true]) test(`recovery rejects ${status} candidate before source close; cleanup failure=${cleanupFails}`, async () => {
    const f = fixture([session("a", { cwd: "/repo" })], [span("w", "p", "a")]);
    f.dependencies.terminalProcessManager.subscribeStatus = async (id, cb) => { cb({ status }); return () => f.calls.push(["unlisten", id]); };
    f.dependencies.terminalProcessManager.close = async id => { f.calls.push(["close", id]); if (cleanupFails) throw new Error("cleanup"); };
    await assert.rejects(f.api.getState().rebuildSession("a"), cleanupFails ? /cleanup_failed/ : /candidate_not_ready/);
    assert.equal(f.calls.some(([kind, id]) => kind === "close" && id === "a"), false);
    assert.equal(f.api.getState().sessions.some(s => s.id === "a"), true);
    assert.equal(f.api.getState().sessions.some(s => s.id === "recreated"), cleanupFails);
    if (cleanupFails) {
      assert.equal(f.api.getState().sessionStatuses.recreated, status);
      assert.ok(f.api.getState().statusListeners.recreated);
      assert.ok(f.api.getState().workspans.some(w => workspan.collectWorkspanSessionIds(w).includes("recreated")));
    } else assert.ok(f.calls.some(([kind, id]) => kind === "unlisten" && id === "recreated"));
  });
  test(`recovery reports ${status} during irreversible source close with committed actual status`, async () => {
    const f = fixture([session("a", { cwd: "/repo" })], [span("w", "p", "a")]);
    let callback;
    f.dependencies.terminalProcessManager.subscribeStatus = async (id, cb) => { callback = cb; return () => {}; };
    f.dependencies.terminalProcessManager.close = async id => { f.calls.push(["close", id]); if (id === "a") { callback({ status }); await Promise.resolve(); } };
    await assert.rejects(f.api.getState().rebuildSession("a"), e => e.message === "terminal_recovery_candidate_died_after_close" && e.committedSessionId === "recreated");
    assert.deepEqual(plain(f.api.getState().sessions.map(s => s.id)), ["recreated"]);
    assert.equal(f.api.getState().sessionStatuses.recreated, status);
    assert.ok(f.calls.some(([kind]) => kind === "recoverySnapshot"));
    assert.equal(f.calls.some(([kind, id]) => kind === "close" && id === "recreated"), false);
  });
}

test("general presentation after actual local hide rejects global CW SSH fallback and last scope member", async () => {
  const presentation = load("../lib/terminalPresentation.ts", visibility);
  const visibleLayouts = load("../hooks/useTerminalVisibleLayouts.ts", { ...pane, ...workspan, ...visibility, useMemo: (fn) => fn() });
  const portals = load("../hooks/useCurrentWorkPortalTargets.ts", {
    ...pane, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useState: () => [new Map([["cw-pane", {}]]), () => {}],
  });
  const { useTerminalPresentation } = load("../hooks/useTerminalPresentation.ts", {
    ...pane, ...presentation, ...visibleLayouts, ...portals, useMemo: (fn) => fn(),
  });
  const backing = [span("first", "local-pane", "local-shell"), span("second", "ssh-pane", "remote-member"), span("third", "other-pane", "other-shell")];
  const { api, calls, settled } = fixture([
    session("local-shell", { environmentType: "local", cliSessionId: "conversation-a" }),
    session("remote-member", { environmentType: "ssh", connectionState: "disconnected" }),
    session("other-shell", { environmentType: "wsl" }),
  ], backing);
  api.setState({ sessionStatuses: { "remote-member": "exited" } });
  await api.getState().hideSession("local-shell");
  await settled();
  const state = api.getState();
  assert.equal(state.activeSessionId, "remote-member", "global durable fallback remains permitted");
  const cw = pane.createPaneLeaf("cw-pane", ["remote-member"], "remote-member");
  const render = (scope, mode = false) => useTerminalPresentation(state.workspans, state.sessions, scope, state.activeWorkspanId,
    state.activeSessionId, null, ["remote-member"], mode, cw, "remote-member");
  assert.equal(render(null).effectiveActiveSessionId, "other-shell");
  assert.equal(render(new Set(["local-shell"])).effectiveActiveSessionId, null);
  assert.equal(render(new Set(["local-shell"]), true).currentWorkSessionPortalTargets.size, 0);
  assert.equal(render(null, true).effectiveActiveSessionId, "remote-member");
  assert.equal(state.workspans, backing);
  assert.equal(state.sessions[0].cliSessionId, "conversation-a");
  assert.equal(state.sessions[1].connectionState, "disconnected");
  assert.equal(calls.some(([kind]) => ["create", "close", "unlisten"].includes(kind)), false);
});
