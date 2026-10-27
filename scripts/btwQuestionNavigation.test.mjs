import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/features/terminal/components/btwQuestionNavigation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { btwQuestions, jumpToBtwQuestion, activeBtwQuestion } = exports;

// Geometry fixture models a bordered, already-scrolled portal; global scrolling is forbidden.
function fixture() {
  const effects = [];
  const scroller = {
    scrollTop: 240, clientTop: 2,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: (options) => { effects.push(["scroll", options.top, options.behavior]); scroller.scrollTop = options.top; },
  };
  const targets = [0, 2, 4].map((index, position) => ({
    dataset: { btwQuestion: String(index) },
    getBoundingClientRect: () => ({ top: 102 + position * 500 - scroller.scrollTop }),
    focus: (options) => effects.push(["focus", index, options.preventScroll]),
    scrollIntoView: () => assert.fail("must not scroll portal/window ancestors"),
  }));
  scroller.querySelector = (selector) => targets.find((target) => selector === `[data-btw-question="${target.dataset.btwQuestion}"]`) ?? null;
  scroller.querySelectorAll = () => targets;
  return { scroller, targets, effects };
}

test("outline enumerates only user turns, including repeated questions, not answer headings", () => {
  const questions = btwQuestions([
    { role: "user", content: " first\n question " }, { role: "assistant", content: "# Answer heading" },
    { role: "user", content: "first question" }, { role: "assistant", content: "## Another heading" },
    { role: "user", content: "x".repeat(200) },
  ]);
  assert.deepEqual(Array.from(questions, ({ index, snippet }) => [index, snippet]), [[0, "first question"], [2, "first question"], [4, "x".repeat(96)]]);
});

test("jump computes local content coordinates, focuses without scrolling and is repeatable", () => {
  const { scroller, effects } = fixture();
  const otherPortal = fixture();
  assert.equal(jumpToBtwQuestion(scroller, 2), true);
  assert.deepEqual(effects, [["scroll", 484, "instant"], ["focus", 2, true]]);
  assert.equal(activeBtwQuestion(scroller), 2);
  assert.equal(jumpToBtwQuestion(scroller, 2), true);
  assert.equal(scroller.scrollTop, 484);
  assert.deepEqual(otherPortal.effects, []);
  assert.equal(otherPortal.scroller.scrollTop, 240);
  assert.equal(jumpToBtwQuestion(scroller, 0), true);
  assert.equal(scroller.scrollTop, 0);
  assert.equal(activeBtwQuestion(scroller), 0);
});

test("scroll-driven active question follows its long answer; missing/reset targets are safe", () => {
  const { scroller, effects } = fixture();
  scroller.scrollTop = 900;
  assert.equal(activeBtwQuestion(scroller), 2);
  scroller.scrollTop = 1020;
  assert.equal(activeBtwQuestion(scroller), 4);
  assert.equal(jumpToBtwQuestion(scroller, 99), false);
  assert.deepEqual(effects, []);
  scroller.querySelectorAll = () => [];
  assert.equal(activeBtwQuestion(scroller), null);
});
