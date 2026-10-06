import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the actual extracted runtime with an in-memory Zustand-compatible API.
// Imports are replaced at the module boundary; no Tauri, browser or real timer starts.
function loadModule(file, dependencies = {}) {
  const text = readFileSync(new URL(file, import.meta.url), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join("\n");
  const output = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(output, { exports, ...dependencies }, { filename: file });
  return exports;
}

function fixture(initial = {}, saveSessions = async () => {}, boundaries = {}) {
  let state = { sessions: [], splits: {}, tabStatuses: {}, tabNotifications: {}, tabStatusDetails: {},
    ptyOutputActivityAt: {}, statsPanelRefreshSeq: 0, subagentTranscripts: {}, ...initial };
  const timers = new Map();
  let nextTimer = 0;
  const api = {
    getState: () => state,
    setState: update => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; },
  };
  const status = loadModule("../src/features/terminal/lib/terminalStatus.ts");
  const subagent = loadModule("../src/features/terminal/lib/subagentTranscriptModel.ts");
  const { createTerminalRuntime } = loadModule("../src/features/terminal/store/terminalRuntime.ts", {
    ...status, ...subagent,
    ...loadModule("../src/features/terminal/lib/terminalTaskPresentation.ts"),
    ...loadModule("../src/features/terminal/store/terminalHookBinding.ts"),
    ...loadModule("../src/features/terminal/store/terminalCliSession.ts"),
    ...loadModule("../src/features/agents/api/agentTerminal.ts"),
    ...loadModule("../src/shared/platform/shell.ts"),
    ...loadModule("../src/features/terminal/api/terminalProject.ts"),
    useProjectStore: { getState: () => ({ projects: [], worktrees: [] }) },
    isShellRuntimeMonitoringEnabled: () => true,
    HOOK_RUNNING_TIMEOUT_MS: 100,
    useSessionStore: { getState: () => ({ saveSessions, sessions: [] }) },
    logError() {}, logWarn() {}, logInfo() {}, debugConsoleWarn() {},
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    ...boundaries,
  });
  const runtime = createTerminalRuntime(api.setState, api.getState, api);
  api.setState(runtime.actions);
  return { api, runtime, timers, maxChars: status.SUBAGENT_TRANSCRIPT_MAX_CHARS };
}

test("runtime construction starts no timers and keeps counters in one owner", () => {
  const { runtime, timers } = fixture();
  assert.equal(timers.size, 0);
  assert.match(runtime.createPaneId(), /-1$/);
  assert.match(runtime.createPaneId(), /-2$/);
  assert.match(runtime.createWorkspanId(), /-1$/);
  assert.match(runtime.createWorkspanId(), /-2$/);
});

test("attention handling and timeout update the same current store API", () => {
  const { api, timers } = fixture({ sessions: [{ id: "tab" }], tabStatuses: { tab: { hook: "attention" } } });
  api.getState().markAttentionInputHandled("tab");
  assert.equal(api.getState().tabStatuses.tab.hook, "running");
  assert.equal(timers.size, 1);
  const expire = [...timers.values()][0];
  expire();
  assert.equal(api.getState().tabStatuses.tab.hook, "none");
  api.setState({ tabStatuses: { tab: { hook: "attention" } } });
  api.getState().markAttentionInputHandled("tab");
  api.setState({ sessions: [] });
  [...timers.values()].at(-1)();
  assert.equal(api.getState().tabStatuses.tab.hook, "running", "a closed session must not be modified by its timeout");
});

test("transcript actions ignore unknown keys and preserve bounded append/reset behavior", () => {
  const { api, maxChars } = fixture({ subagentTranscripts: { known: { content: "old", resetSeq: 0 } } });
  const prior = api.getState().subagentTranscripts;
  api.getState().appendSubagentTranscript("unknown", "text", false);
  assert.equal(api.getState().subagentTranscripts, prior);
  api.getState().appendSubagentTranscript("known", "tail", false);
  assert.equal(api.getState().subagentTranscripts.known.content, "oldtail");
  api.getState().appendSubagentTranscript("known", "x".repeat(maxChars + 10), false);
  const trimmed = api.getState().subagentTranscripts.known;
  assert.equal(trimmed.content.length, maxChars);
  assert.equal(trimmed.truncatedBytes, 17);
  assert.equal(trimmed.resetSeq, 1);
  api.getState().appendSubagentTranscript("known", "reset", true);
  assert.equal(api.getState().subagentTranscripts.known.content, "reset");
  assert.equal(api.getState().subagentTranscripts.known.truncatedBytes, 0);
  assert.equal(api.getState().subagentTranscripts.known.resetSeq, 2);
});

test("session persistence snapshots inputs, serializes writes and recovers after failure", async () => {
  const writes = [];
  let release;
  const firstWrite = new Promise(resolve => { release = resolve; });
  const { runtime } = fixture({}, async sessions => {
    writes.push(sessions);
    if (writes.length === 1) { await firstWrite; throw new Error("simulated storage failure"); }
  });
  const sessions = [{ id: "first" }];
  const first = runtime.queueSshSessionPersistence(sessions);
  const failed = assert.rejects(first, /simulated storage failure/);
  sessions[0].id = "changed";
  const second = runtime.queueSshSessionPersistence([{ id: "second" }]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].id, "first");
  release();
  await failed;
  await second;
  assert.equal(writes.length, 2);
  assert.equal(writes[1][0].id, "second");
});


test("actual shell runtime: empty prompt idle, command started running through silence, completion/failure retained", () => {
  for (const shell of ["cmd", "powershell", "pwsh", "wsl", "bash"]) {
    const { api, timers } = fixture({ sessions: [{ id: "tab", shell }], tabNotifications: { tab: "none" } });
    const send = (event, exitCode) => api.getState().handleShellRuntimeEvent({ sessionId: "tab", event, exitCode, origin: "osc" });
    send("prompt_shown");
    assert.equal(api.getState().tabNotifications.tab, "none");
    send("command_started");
    assert.equal(api.getState().tabNotifications.tab, "running");
    assert.equal(timers.size, 0, "output silence does not schedule task-idle timers");
    api.setState({ ptyOutputActivityAt: { tab: Date.now() - 24 * 60 * 60 * 1000 } });
    assert.equal(api.getState().tabNotifications.tab, "running", "a silent long command remains explicit running");
    send("command_finished", 0); send("prompt_shown");
    assert.equal(api.getState().tabNotifications.tab, "done");
    send("command_started"); send("command_finished", 1); send("prompt_shown");
    assert.equal(api.getState().tabNotifications.tab, "failed");
    send("command_started"); send("prompt_shown");
    assert.equal(api.getState().tabNotifications.tab, "done", "prompt closes interrupted shell commands without erasing completion");
  }
});

test("actual runtime respects monitoring/input/agent boundaries; missing hooks cannot infer running", () => {
  for (const shell of ["cmd", "powershell", "wsl"]) {
    const { api } = fixture({ sessions: [{ id: "tab", shell }], tabNotifications: { tab: "none" } });
    api.getState().handleShellRuntimeEvent({ sessionId: "tab", event: "command_started", origin: "input" });
    assert.equal(api.getState().tabNotifications.tab, shell === "cmd" ? "running" : "none");
    const disabled = fixture({ sessions: [{ id: "tab", shell }], tabNotifications: { tab: "none" } }, undefined,
      { isShellRuntimeMonitoringEnabled: () => false });
    disabled.api.getState().handleShellRuntimeEvent({ sessionId: "tab", event: "command_started", origin: "osc" });
    assert.equal(disabled.api.getState().tabNotifications.tab, "none");
  }
  for (const environmentType of [undefined, "ssh"]) {
    const { api } = fixture({ sessions: [{ id: "tab", isAgentSession: true, environmentType }], tabNotifications: { tab: "none" } });
    api.getState().handleShellRuntimeEvent({ sessionId: "tab", event: "command_started", origin: "osc" });
    assert.equal(api.getState().tabNotifications.tab, "none", "agent shell life is not a turn signal");
  }
});

test("actual hook runtime: SessionStart idle, submit running, attention, Stop/failed and Interrupt", () => {
  for (const environmentType of [undefined, "ssh"]) {
    const { api } = fixture({ sessions: [{ id: "tab", isAgentSession: true, cliTool: "claude", environmentType }],
      tabNotifications: { tab: "none" } });
    let tick = 0;
    const send = (event) => api.getState().handleCliHookEvent({ tabId: "tab", source: "claude", event,
      environmentType, timestamp: new Date(1700000000000 + tick++).toISOString() });
    send("SessionStart"); assert.equal(api.getState().tabNotifications.tab, "none");
    send("UserPromptSubmit"); assert.equal(api.getState().tabNotifications.tab, "running");
    api.setState({ ptyOutputActivityAt: { tab: Date.now() - 60_000 } });
    assert.equal(api.getState().tabNotifications.tab, "running");
    send("PermissionRequest"); assert.equal(api.getState().tabNotifications.tab, "attention");
    send("PermissionResult"); assert.equal(api.getState().tabNotifications.tab, "running");
    api.setState({ tabStatuses: { tab: { ...api.getState().tabStatuses.tab, shell: "running" } } });
    send("Stop"); assert.equal(api.getState().tabNotifications.tab, "done");
    assert.equal(api.getState().tabStatuses.tab.shell, undefined, "Stop clears stale shell-running");
    send("SessionStart"); assert.equal(api.getState().tabNotifications.tab, "done", "SessionStart does not erase completion");
    send("UserPromptSubmit"); send("StopFailure"); assert.equal(api.getState().tabNotifications.tab, "failed");
    send("UserPromptSubmit"); send("Interrupt"); assert.equal(api.getState().tabNotifications.tab, "none");
  }
});

const taskPresentation = loadModule("../src/features/terminal/lib/terminalTaskPresentation.ts");
test("actual runtime plain PowerShell commands have no task; manual Pi hooks enter, turn, and trusted prompt exits", () => {
  const { api } = fixture({ sessions: [{ id: "manual", isAgentSession: false, shell: "pwsh", projectId: "p1" }] });
  const store = () => api.getState();
  const qualified = () => taskPresentation.isTaskQualifiedAgent(store().sessions[0], store().tabStatuses.manual);
  const task = () => taskPresentation.getAgentTaskNotification(store().sessions[0], store().tabStatuses.manual);
  store().handleShellRuntimeEvent({ sessionId: "manual", event: "command_started", origin: "osc" });
  assert.equal(qualified(), false); assert.equal(task(), "none");
  const hook = event => store().handleCliHookEvent({ tabId: "manual", source: "pi", sessionId: "pi-session", event });
  hook("SessionStart"); assert.equal(qualified(), true); assert.equal(task(), "none");
  hook("UserPromptSubmit"); assert.equal(task(), "running");
  hook("Stop"); assert.equal(task(), "done"); assert.equal(qualified(), true);
  store().handleShellRuntimeEvent({ sessionId: "manual", event: "command_started", origin: "osc" });
  assert.equal(task(), "done", "shell merged running does not override completed Agent turn");
  store().handleShellRuntimeEvent({ sessionId: "manual", event: "prompt_shown", origin: "input" });
  assert.equal(qualified(), true, "input guess cannot establish exit");
  store().handleShellRuntimeEvent({ sessionId: "manual", event: "prompt_shown", origin: "osc" });
  assert.equal(qualified(), false); assert.equal(task(), "none");
  hook("Stop"); assert.equal(qualified(), false, "late turn hook does not resurrect exited identity");
  hook("SessionStart"); assert.equal(qualified(), true); assert.equal(task(), "none");
});

test("explicit restored Agents qualify; legacy plain shells do not; other live Agent hooks remain compatible", () => {
  assert.equal(taskPresentation.isTaskQualifiedAgent({ id: "explicit", isAgentSession: true }), true);
  assert.equal(taskPresentation.isTaskQualifiedAgent({ id: "legacy", cliTool: "claude" }), true);
  assert.equal(taskPresentation.isTaskQualifiedAgent({ id: "ordinary", cliSessionId: "old" }, { shell: "running" }), false);
  assert.equal(taskPresentation.isTaskQualifiedAgent({ id: "plain", isAgentSession: false, cliTool: "pi" }), false);
  for (const source of ["claude", "kimi", "grok", "opencode", "codex"]) {
    const { api } = fixture({ sessions: [{ id: "tab", isAgentSession: false }] });
    api.getState().handleCliHookEvent({ tabId: "tab", source, sessionId: "live", event: "SessionStart" });
    api.getState().handleCliHookEvent({ tabId: "tab", source, sessionId: "live", event: "UserPromptSubmit" });
    assert.equal(taskPresentation.getAgentTaskNotification(api.getState().sessions[0], api.getState().tabStatuses.tab), "running");
  }
});
