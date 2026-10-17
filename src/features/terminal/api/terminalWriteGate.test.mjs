import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load() {
  const source = readFileSync(new URL("./terminalWriteGate.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports });
  return exports;
}

test("writes are serialized and close waits for the in-flight write", async () => {
  const { TerminalWriteGate } = load();
  const gate = new TerminalWriteGate();
  const events = [];
  let release;
  const first = gate.enqueue("session", async () => {
    events.push("write-start");
    await new Promise((resolve) => { release = resolve; });
    events.push("write-end");
  });
  const second = gate.enqueue("session", async () => events.push("write-2"));
  gate.beginClose("session");
  const blocked = gate.enqueue("session", async () => events.push("late-write"));
  let closeFinished = false;
  const close = gate.waitForWrites("session").then(() => { closeFinished = true; });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.join(","), "write-start");
  assert.equal(closeFinished, false);
  release();
  await Promise.all([first, second, blocked, close]);
  assert.equal(events.join(","), "write-start,write-end,write-2");
  assert.equal(closeFinished, true);
  gate.finishClose("session");
  assert.equal(gate.isClosing("session"), false);
});
