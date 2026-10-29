import test from "node:test";
import assert from "node:assert/strict";
import { resolveTerminalExitAction } from "../src/features/terminal/api/terminalExitCleanup.ts";
import { normalizeExitWithRunningTasksBehavior } from "../src/shared/preferences/exitPolicy.ts";

test("restore preference never authorizes background exit, including idle PTYs", () => {
  for (const restore of [true, false]) {
    for (const behavior of ["ask", "background", "minimize", "discard", "invalid", null, undefined, {}, 0]) {
      assert.equal(resolveTerminalExitAction(0, restore, behavior), "cleanup");
      for (const count of [1, 5]) {
        assert.equal(resolveTerminalExitAction(count, restore, behavior), normalizeExitWithRunningTasksBehavior(behavior));
        assert.notEqual(resolveTerminalExitAction(count, restore, behavior), "background");
      }
    }
  }
});

test("normalization retains current choices and converts legacy/invalid values to ask", () => {
  for (const value of ["ask", "minimize", "discard"]) assert.equal(normalizeExitWithRunningTasksBehavior(value), value);
  for (const value of ["background", "ASK", "", null, undefined, false, 3, {}, []]) {
    assert.equal(normalizeExitWithRunningTasksBehavior(value), "ask");
  }
});
