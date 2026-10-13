import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadCleanup() {
  const source = readFileSync(new URL("./terminalExitCleanup.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require() { throw new Error("unexpected dependency"); } });
  return exports;
}

test("background exit always closes anonymous Pi without closing ordinary PTYs", async () => {
  const { cleanupTerminalProcessesForExit } = loadCleanup();
  const calls = [];
  const result = await cleanupTerminalProcessesForExit(
    {
      closePty: false,
      closeAllPty: true,
      foregroundSessionIds: ["ordinary"],
      alwaysCloseSessionIds: ["anonymous", "anonymous"],
    },
    {
      closeAll: async () => calls.push(["closeAll"]),
      close: async (id) => calls.push(["close", id]),
      shutdownDaemonIfIdle: async () => false,
    },
  );

  assert.deepEqual(calls, [["close", "anonymous"]]);
  assert.equal(result.canExit, true);
  assert.equal(result.daemonStopped, false);
});

test("ordinary cleanup still closes all PTYs when requested", async () => {
  const { cleanupTerminalProcessesForExit } = loadCleanup();
  const calls = [];
  await cleanupTerminalProcessesForExit(
    {
      closePty: true,
      closeAllPty: true,
      foregroundSessionIds: ["ordinary"],
      alwaysCloseSessionIds: ["anonymous"],
    },
    {
      closeAll: async () => calls.push(["closeAll"]),
      close: async (id) => calls.push(["close", id]),
      shutdownDaemonIfIdle: async () => true,
    },
  );

  assert.deepEqual(calls, [["closeAll"]]);
});
