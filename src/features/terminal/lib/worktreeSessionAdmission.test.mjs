import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./worktreeSessionAdmission.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { createWorktreeSessionAdmission } = exports;
const worktree = (id = "w") => ({ id, projectId: "p", worktreeId: id, kind: "pty", transientBackground: false });

test("ordinary Worktree admission reuses an existing session and gates concurrent first creation", async () => {
  const admission = createWorktreeSessionAdmission();
  const first = admission.begin("w", []);
  assert.ok(first.token);
  const second = admission.begin("w", []);
  assert.equal(second.promise, first.promise);
  admission.resolve("w", first.token, "session-1");
  assert.equal(await second.promise, "session-1");
  admission.finish("w", first.token);
  assert.equal(admission.begin("w", [worktree()]).existingId, "w");
});

test("failed creation releases admission for a later retry", async () => {
  const admission = createWorktreeSessionAdmission();
  const first = admission.begin("w", []);
  const error = new Error("launch failed");
  admission.reject("w", first.token, error);
  admission.finish("w", first.token);
  await assert.rejects(first.promise, /launch failed/);
  assert.ok(admission.begin("w", []).token);
});
