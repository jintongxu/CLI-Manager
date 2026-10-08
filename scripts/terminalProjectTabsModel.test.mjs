import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "project-tabs-model-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
function compile(path, name, transform = (code) => code) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(temp, name), transform(code));
}
compile("../src/features/projects/api/worktreeMetadata.ts", "worktreeMetadata.mjs");
compile("../src/features/terminal/api/terminalProject.ts", "terminalProject.mjs", (code) =>
  code.replace('"../../projects/api/worktreeMetadata"', '"./worktreeMetadata.mjs"'));
compile("../src/features/terminal/api/terminalProjectTabsModel.ts", "projectTabs.mjs", (code) =>
  code.replace('"./terminalProject"', '"./terminalProject.mjs"'));
// Isolate the pure functions from existing UI/store dependencies, not their logic.
compile("../src/features/terminal/lib/terminalTabsModel.ts", "tabs.mjs", (code) =>
  'import { getCompactWorktreeLabel, getWorktreeDisplayName } from "./worktreeMetadata.mjs";\n'
  + 'const inferVendor = () => null; const resolveCliToolIconKey = () => null;\n'
  + code.replace(/import[\s\S]*?from "[^"]+";\n/g, "")
    .replace('"../api/terminalProjectTabsModel"', '"./projectTabs.mjs"')
    .replace('"../../projects/api/worktreeMetadata"', '"./worktreeMetadata.mjs"'));
compile("../src/features/terminal/lib/workspanTabModel.ts", "workspan.mjs", (code) =>
  code.replace('"./terminalTabsModel"', '"./tabs.mjs"')
    .replace('import { inferVendor } from "../../../shared/ui/VendorIcon";', 'const inferVendor = () => null;')
    .replace('"../api/terminalProjectTabsModel"', '"./projectTabs.mjs"'));
const { buildTerminalProjectOptions, getTerminalProjectKey, resolveTerminalProjectMembership,
  resolveProjectWorkspanTarget, groupProjectWorkspanModels } = await import(pathToFileURL(join(temp, "projectTabs.mjs")));
const { buildWorkspanTabModels } = await import(pathToFileURL(join(temp, "workspan.mjs")));
const { buildTerminalContextOptions, getTerminalTabScopeKey } = await import(pathToFileURL(join(temp, "tabs.mjs")));
const labels = { unboundProject: "Unbound", missingWorktree: "Missing", defaultShell: "Shell" };
const projects = new Map([
  ["p", { id: "p", name: "Same name", path: "C:/repo", environment_type: "local" }],
  ["q", { id: "q", name: "Same name", path: "C:/other", environment_type: "local" }],
  ["remote", { id: "remote", name: "Remote", path: "", remote_path: "/repo", environment_type: "ssh" }],
]);
const worktrees = [
  { id: "wt", project_id: "p", status: "active", name: "task", display_name: "Task", path: "C:/wt", branch: "task" },
  { id: "gone", project_id: "p", status: "missing", name: "gone", path: "C:/gone" },
];
const session = (id, projectId = "p", extra = {}) => ({ id, projectId, title: id, environmentType: "local", ...extra });
function layout(id, sessionIds, activeSessionId = sessionIds[0], closeSessionIds = sessionIds) {
  return { workspan: { id, activeSessionId, paneTree: { type: "leaf", id: `${id}-pane`, sessionIds, activeSessionId } }, sessionIds, closeSessionIds };
}
function models(layouts, sessions) {
  return buildWorkspanTabModels(layouts, sessions, projects, {}, (key) => key, worktrees, labels);
}

test("project ID grouping merges root, worktrees, WSL and SSH; counts notifications once per session", () => {
  const sessions = [session("root"), session("wt", "p", { worktreeId: "wt", environmentType: "wsl" }),
    session("ssh", "p", { environmentType: "ssh", sshHostId: "host" }), session("other", "q"), session("unbound", undefined)];
  sessions[4].projectId = undefined;
  const options = buildTerminalProjectOptions([{ sessionIds: sessions.map((s) => s.id) }, { sessionIds: ["wt", "root", "unknown"] }],
    sessions, projects, worktrees, labels, { root: "running", wt: "done", ssh: "failed", other: "attention" });
  assert.equal(options.length, 3);
  assert.deepEqual(options[0].sessionIds, ["root", "wt", "ssh"]);
  assert.deepEqual([options[0].count, options[0].running, options[0].done, options[0].failed], [3, 1, 1, 1]);
  assert.notEqual(options[0].key, options[1].key);
  assert.equal(options[1].attention, 1);
  assert.equal(options[2].key, "unbound");
  assert.equal(options[0].members[2].sshHostId, "host");
  assert.deepEqual(buildTerminalProjectOptions([], sessions, projects, worktrees, labels), []);
});

test("root differs from absent, inactive and wrong-project worktree metadata", () => {
  const sessions = [session("root"), session("absent", "p", { worktreeId: "absent" }),
    session("gone", "p", { worktreeId: "gone" }), session("wrong", "q", { worktreeId: "wt" })];
  const members = sessions.map((s) => resolveTerminalProjectMembership(s, sessions, projects, worktrees, labels));
  assert.deepEqual(members.map((m) => m.worktreeKind), ["root", "missing-worktree", "missing-worktree", "missing-worktree"]);
  assert.equal(members[1].worktreeName, "Missing");
  assert.notEqual(models([layout("root", ["root"]), layout("absent", ["absent"])], sessions)[0].projectMemberships[0].group.key,
    models([layout("absent", ["absent"])], sessions)[0].projectMemberships[0].group.key);
});

test("pseudo sessions reuse terminalProject parent/editor/path identity without mutating sessions", () => {
  const sessions = [session("parent", "p", { worktreeId: "wt" }),
    session("child", undefined, { kind: "subagent-transcript", subagent: { parentSessionId: "parent" } }),
    session("editor", undefined, { kind: "file-editor", fileEditor: { projectId: "q", projectPath: "C:/other" } }),
    session("history", undefined, { kind: "synced-history", cwd: "C:/repo/subdir" })];
  for (const s of sessions.slice(1)) s.projectId = undefined;
  const before = structuredClone(sessions);
  const members = sessions.map((s) => resolveTerminalProjectMembership(s, sessions, projects, worktrees, labels));
  assert.deepEqual(members.map((m) => m.projectId), ["p", "p", "q", "p"]);
  assert.equal(members[1].worktreeId, "wt");
  assert.equal(members[1].worktreeKind, "worktree");
  assert.deepEqual(sessions, before);
  const cyclic = [session("a", undefined, { kind: "subagent-transcript", subagent: { parentSessionId: "b" } }),
    session("b", undefined, { kind: "subagent-transcript", subagent: { parentSessionId: "a" } })];
  assert.doesNotThrow(() => resolveTerminalProjectMembership(cyclic[0], cyclic, projects, worktrees, labels));
});

test("all split members have explicit project activation targets and cross/mixed groups", () => {
  const sessions = [session("a"), session("b", "p", { worktreeId: "wt" }), session("c", "q")];
  const layouts = [layout("cross", ["a", "b"], "b"), layout("mixed", ["a", "c"], "c", ["a"])];
  const result = models(layouts, sessions);
  assert.equal(result[0].projectMemberships[0].group.kind, "cross-worktree");
  assert.equal(result[0].projectMemberships[0].activationSessionId, "b");
  const sameWorktree = models([layout("same", ["b", "d"])], [...sessions, session("d", "p", { worktreeId: "wt" })]);
  assert.equal(sameWorktree[0].projectMemberships[0].group.kind, "worktree");
  assert.equal(sameWorktree[0].projectMemberships[0].group.worktreeName, "Task");
  assert.equal(result[1].mixedProject, true);
  assert.deepEqual(result[1].projectMemberships.map((m) => [m.group.kind, m.activationSessionId]), [["mixed-project", "a"], ["mixed-project", "c"]]);
  assert.strictEqual(result[1].workspan, layouts[1].workspan);
  assert.strictEqual(result[1].sessionIds, layouts[1].sessionIds);
  assert.strictEqual(result[1].closeSessionIds, layouts[1].closeSessionIds);
  assert.equal(result[1].contextKey, null); // compatibility, UI lane must use projectMemberships
  assert.equal(groupProjectWorkspanModels(result, getTerminalProjectKey("p")).flatMap((g) => g.models).length, 2);
  assert.equal(groupProjectWorkspanModels(result, getTerminalProjectKey("q")).flatMap((g) => g.models).length, 1);
});

test("stable first-appearance groups and validated recent targets respect scoped layouts", () => {
  const sessions = [session("a"), session("b", "p", { worktreeId: "wt" }), session("c")];
  const result = models([layout("b", ["b"]), layout("a", ["a"]), layout("c", ["c"])], sessions);
  const key = getTerminalProjectKey("p");
  assert.deepEqual(groupProjectWorkspanModels(result, key).map((g) => [g.group.kind, g.models.map((m) => m.workspan.id)]),
    [["worktree", ["b"]], ["root", ["a", "c"]]]);
  assert.deepEqual(resolveProjectWorkspanTarget(result, key, { workspanId: "c", sessionId: "c" }), { workspanId: "c", sessionId: "c" });
  assert.deepEqual(resolveProjectWorkspanTarget(result, key, { workspanId: "c", sessionId: "closed" }), { workspanId: "b", sessionId: "b" });
  assert.equal(resolveProjectWorkspanTarget(result, getTerminalProjectKey("q")), null);
  const scoped = models([layout("scoped", ["a"], "b", ["a"])], sessions);
  assert.deepEqual(scoped[0].projectMemberships[0].sessionIds, ["a"]);
  assert.equal(scoped[0].projectMemberships[0].activationSessionId, "a");
  assert.deepEqual(scoped[0].closeSessionIds, ["a"]);
});

test("legacy scope keys remain unchanged and legacy context notifications are deduplicated", () => {
  const s = session("a", "p", { worktreeId: "wt", environmentType: "ssh", sshHostId: "host" });
  assert.equal(getTerminalTabScopeKey(s), "p:wt:ssh:host");
  const options = buildTerminalContextOptions([{ sessionIds: ["a", "a"] }, { sessionIds: ["a"] }], [s], projects, worktrees, labels, { a: "done" });
  assert.equal(options[0].count, 1);
  assert.equal(options[0].done, 1);
  const legacy = buildWorkspanTabModels([layout("single", ["a"])], [s], projects, {}, (key) => key);
  assert.equal(legacy[0].contextKey, "p:wt:ssh:host");
  assert.strictEqual(legacy[0].singleSession, s);
});
