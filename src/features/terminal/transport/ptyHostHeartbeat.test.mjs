import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path) {
  const sourceText = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const body = source.statements
    .filter((node) => !ts.isImportDeclaration(node) && !(ts.isExportDeclaration(node) && node.moduleSpecifier))
    .map((node) => node.getText(source))
    .join("\n");
  const output = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(output, { exports }, { filename: path });
  return exports;
}

const { shouldExpirePtyHostHeartbeat } = load("./ptyHostHeartbeat.ts");

test("hidden WebView heartbeat suspension never expires a healthy connection", () => {
  assert.equal(shouldExpirePtyHostHeartbeat(0, 60_000, 15_000, true), false);
});

test("visible WebView heartbeat still expires after the timeout", () => {
  assert.equal(shouldExpirePtyHostHeartbeat(0, 15_001, 15_000, false), true);
  assert.equal(shouldExpirePtyHostHeartbeat(0, 15_000, 15_000, false), false);
});

test("a delayed timer callback gets one recovery probe instead of a false timeout", () => {
  assert.equal(shouldExpirePtyHostHeartbeat(0, 60_000, 15_000, true), false);
});
