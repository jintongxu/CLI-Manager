import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const load = (path, require) => {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require });
  return exports;
};
const terminalProject = load("./terminalProject.ts", () => ({ getWorktreeDisplayName: (worktree) => worktree.name }));
const { resolveTerminalCreationContext: resolve, withoutTerminalTitle } = load("./terminalCreationContext.ts", (id) => {
  if (id === "./terminalProject") return terminalProject;
  if (id.endsWith("groupPath")) return { resolveProjectPath: (project) => project.remote_path || project.path };
  if (id.endsWith("providerSwitching")) return { parseProjectEnvVars: (project) => JSON.parse(project.env_vars || "{}") };
  throw new Error(id);
});
const project = { id: "p", path: "/repo", shell: "bash", env_vars: '{"PROJECT":"yes"}' };
const worktree = { id: "w", project_id: "p", path: "/repo-w", status: "active" };
const source = { id: "s", projectId: "p", worktreeId: "w", cwd: "/repo-w", title: "Custom", titleNaming: { kind: "custom" }, startupCmd: "codex resume old", cliSessionId: "old", shell: "zsh", envVars: { LOCAL: "yes" }, sshHostId: "host" };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("ordinary creation inherits environment, not title, naming or startup identity", () => {
  const context = resolve(source, [source], [project], [worktree], []);
  assert.deepEqual(plain(context), { projectId: "p", worktreeId: "w", cwd: "/repo-w", shell: "zsh", envVars: { LOCAL: "yes" }, sshHostId: "host" });
  assert.notEqual(context.envVars, source.envVars);
});
test("subagent and file-editor contexts resolve to valid environment only", () => {
  const child = { id: "c", kind: "subagent-transcript", title: "child", subagent: { parentSessionId: "s" } };
  assert.equal(resolve(child, [child, source], [project], [worktree], []).worktreeId, "w");
  const editor = { id: "e", kind: "file-editor", title: "file", fileEditor: { project, projectId: "p", projectPath: "/repo-w" } };
  assert.equal(resolve(editor, [editor], [project], [worktree], []).projectId, "p");
  assert.equal(resolve(editor, [editor], [project], [worktree], []).cwd, "/repo-w");
});
test("stale, inactive and foreign worktrees cannot be inherited", () => {
  assert.equal(resolve(source, [source], [project], [], []), null);
  assert.equal(resolve(source, [source], [project], [{ ...worktree, status: "missing" }], []), null);
  assert.equal(resolve(source, [source], [project], [{ ...worktree, project_id: "other" }], []), null);
});
test("unscoped and cyclic sources do not leak metadata", () => {
  assert.deepEqual(plain(resolve(null, [], [], [], [])), {});
  const cyclic = { id: "c", kind: "subagent-transcript", subagent: { parentSessionId: "c" } };
  assert.equal(resolve(cyclic, [cyclic], [], [], []), null);
  assert.deepEqual(plain(withoutTerminalTitle({ title: "project", projectId: "p", startupCmd: "codex" })), { projectId: "p", startupCmd: "codex" });
});

test("entrypoint title and startup-policy contracts remain explicit", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const tabs = read("../hooks/useTerminalTabsController.tsx");
  const duplicate = tabs.slice(tabs.indexOf("const handleDuplicateSession"), tabs.indexOf("const handleSaveSessionToSidebar"));
  assert.match(duplicate, /session\.cwd,\s*undefined,/);
  assert.match(duplicate, /normalizeDirectCodexStartupCommand\(session.startupCmd\)/);
  assert.match(duplicate, /session.sshHostId/);
  assert.match(tabs, /context\.projectId, context\.cwd, undefined, context\.startupCmd/);
  assert.match(tabs, /createAnonymousPiSessionHandler/);
  const sidebar = read("../../projects/hooks/useSidebarController.tsx");
  assert.doesNotMatch(sidebar, /renameOpenProjectTabs|renameSession/);
  assert.match(sidebar, /worktree\.path,\s*title,\s*startupCmd/);
  assert.match(sidebar, /t\("worktree.deps.installTitle"/);
  for (const file of ["../../workspace/api/CommandPalette.tsx", "../../workspace/api/useKeyboardShortcuts.ts"]) {
    const text = read(file);
    assert.doesNotMatch(text, /newTerminalTitle/);
    assert.match(text, /context\.projectId, context\.cwd, undefined, context\.startupCmd/);
  }
  const history = read("../../history/api/HistoryWorkspace.tsx");
  assert.match(history, /preflight.remoteCwd,\s*undefined,\s*preflight.resumeCommand/);
  assert.match(history, /cwd,\s*undefined,\s*command,/);
  const ssh = read("../../settings/components/pages/SshHostsSettingsPage.tsx");
  assert.match(ssh, /await createSession\(\s*undefined,\s*undefined,\s*undefined,\s*""/);
});

// Compile and execute the actual registered arrow callbacks, not a parallel
// reimplementation of their argument forwarding or a source-text assertion.
function callback(path, select, dependencies) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (select(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, path);
  const code = ts.transpileModule(`exports.callback = ${found.getText(tree)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...dependencies });
  return exports.callback;
}
function namedArrow(name) {
  return node => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
    && ts.isVariableDeclaration(node.parent.parent) && node.parent.parent.name.getText() === name;
}
function paletteAction(id) {
  return node => ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent)
    && node.parent.name.getText() === "action"
    && node.parent.parent.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText() === "id" && p.initializer.text === id);
}
const tabsPath = "../hooks/useTerminalTabsController.tsx";
const palettePath = "../../workspace/api/CommandPalette.tsx";
const shortcutsPath = "../../workspace/api/useKeyboardShortcuts.ts";

for (const intent of ["cli", "plain", "default", "unscoped"]) {
  test(`actual ordinary tab/palette/shortcut callbacks use ${intent} launch policy without source resume identity`, async () => {
    const current = intent === "unscoped" ? null : { ...source,
      ...(intent === "plain" ? { isAgentSession: false, startupCmd: "", cliSessionId: undefined } : {}),
      ...(intent === "default" ? { startupCmd: undefined } : {}),
    };
    const sessions = current ? [current] : [];
    const calls = [];
    const deps = {
      resolveTerminalCreationContext: resolve, sessions, projects: [project], worktrees: [worktree], groups: [],
      sourceSessionId: current?.id, activeSessionId: current?.id, activeSession: current,
      resolveNewTabSource: () => current, rejectMissingSessionWorktree: () => false,
      resolveProjectForSession: () => project, projectById: new Map([[project.id, project]]),
      useExternalTerminal: false, createSession: async (...args) => calls.push(args),
      closeHistory() {}, setActiveWorkspaceTab() {},
      useProjectStore: { getState: () => ({ projects: [project], groups: [] }) },
      useWorktreeStore: { getState: () => ({ worktrees: [worktree] }) },
      useTerminalStore: { getState: () => ({ sessions, activeSessionId: current?.id, createSession: async (...args) => calls.push(args) }) },
      terminalState: { sessions },
    };
    await callback(tabsPath, namedArrow("handleNewTab"), deps)(current?.id);
    callback(palettePath, paletteAction("action:new-terminal"), deps)();
    const keyboardDeps = { ...deps, shortcutsRef: { current: { newTerminal: "new" } }, viewModeRef: { current: "full" },
      eventToCombo: () => "new", isShortcutMatch: (a, b) => a === b,
      useHistoryStore: { getState: () => ({ isOpen: false }) },
    };
    // The handler obtains terminal state at dispatch time; keep all early exits false.
    const handler = callback(shortcutsPath, node => ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent)
      && node.parent.name.getText() === "handler", keyboardDeps);
    handler({ target: null, preventDefault() {} });
    assert.equal(calls.length, 3);
    for (const args of calls) {
      assert.equal(args[2], undefined, "never inherit title");
      assert.equal(args[3], intent === "plain" ? "" : undefined, "project/default policy, never resume old");
      assert.equal(args[9], undefined, "never inherit CLI conversation ID");
      assert.equal(args[7], current ? "w" : undefined);
      assert.equal(args[8], current ? "host" : undefined);
    }
  });
}

test("actual empty-split tab and palette callbacks explicitly override project CLI startup", () => {
  const calls = [];
  const deps = { resolveTerminalCreationContext: resolve, sessions: [source], projects: [project], worktrees: [worktree], groups: [],
    resolveNewTabSource: () => source, splitPicker: { sessionId: "s", direction: "vertical" },
    splitTerminal: (...args) => calls.push(args), handleCloseSplitPicker() {}, closeHistory() {}, setActiveWorkspaceTab() {},
    activeSession: source, activeSessionId: "s", useTerminalStore: { getState: () => ({ sessions: [source] }) },
    useProjectStore: { getState: () => ({ projects: [project], groups: [] }) },
    useWorktreeStore: { getState: () => ({ worktrees: [worktree] }) },
  };
  callback(tabsPath, namedArrow("handleSplitEmpty"), deps)();
  for (const id of ["action:split-right", "action:split-down"]) callback(palettePath, paletteAction(id), deps)();
  assert.equal(calls.length, 3);
  for (const [, , options] of calls) {
    assert.equal(options.startupCmd, "");
    assert.equal(options.title, undefined);
    assert.equal(options.worktreeId, "w");
    assert.equal(options.cliSessionId, undefined);
  }
});
