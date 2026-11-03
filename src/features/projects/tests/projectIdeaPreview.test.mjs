import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const path = new URL("../lib/projectIdeaPreview.ts", import.meta.url);
const source = readFileSync(path, "utf8");
const output = ts.transpileModule(source.replace(/^import type .*\n/gm, ""), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports });
const preview = exports.projectIdeaPreview;

test("single-line ideas appear once, including Markdown headers and legacy custom titles", () => {
  assert.deepEqual({ ...preview({ title: "测试", content: "测试" }) }, { heading: "测试", excerpt: "" });
  assert.deepEqual({ ...preview({ title: "测试", content: "# 测试" }) }, { heading: "测试", excerpt: "" });
  assert.deepEqual({ ...preview({ title: "Custom", content: "正文" }) }, { heading: "Custom", excerpt: "正文" });
});

test("multiline ideas retain the rest without duplicating the first line", () => {
  assert.deepEqual({ ...preview({ title: "Idea", content: "Idea\nDetails\nNext step" }) }, { heading: "Idea", excerpt: "Details Next step" });
  assert.deepEqual({ ...preview({ title: "Idea", content: "# Idea\nDetails" }) }, { heading: "Idea", excerpt: "Details" });
});
