import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "cli-manager-write-scheduling-"));
process.on("exit", () => rmSync(tempDir, { recursive: true, force: true }));

const source = readFileSync(new URL("../src/features/terminal/lib/terminalWriteScheduling.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: "terminalWriteScheduling.ts",
}).outputText;
const modulePath = join(tempDir, "terminalWriteScheduling.mjs");
writeFileSync(modulePath, output, "utf8");
const { selectScheduledTerminalWrite, selectWriteBatchLimit } = await import(pathToFileURL(modulePath).href);

function entry(sessionId, visible) {
  return { token: Symbol(sessionId), sessionId, isVisible: () => visible };
}

test("回车后首帧优先：带交互标记的可见终端跳过 burst 计数", () => {
  const visible = entry("visible-a", true);
  const hidden = entry("hidden-b", false);
  // burst 已满（3/3），按公平规则本应让位隐藏终端。
  const selected = selectScheduledTerminalWrite([visible, hidden], 3, 3, (id) => id === "visible-a");
  assert.equal(selected, visible);
});

test("无标记时沿用公平规则：burst 满则让位隐藏终端", () => {
  const visible = entry("visible-a", true);
  const hidden = entry("hidden-b", false);
  assert.equal(selectScheduledTerminalWrite([visible, hidden], 3, 3, () => false), hidden);
  assert.equal(selectScheduledTerminalWrite([visible, hidden], 2, 3, () => false), visible);
});

test("隐藏终端的标记不生效，不饿死正常调度", () => {
  const visible = entry("visible-a", true);
  const hidden = entry("hidden-b", false);
  const selected = selectScheduledTerminalWrite([visible, hidden], 0, 3, (id) => id === "hidden-b");
  assert.equal(selected, visible);
});

test("空队列返回 undefined", () => {
  assert.equal(selectScheduledTerminalWrite([], 0, 3, () => true), undefined);
});

test("自适应写封顶：拥塞前 64KB，连续积压达阈值后 256KB", () => {
  const base = 64 * 1024;
  const relief = 256 * 1024;
  assert.equal(selectWriteBatchLimit(0, 3, base, relief), base);
  assert.equal(selectWriteBatchLimit(2, 3, base, relief), base);
  assert.equal(selectWriteBatchLimit(3, 3, base, relief), relief);
  assert.equal(selectWriteBatchLimit(10, 3, base, relief), relief);
});
