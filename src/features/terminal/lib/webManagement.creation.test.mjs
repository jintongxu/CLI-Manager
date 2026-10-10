import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("./webManagement.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness() {
  const calls = [];
  const project = { id: "p", name: "Project", path: "/repo", shell: "bash", environment_type: "local" };
  const worktree = { id: "w", project_id: "p", name: "Worktree", path: "/repo-w", status: "active" };
  const exports = {};
  const store = { loaded: true, projects: [project], groups: [], worktrees: [worktree], updateProject: async (...args) => calls.push(["rename", ...args]) };
  vm.runInNewContext(code, { exports, TextEncoder, require: (id) => {
    if (id.endsWith("webGitRead")) return { WEB_GIT_READ_KINDS: [] };
    if (id.endsWith("projectStore")) return { useProjectStore: { getState: () => store } };
    if (id.endsWith("worktreeStore")) return { useWorktreeStore: { getState: () => ({ worktrees: [worktree], checkDeps: async () => ({ needsInstall: true, command: "npm install" }), dismissDepsPrompt: async () => {} }) } };
    if (id.endsWith("worktreeDepsRunner")) return { useWorktreeDepsRunnerStore: { getState: () => ({ tasks: {}, start: async (...args) => { calls.push(["deps-start", ...args]); return { started: true }; } }) } };
    if (id.endsWith("i18n/index")) return { translateCurrent: (_, { name }) => `Install: ${name}` };
    if (id.endsWith("worktreeMetadata")) return { getWorktreeDisplayName: (value) => value.name };
    if (id === "../state") return { useTerminalStore: { getState: () => ({ activeSessionId: "s", createSession: async (...args) => { calls.push(["create", ...args]); return "new"; }, splitTerminal: async (...args) => { calls.push(["split", ...args]); return "new"; } }) } };
    if (id.endsWith("terminalProject")) return { projectWithWorktreeProviderOverrides: (value) => value };
    if (id.endsWith("projectStartupCommand")) return { resolveProjectStartupCommand: () => "codex" };
    if (id.endsWith("providerSwitching")) return { parseProjectEnvVars: () => ({ ENV: "yes" }) };
    if (id.endsWith("externalTerminal")) return { openWindowsTerminal: async (...args) => calls.push(["external", ...args]) };
    return {};
  } });
  return { calls, run: (payload, kind = "project.start") => exports.executeWebManagementOperation({ kind, payload }) };
}
test("web internal creation omits environment title while retaining launch intent", async () => {
  const { calls, run } = harness();
  await run({ targetType: "project", targetId: "p", launchMode: "internal" });
  assert.equal(calls[0][3], undefined);
  assert.equal(calls[0][4], "codex");
  assert.equal(calls[0][1], "p");
});
test("web worktree split omits title and preserves environment and startup", async () => {
  const { calls, run } = harness();
  await run({ targetType: "worktree", targetId: "w", launchMode: "split" });
  const options = calls[0][3];
  assert.equal(Object.hasOwn(options, "title"), false);
  assert.equal(options.cwd, "/repo-w");
  assert.equal(options.worktreeId, "w");
  assert.equal(options.startupCmd, "codex");
});
test("web dependency installation routes through the background runner", async () => {
  const { calls, run } = harness();
  const result = await run({ action: "worktree.installDeps", targetType: "worktree", targetId: "w" }, "project.action");
  assert.equal(result.started, true);
  assert.equal(calls[0][0], "deps-start");
  assert.equal(calls[0][2].id, "w");
  assert.equal(calls[0][4], "manual");
});
test("external launch titles are unchanged and project rename does not rename sessions", async () => {
  const { calls, run } = harness();
  await run({ targetType: "project", targetId: "p", launchMode: "external" });
  assert.equal(calls[0][1][0].title, "Project");
  await run({ action: "project.rename", targetType: "project", targetId: "p", name: "Renamed" }, "project.action");
  assert.deepEqual(calls.map((call) => call[0]), ["external", "rename"]);
});
