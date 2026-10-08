import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "persistent-badges-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
for (const [folder, name] of [["projects", "worktreeMetadata"], ["projects", "worktreeLabels"],
  ["terminal", "terminalProject"], ["terminal", "terminalProjectTabsModel"],
  ["terminal", "terminalProjectSelection"], ["terminal", "terminalWorktreeBadge"]]) {
  const source = readFileSync(new URL(`../src/features/${folder}/api/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(temp, `${name}.mjs`), code.replace(/from "[^"]*\/([^/"]+)"/g, 'from "./$1.mjs"'));
}
const { resolveTerminalProjectMembership, buildWorkspanProjectMemberships, getTerminalProjectKey } = await import(pathToFileURL(join(temp, "terminalProjectTabsModel.mjs")));
const { buildWorktreeBadges, buildGlobalWorktreeBadges } = await import(pathToFileURL(join(temp, "terminalWorktreeBadge.mjs")));
const { selectProjectTabGroups } = await import(pathToFileURL(join(temp, "terminalProjectSelection.mjs")));
const labels = { root: "主目录", missing: "已丢失", cross: "跨树", mixed: "混合项目" };
const projects = new Map(["p", "q"].map(id => [id, { id, name: "Same", path: `/${id}` }]));
const trees = [
  { id: "a", project_id: "p", status: "active", name: "long-name-task-99", display_name: "Long display 123", path: "/a", label_ordinal: 7, short_label: "" },
  { id: "b", project_id: "p", status: "active", name: "long-name-task-100", path: "/b", label_ordinal: 22, short_label: "审查" },
  { id: "gone", project_id: "p", status: "missing", name: "gone-task", display_name: "Retained full name", branch: "feature/gone", path: "/gone", label_ordinal: 40, short_label: "" },
  { id: "alias-gone", project_id: "p", status: "missing", path: "/alias-gone", label_ordinal: 41, short_label: "保留" },
];
function member(id, worktreeId, projectId = "p", records = trees) {
  const session = { id, projectId, worktreeId, environmentType: "local" };
  return resolveTerminalProjectMembership(session, [session], projects, records, { unboundProject: "Unbound", missingWorktree: labels.missing });
}
function model(id, members) {
  return { workspan: { id, activeSessionId: members[0].sessionId }, members,
    projectMemberships: buildWorkspanProjectMemberships(members, members[0].sessionId),
    sessionIds: members.map(m => m.sessionId), closeSessionIds: [members[0].sessionId] };
}
test("persistent tokens survive display changes/order and distinguish retained missing records from absent IDs", () => {
  assert.equal(member("a", "a").worktreeLabel, "W7");
  assert.equal(member("b", "b").worktreeLabel, "审查");
  assert.equal(member("gone", "gone").worktreeLabel, "W40");
  assert.equal(member("gone", "gone").worktreeName, "Retained full name");
  assert.equal(member("gone", "gone").worktreePath, "/gone");
  assert.equal(member("gone", "gone").branch, "feature/gone");
  assert.equal(member("absent", "absent").worktreeName, "absent");
  assert.equal(member("root").worktreePath, "/p");
  assert.equal(member("gone-alias", "alias-gone").worktreeLabel, "保留");
  assert.equal(member("absent", "absent").worktreeLabel, "absent");
  assert.equal(member("wrong", "a", "q").worktreeLabel, "a");
  assert.equal(member("root").worktreeLabel, "");
  assert.equal(member("a", "a", "p", [...trees].reverse().map(t => ({ ...t, name: "changed", display_name: "changed" }))).worktreeLabel, "W7");
  const rows = [model("gone", [member("gone", "gone")]), model("alias", [member("alias", "alias-gone")]), model("absent", [member("absent", "absent")])];
  const badges = buildWorktreeBadges(rows, getTerminalProjectKey("p"), labels);
  assert.equal(badges.get("gone").label, `${labels.missing} · W40`);
  assert.equal(badges.get("alias").label, `${labels.missing} · 保留`);
  assert.equal(badges.get("absent").label, `${labels.missing} · absent`);
});
test("badges expose every deduplicated scoped context with project IDs for same-name projects", () => {
  const a = member("a", "a"), b = member("b", "b"), root = member("root", undefined, "q");
  const mixed = model("mixed", [a, b, root, a]);
  const before = JSON.stringify(mixed);
  const badges = buildWorktreeBadges([mixed], getTerminalProjectKey("p"), labels);
  assert.equal(badges.get("mixed").label.split(" + ").length, 3);
  for (const context of ["Same · p / W7", "Same · p / 审查", `Same · q / ${labels.root}`]) assert.ok(badges.get("mixed").label.includes(context));
  assert.equal(JSON.stringify(mixed), before);
  const scoped = model("scoped", [a]);
  assert.equal(buildWorktreeBadges([scoped], getTerminalProjectKey("p"), labels).get("scoped").label, "W7");
  assert.equal(buildGlobalWorktreeBadges([scoped], labels).get("scoped").label, "Same / W7");
  const alias = model("scoped", [{ ...a, worktreeLabel: "新别名" }]);
  assert.equal(buildGlobalWorktreeBadges([scoped], labels).get("scoped").identity, buildGlobalWorktreeBadges([alias], labels).get("scoped").identity);
});
test("global status selection retains A-B-A order, unique workspans, visible activation and close scope", () => {
  const a = model("a", [member("a", "a")]), b = model("b", [member("b", "b")]), c = model("c", [member("c", "a")]);
  const groups = selectProjectTabGroups([a, b, c, a], null, "running", { a: "running", b: "running", c: "running" });
  const result = groups.flatMap(g => g.models);
  assert.deepEqual(result.map(m => m.workspan.id), ["a", "b", "c"]);
  assert.equal(groups.length, 3);
  result.forEach((m, i) => { assert.strictEqual(m, [a, b, c][i]); assert.strictEqual(m.closeSessionIds, [a, b, c][i].closeSessionIds); });
});
