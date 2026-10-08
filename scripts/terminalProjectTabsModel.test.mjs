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
compile("../src/features/projects/api/worktreeLabels.ts", "worktreeLabels.mjs");
compile("../src/features/terminal/api/terminalProject.ts", "terminalProject.mjs", (code) =>
  code.replace('"../../projects/api/worktreeMetadata"', '"./worktreeMetadata.mjs"'));
compile("../src/features/terminal/api/terminalProjectTabsModel.ts", "projectTabs.mjs", (code) =>
  code.replace('"./terminalProject"', '"./terminalProject.mjs"')
    .replace('"../../projects/api/worktreeLabels"', '"./worktreeLabels.mjs"'));
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
  resolveProjectWorkspanTarget, groupProjectWorkspanModels, describeWorkspanTabGroup, formatWorkspanGroupTitle } = await import(pathToFileURL(join(temp, "projectTabs.mjs")));
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
  assert.equal(members[1].worktreeName, "absent");
  assert.equal(members[2].worktreeName, "gone");
  assert.equal(members[2].worktreePath, "C:/gone");
  assert.equal(members[0].worktreePath, "C:/repo");
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


test("display contexts are scope-bounded, unique and stable under member order; full localized names retain missing IDs", () => {
  const sessions = [session("a", "p", { worktreeId: "wt" }), session("repeat", "p", { worktreeId: "wt" }),
    session("missing", "p", { worktreeId: "absent" }), session("q", "q")];
  const result = models([layout("mx", sessions.map(s => s.id), "q", ["a"])], sessions)[0];
  const before = JSON.stringify(result);
  const descriptor = describeWorkspanTabGroup([...result.members, result.members[0]]);
  assert.equal(descriptor.contexts.length, 3);
  assert.deepEqual(describeWorkspanTabGroup([...result.members].reverse()), descriptor);
  assert.equal(descriptor.kind, "mixed-project");
  for (const locale of [{ root: "主目录", missing: "Worktree 已丢失", cross: "跨 Worktree", mixed: "混合项目" },
    { root: "Main directory", missing: "Worktree missing", cross: "Cross Worktree", mixed: "Mixed projects" }]) {
    const title = formatWorkspanGroupTitle(descriptor, descriptor.contexts, locale, true);
    assert.ok(title.includes("Task"));
    assert.ok(title.includes(`${locale.missing} · absent`));
    assert.ok(title.includes(locale.root));
    assert.ok(title.includes('Same name · p'));
    assert.ok(title.includes('Same name · q'));
  }
  const scoped = models([layout("scoped", ["a"], "q", ["a"])], sessions)[0];
  assert.equal(describeWorkspanTabGroup(scoped.members).contexts.length, 1);
  assert.equal(JSON.stringify(result), before);
});

const headerLabels = { root: "Main", missing: "Missing", cross: "Cross", mixed: "Mixed" };
const headerContext = (id, name, projectKey = "p", project = "P", worktreeKind = "worktree") => ({
  projectKey, project, worktreeKind, worktreeId: worktreeKind === "root" ? null : id, worktreeName: name,
});
const headerGroup = contexts => describeWorkspanTabGroup(contexts);
const headerTitle = (contexts, universe, showProject = false) =>
  formatWorkspanGroupTitle(headerGroup(contexts), universe, headerLabels, showProject);
function assertUniqueHeaders(groups, universe, showProject = false) {
  const before = JSON.stringify(universe);
  const titles = groups.map(group => headerTitle(group, universe, showProject));
  assert.equal(new Set(titles.map(title => title.toLowerCase())).size, groups.length, titles.join("\n---\n"));
  groups.forEach((group, index) => {
    assert.equal(headerTitle([...group].reverse(), [...universe].reverse(), showProject), titles[index]);
    group.forEach(context => {
      if (context.worktreeKind === "worktree") assert.ok(titles[index].includes(context.worktreeName));
    });
    assert.ok(!titles[index].includes("…"));
  });
  assert.equal(JSON.stringify(universe), before);
  return titles;
}

test("RV-LAYOUT-001: actual header formatter reserves generated/literal fallback labels across the unfiltered universe", () => {
  const a = headerContext("a", "foo"), b = headerContext("b", "foo"), c = headerContext("c", "foo · a");
  const fallback = 'foo · a · ["p","worktree","a"]';
  const blocker = headerContext("d", fallback), ordinal = headerContext("e", `${fallback} · 2`);
  const universe = [a, b, c, blocker, ordinal, { ...a }];
  const titles = assertUniqueHeaders([a, b, c, blocker, ordinal].map(context => [context]), universe);
  assert.equal(titles[0], `${fallback} · 3`);
  assert.equal(titles[1], "foo · b");
  assert.equal(headerTitle([a], universe), titles[0]); // filtered/overflow subset retains full-universe label
  assertUniqueHeaders([[a, b], [a, c], [b, c]], universe);
});

test("headers retain full root/missing/project names and resolve composed project separator collisions", () => {
  const universe = [headerContext(null, null, "p", "Same", "root"),
    headerContext("root-literal", "Main", "p", "Same"),
    headerContext("gone", null, "p", "Same", "missing-worktree"),
    headerContext("literal-missing", "Missing · gone", "p", "Same"),
    headerContext("long-a", "complete-name-".repeat(30), "p", "Same"),
    headerContext("long-b", "complete-name-".repeat(30), "p", "Same"),
    headerContext(null, null, "q", "Same", "root"),
    headerContext(null, null, "r", "Same · p", "root"),
    headerContext("separator", "B / C", "s", "A"),
    headerContext("separator", "C", "t", "A / B")];
  assertUniqueHeaders(universe.map(context => [context]), universe, true);
  assertUniqueHeaders(universe.map(context => [context]), universe);
  assertUniqueHeaders([[universe[0], universe[6]], [universe[1], universe[6]],
    [universe[0], universe[1]]], universe);
});

test("entire cross/mixed headers cannot alias multiline literal names or group identity fallback literals", () => {
  const a = headerContext("a", "A"), b = headerContext("b", "B"), q = headerContext("q", "Q", "q", "Other");
  const crossLiteral = headerContext("literal", "Cross\nA\nB");
  const crossIdentity = JSON.stringify(headerGroup([a, b]).contexts.map(context =>
    JSON.stringify([context.projectKey, context.worktreeKind, context.worktreeId])));
  const blocker = headerContext("blocker", `${crossLiteral.worktreeName}\n · ${crossIdentity}`);
  const mixedLiteral = headerContext("mixed-literal", "Mixed\nP / A\nOther / Q");
  const universe = [a, b, q, crossLiteral, blocker, mixedLiteral];
  const titles = assertUniqueHeaders([[a, b], [a, q], [crossLiteral], [blocker], [mixedLiteral]], universe);
  assert.equal(titles[0], `${blocker.worktreeName} · 2`);
  assertUniqueHeaders([[a, b], [a, q], [crossLiteral], [blocker], [mixedLiteral]], universe, true);
});
