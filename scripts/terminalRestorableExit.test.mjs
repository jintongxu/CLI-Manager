import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveTerminalExitAction, cleanupTerminalProcessesForExit } from "../src/features/terminal/api/terminalExitCleanup.ts";

const source = readFileSync("src/app/App.tsx", "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const guardStart = source.indexOf('    const { runningIds, daemonSessionsChecked } =', source.indexOf('const requestExitGuardedByRunningTasks'));
const guardEnd = source.indexOf('  }, [enterBackgroundTaskMode', guardStart);
const guard = new AsyncFunction("source", "prechecked", "getExitRunningTaskIds", "logInfo", "exitTasksBehaviorRef",
  "resolveTerminalExitAction", "useSettingsStore", "runExitCleanup", "enterBackgroundTaskMode", "minimizeToTray",
  "pendingExitSourceRef", "pendingExitDaemonSessionsCheckedRef", "setRunningTasksCount", "focusMainWindow", "setRunningTasksDialogOpen",
  source.slice(guardStart, guardEnd));
const bgStart = source.indexOf('    let daemonActive = false;', source.indexOf('const enterBackgroundTaskMode'));
const bgEnd = source.indexOf('  }, [minimizeToTray, runExitCleanup]', bgStart);
const background = new AsyncFunction("invoke", "logWarn", "logInfo", "runExitCleanup", "minimizeToTray", ts.transpileModule(source.slice(bgStart, bgEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);

for (const entry of ["window close", "close dialog", "tray quit"]) {
  for (const daemon of [true, false, "unavailable"]) {
    test(`${entry}: idle Pi/shell remain alive, daemon=${daemon}`, async () => {
      const calls = [];
      const cleanup = async (_source, options) => {
        calls.push("flush snapshot");
        await cleanupTerminalProcessesForExit({ ...options, closeAllPty: true, foregroundSessionIds: ["idle-pi", "idle-shell"] }, {
          closeAll: async () => calls.push("KILL ALL"), close: async () => calls.push("KILL"),
          shutdownDaemonIfIdle: async () => calls.push("SHUTDOWN"),
        });
        calls.push("exit UI");
      };
      const hide = async () => calls.push("hide");
      const bg = () => background(async () => { if (daemon === "unavailable") throw Error("missing"); return daemon; }, () => {}, () => {}, cleanup, hide);
      await guard(entry, undefined, async () => ({ runningIds: [], daemonSessionsChecked: daemon === true }), () => {}, { current: "discard" },
        resolveTerminalExitAction, { getState: () => ({ terminalSessionRestoreEnabled: true }) }, cleanup, bg, hide, {}, {}, () => {}, async () => {}, () => {});
      assert.deepEqual(calls, daemon === true ? ["flush snapshot", "exit UI"] : ["hide"]);
    });
  }
}

test("running task policy wins; restore-off idle still cleans", () => {
  for (const restore of [true, false]) for (const behavior of ["ask", "background", "minimize", "discard"]) {
    assert.equal(resolveTerminalExitAction(1, restore, behavior), behavior);
    assert.equal(resolveTerminalExitAction(0, restore, behavior), restore ? "background" : "cleanup");
  }
});

test("all normal exits share guard and explicit discard/reject retain cleanup", () => {
  for (const entry of ["window close", "close dialog", "tray quit"]) assert.ok(source.includes(`requestExitGuardedByRunningTasks("${entry}"`));
  assert.match(source, /handleRunningTasksDialogDiscard[\s\S]*?discardSessions: true/);
  assert.match(source, /handleRejectRestoreSessions[\s\S]*?terminalProcessManager.closeAll\(\)/);
  assert.match(source, /if \(!terminalSessionRestoreEnabled\) \{\s*await terminalProcessManager.closeAll\(\)/);
  assert.ok(source.indexOf("await flushTerminalSnapshotsNow()") < source.indexOf("const terminalCleanup = await cleanupTerminalProcessesForExit"));
});
