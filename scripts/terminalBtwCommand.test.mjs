import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const filename = new URL(`../${path}`, import.meta.url);
  const exports = {};
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports;
}

const { buildSideQuestionPrompt, extractSideQuestionAnswer, SIDE_QUESTION_MARKER, SIDE_QUESTION_MAX_LENGTH } = load("src/features/terminal/lib/terminalBtwSideQuestion.ts");

test("project-owned prompt has no upstream slash command", () => {
  const prompt = buildSideQuestionPrompt("explain this output");
  assert.match(prompt, new RegExp(SIDE_QUESTION_MARKER));
  assert.doesNotMatch(prompt, /\/btw|pi-btw/);
});

test("empty and whitespace-only questions yield null", () => {
  assert.equal(buildSideQuestionPrompt(""), null);
  assert.equal(buildSideQuestionPrompt(" \n\t "), null);
});

test("multi-line questions collapse and preserve safety constraints", () => {
  const prompt = buildSideQuestionPrompt("what is\r\nxargs");
  assert.match(prompt, /what is xargs/);
  assert.match(prompt, /Do not modify files/);
  assert.match(prompt, /active terminal/);
});

test("oversized quoted context truncates deterministically", () => {
  const prompt = buildSideQuestionPrompt("explain this", "a".repeat(SIDE_QUESTION_MAX_LENGTH + 100));
  assert.ok(prompt.includes(`a`.repeat(SIDE_QUESTION_MAX_LENGTH) + "…"));
});

test("follow-up prompt includes earlier question and answer turns", () => {
  const prompt = buildSideQuestionPrompt("why?", "selected quote", [
    { question: "what is this?", answer: "It is a terminal command." },
  ]);
  assert.match(prompt, /Previous side-question conversation/);
  assert.match(prompt, /User: what is this\?/);
  assert.match(prompt, /Assistant: It is a terminal command\./);
  assert.match(prompt, /User question: why\?/);
  assert.match(prompt, /Quoted terminal text: selected quote/);
});

test("answer extraction removes terminal control sequences and project marker", () => {
  const answer = extractSideQuestionAnswer(`\x1b[2J${SIDE_QUESTION_MARKER}: explain it\r\n\r\nAnswer here\r\n`);
  assert.equal(answer, "explain it\n\nAnswer here");
});
