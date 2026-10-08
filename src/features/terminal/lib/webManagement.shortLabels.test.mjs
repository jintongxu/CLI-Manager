import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function load(source, require = () => ({})) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, TextEncoder });
  return exports;
}
const labels = load(read("../../projects/api/worktreeLabels.ts"));
function harness(worktrees = []) {
  const calls = [];
  const project = { id: "p", path: "/repo", environment_type: "local" };
  const api = load(read("./webManagement.ts"), (id) => {
    if (id.endsWith("worktreeLabels")) return labels;
    if (id.endsWith("webGitRead")) return { WEB_GIT_READ_KINDS: [] };
    if (id.endsWith("projectStore")) return { useProjectStore: { getState: () => ({ loaded: true, projects: [project], worktrees }) } };
    if (id.endsWith("worktreeStore")) return { useWorktreeStore: { getState: () => ({ loaded: true, createWorktreeForProject: async (_, input) => {
      calls.push(input);
      return { id: "new", name: "internal", display_name: input.displayName, short_label: input.shortLabel ?? "", label_ordinal: 7 };
    } }) } };
    if (id.endsWith("worktreeMetadata")) return { getWorktreeDisplayName: (w) => w.display_name || w.name };
    if (id.endsWith("webDevice")) return { webDeviceApi: { validateContext: async () => {} } };
    return {};
  });
  return { calls, api, create: (extra = {}) => api.executeWebManagementOperation({ kind: "worktree.create", payload: { projectId: "p", displayName: "Task", confirmed: true, ...extra } }) };
}

test("Web create normalizes and forwards optional shortLabel without changing legacy metadata", async () => {
  const { create, calls } = harness();
  const result = await create({ shortLabel: " e\u0301 " });
  assert.equal(calls[0].shortLabel, "é");
  assert.equal(result.shortLabel, "é");
  assert.equal(result.labelOrdinal, 7);
  await create();
  assert.equal(Object.hasOwn(calls[1], "shortLabel"), false);
  await create({ shortLabel: "   " });
  assert.equal(calls[2].shortLabel, "");
  await create({ shortLabel: "😀".repeat(12) });
});

test("Web validation rejects reserved, oversized, control/bidi and non-string labels before creation", async () => {
  const { create, calls, api } = harness();
  for (const shortLabel of ["W1", "w12", "a".repeat(13), "\tname", "name\n", "a\u202eb", "a\u2069b", null, 12, {}]) {
    await assert.rejects(create({ shortLabel }), (error) => error.code === "invalid_operation_payload");
  }
  assert.equal(calls.length, 0);
  await assert.rejects(create({ confirmed: false }), (error) => error.code === "operation_confirmation_required");
  assert.equal(api.isWebManagementOperation("worktree.rename"), false);
  assert.equal(api.isWebManagementOperation("worktree.update"), false);
});

test("Web list roundtrip preserves persistent metadata and omits absent legacy metadata without index labels", async () => {
  const { api } = harness([
    { id: "old", project_id: "p", name: "legacy" },
    { id: "new", project_id: "p", name: "internal", short_label: "Fix", label_ordinal: 42 },
  ]);
  const result = JSON.parse(JSON.stringify(await api.executeWebManagementOperation({ kind: "worktree.list", payload: { projectId: "p" } })));
  assert.equal(Object.hasOwn(result[0], "shortLabel"), false);
  assert.equal(Object.hasOwn(result[0], "labelOrdinal"), false);
  assert.equal(result[0].displayName, "legacy");
  assert.equal(result[1].shortLabel, "Fix");
  assert.equal(result[1].labelOrdinal, 42);
});

test("desktop workspace snapshot mapping preserves metadata and leaves old frames unlabeled", () => {
  const source = read("../hooks/useWebDeviceBridge.ts");
  const mapping = source.slice(source.indexOf("worktrees: worktrees.map("), source.indexOf("      updatedAt: Date.now()"));
  const map = new Function("worktrees", "getWorktreeDisplayName", `return ({${mapping}}).worktrees`);
  const mapped = JSON.parse(JSON.stringify(map([
    { id: "new", name: "internal", short_label: "", label_ordinal: 8 },
    { id: "old", name: "legacy" },
  ], (w) => w.name)));
  assert.equal(mapped[0].shortLabel, "");
  assert.equal(mapped[0].labelOrdinal, 8);
  assert.equal(Object.hasOwn(mapped[1], "shortLabel"), false);
  assert.equal(Object.hasOwn(mapped[1], "labelOrdinal"), false);
});
