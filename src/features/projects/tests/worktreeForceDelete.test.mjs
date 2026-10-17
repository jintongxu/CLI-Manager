import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const body = source.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(source))
    .join("\n");
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(body, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, ...dependencies },
  );
  return exports;
}

const req = {
  worktreeId: "worktree",
  projectPath: "C:/repo",
  worktreePath: "C:/repo-worktree",
  rootIdentity: "root",
  branch: "feature",
  baseBranch: "main",
};

function confirmation() {
  return {
    token: "token",
    confirmedPath: req.worktreePath,
    deleteBranch: true,
    branchOid: null,
    pathMissing: false,
    req,
    sessionIds: ["one", "two"],
  };
}

test("force-delete waits for every PTY close before deleting the worktree", async () => {
  const calls = [];
  const sessions = ["one", "two"];
  const { finalizeForceDelete } = load("../api/worktreeForceDelete.ts", {
    invoke: async (command) => {
      calls.push(["invoke", command]);
      if (command === "git_worktree_force_delete_validate") {
        return { ...confirmation(), req: undefined };
      }
      return { done: true, branchDeleted: true };
    },
  });

  await finalizeForceDelete(
    {
      currentRequest: () => req,
      sessionIds: () => [...sessions],
      closeSession: async (id) => {
        calls.push(["close", id]);
        sessions.splice(sessions.indexOf(id), 1);
      },
      releaseSessions: async () => calls.push(["release"]),
      deleteRecord: async () => calls.push(["delete-record"]),
      removeLocal: () => calls.push(["remove-local"]),
      refresh: async () => calls.push(["refresh"]),
      warn: () => {},
    },
    confirmation(),
    req.worktreePath,
  );

  assert.deepEqual(calls, [
    ["invoke", "git_worktree_force_delete_validate"],
    ["close", "one"],
    ["close", "two"],
    ["release"],
    ["invoke", "git_worktree_force_delete"],
    ["delete-record"],
    ["remove-local"],
    ["refresh"],
  ]);
});

test("force-delete wires backend PTY close into the destructive path", () => {
  const source = readFileSync(new URL("../api/worktreeStore.ts", import.meta.url), "utf8");
  assert.match(source, /forceDelete: async[\s\S]*?closeSession: id => useTerminalStore\.getState\(\)\.closeSession\(id, true\)/);
});

test("unregistered residual status exposes the explicit force-delete entry point", () => {
  const source = readFileSync(new URL("../api/WorktreeStatusDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /rawCode === 'worktree_not_registered'/);
  assert.match(source, /legacyResidual \|\| unregisteredResidual/);
});
