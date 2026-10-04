import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "cli-manager-terminal-latency-"));
process.on("exit", () => rmSync(tempDir, { recursive: true, force: true }));

const source = readFileSync(new URL("../src/features/terminal/lib/terminalLatencyDiagnostics.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: "terminalLatencyDiagnostics.ts",
}).outputText;
const modulePath = join(tempDir, "terminalLatencyDiagnostics.mjs");
writeFileSync(modulePath, output, "utf8");
const diagnostics = await import(pathToFileURL(modulePath).href);

test("回车→首帧→渲染提交三段时间被记录", () => {
  diagnostics.noteTerminalEnter("s1", 1000);
  assert.equal(diagnostics.noteTerminalFirstFrame("s1", 1030), true);
  // 同一回车的后续帧不再命中。
  assert.equal(diagnostics.noteTerminalFirstFrame("s1", 1040), false);
  diagnostics.noteTerminalFlushStart("s1", 1045);
  diagnostics.noteTerminalWriteCommitted("s1", 1050);
  const snapshot = diagnostics.terminalLatencySnapshot();
  assert.equal(snapshot.s1.count, 1);
  assert.deepEqual(snapshot.s1.enterToFirstFrameMs, { p50: 30, p95: 30, max: 30 });
  assert.deepEqual(snapshot.s1.firstFrameQueuedMs, { p50: 15, p95: 15, max: 15 });
  assert.deepEqual(snapshot.s1.writeCommittedMs, { p50: 5, p95: 5, max: 5 });
  diagnostics.clearTerminalLatency("s1");
});

test("replay 期间的回车不产生样本：无首帧则无记录", () => {
  diagnostics.noteTerminalEnter("s2", 2000);
  const snapshot = diagnostics.terminalLatencySnapshot();
  assert.equal(snapshot.s2, undefined);
  diagnostics.clearTerminalLatency("s2");
});

test("滑动窗口只保留最近 50 次", () => {
  for (let i = 0; i < 60; i += 1) {
    diagnostics.noteTerminalEnter("s3", i * 100);
    diagnostics.noteTerminalFirstFrame("s3", i * 100 + 10);
    diagnostics.noteTerminalFlushStart("s3", i * 100 + 12);
    diagnostics.noteTerminalWriteCommitted("s3", i * 100 + 15);
  }
  const snapshot = diagnostics.terminalLatencySnapshot();
  assert.equal(snapshot.s3.count, 50);
  assert.equal(snapshot.s3.enterToFirstFrameMs.max, 10);
  diagnostics.clearTerminalLatency("s3");
});
