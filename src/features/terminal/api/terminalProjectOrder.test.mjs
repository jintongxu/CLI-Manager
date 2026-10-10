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
const pane = load("../api/terminalPaneTree.ts", () => ({}));
const workspan = load("../api/terminalWorkspan.ts", (id) => {
  if (id.endsWith("terminalPaneTree")) return pane;
  throw new Error(id);
});
const tabs = load("../api/terminalProjectTabsModel.ts", (id) => {
  if (id.endsWith("worktreeLabels")) return { getWorktreeShortLabel: () => "" };
  if (id.endsWith("terminalProject")) return { findWorktreeForSession: () => null, resolveProjectForSession: () => null };
  throw new Error(id);
});

const member = (sessionId, projectKey) => ({
  sessionId, projectKey, projectId: projectKey, project: projectKey,
  worktreeId: null, worktreeKind: "root", worktreeLabel: "", worktreeName: null,
  worktreePath: null, branch: null, environmentType: "local", sshHostId: undefined,
});
const model = (id, ...projectKeys) => ({
  workspan: { id }, members: projectKeys.map((key, index) => member(`${id}-s${index}`, key)),
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (models) => models.map((m) => m.workspan.id);
const wids = (workspans) => workspans.map((w) => w.id);

test("project move relocates the whole project block, members keep order", () => {
  const models = [model("w1", "a"), model("w2", "b"), model("w3", "a"), model("w4", "b"), model("w5", "c")];
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "a", "c")), ["w2", "w4", "w5", "w1", "w3"]);
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "c", "a")), ["w5", "w1", "w3", "w2", "w4"]);
});

test("mixed-project workspan travels with its primary (first-member) project", () => {
  const models = [model("w1", "a"), model("w2", "b", "a"), model("w3", "a")];
  assert.equal(tabs.resolveWorkspanPrimaryProjectKey(models[1]), "b");
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "a", "b")), ["w2", "w1", "w3"]);
});

test("same/unknown project keys are no-ops", () => {
  const models = [model("w1", "a"), model("w2", "b")];
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "a", "a")), ["w1", "w2"]);
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "a", "zzz")), ["w1", "w2"]);
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "zzz", "b")), ["w1", "w2"]);
});

test("memberless workspans form a stable block and never break ordering", () => {
  const models = [model("w1", "a"), { workspan: { id: "w0" }, members: [] }, model("w2", "b")];
  assert.equal(tabs.resolveWorkspanPrimaryProjectKey(models[1]), null);
  assert.deepEqual(plain(tabs.resolveWorkspanIdOrderByProjectMove(models, "a", "b")), ["w0", "w2", "w1"]);
});

test("orderTerminalWorkspans applies explicit id order and keeps unknown tails", () => {
  const workspans = [{ id: "w1" }, { id: "w2" }, { id: "w3" }];
  assert.deepEqual(plain(wids(workspan.orderTerminalWorkspans(workspans, ["w3", "w1"]))), ["w3", "w1", "w2"]);
  assert.deepEqual(plain(wids(workspan.orderTerminalWorkspans(workspans, ["w9", "w2", "w2"]))), ["w2", "w1", "w3"]);
  const same = workspan.orderTerminalWorkspans(workspans, ["w1", "w2", "w3"]);
  assert.equal(same, workspans);
});
