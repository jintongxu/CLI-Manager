import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, require = () => ({})) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require });
  return exports;
}
const shell = load("../../../shared/platform/shell.ts");
const tools = load("../../../shared/lib/cliTools.ts");
const { terminalPurpose: purpose, assignTerminalTitle: assign, validTitleNaming: valid } = load("./terminalSessionNaming.ts", id => id.endsWith("cliTools") ? tools : shell);
const plain = v => JSON.parse(JSON.stringify(v));
test("resolved purposes, empty/non-CLI commands and actual shells", () => {
  for (const [cmd, expected] of [["pi", "Pi"], ["claude --resume old", "Claude"], ["codex resume old", "Codex"], ["opencode", "OpenCode"], ["npm run dev", "PowerShell"], ["echo claude", "PowerShell"], ["", "PowerShell"]]) assert.equal(purpose("powershell", cmd), expected);
  assert.equal(purpose("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ""), "PowerShell");
  assert.equal(purpose("/bin/zsh", ""), "Zsh");
  assert.equal(purpose("/custom/myshell", ""), "myshell");
  assert.equal(purpose("powershell", "", "ssh"), "SSH Shell");
  assert.equal(purpose("powershell", "", "wsl"), "WSL");
  assert.equal(purpose(null, "claude", "ssh"), "Claude");
});
test("scope, pending metadata, custom reservation, malformed/legacy exclusion and highest deletion reuse", () => {
  const old = { id: "old", projectId: "p", worktreeId: "w", title: "my title", titleNaming: { source: "custom", base: "Pi", ordinal: 4 } };
  const next = { id: "next", projectId: "p", worktreeId: "w", title: "" };
  assign(next, undefined, "Pi", [old, { ...old, titleNaming: { source: "auto", base: "Pi", ordinal: -5 } }, { ...old, title: "Pi · 100", titleNaming: undefined }]);
  assert.equal(next.title, "Pi · 5");
  assign({ ...next, worktreeId: "other" }, undefined, "Pi", [old]);
  const reusable = { ...next };
  assign(reusable, undefined, "Pi", [old]);
  assert.equal(reusable.title, "Pi · 5");
  const task = { ...next };
  assign(task, "Install dependencies", "Pi", [next]);
  assert.equal(task.title, "Install dependencies");
  assert.deepEqual(plain(task.titleNaming), { source: "task" });
  assert.equal(valid({ source: "unknown" }), undefined);
  const other = { ...next, projectId: "other" };
  assign(other, undefined, "Pi", [old]);
  assert.equal(other.title, "Pi · 1");
});
