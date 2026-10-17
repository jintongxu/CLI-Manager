import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load() {
  const source = readFileSync(new URL("../api/worktreeCreationRecovery.ts", import.meta.url), "utf8");
  const body = ts.createSourceFile("worktreeCreationRecovery.ts", source, ts.ScriptTarget.Latest, true)
    .statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText()).join("\n");
  const exports = {};
  const values = new Map();
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  return exports;
}

test("creation markers retain exact targets until the database row is confirmed", () => {
  const recovery = load();
  recovery.beginWorktreeCreationMarker({ recordId: "r", projectPath: "repo", taskName: "task" });
  recovery.updateWorktreeCreationMarker("r", {
    worktreePath: "repo-wt/task",
    branch: "wt/task",
    rootIdentity: "identity",
  });
  assert.equal(recovery.reconcileWorktreeCreationMarkers([]).length, 1);
  recovery.completeWorktreeCreationMarker("r");
  assert.equal(recovery.reconcileWorktreeCreationMarkers([]).length, 0);
});

test("reconciliation clears markers only for records already persisted", () => {
  const recovery = load();
  recovery.beginWorktreeCreationMarker({ recordId: "persisted", projectPath: "repo", taskName: "task" });
  recovery.beginWorktreeCreationMarker({ recordId: "orphan", projectPath: "repo", taskName: "other" });
  const remaining = recovery.reconcileWorktreeCreationMarkers([{ id: "persisted" }]);
  assert.equal(remaining.map((marker) => marker.recordId).join(","), "orphan");
});
