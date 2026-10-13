import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./currentWorkModel.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { appendCurrentWorkSession, activateCurrentWorkSession } = exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

test("appends a newly opened terminal and keeps the existing active terminal", () => {
  assert.deepEqual(plain(appendCurrentWorkSession(["a"], "a", "b")), {
    sessionIds: ["a", "b"], activeSessionId: "a",
  });
});

test("uses the new terminal as active only when current work has no active terminal", () => {
  assert.deepEqual(plain(appendCurrentWorkSession([], null, "new")), {
    sessionIds: ["new"], activeSessionId: "new",
  });
});

test("does not duplicate an existing current-work terminal", () => {
  assert.deepEqual(plain(appendCurrentWorkSession(["a", "b"], "b", "a")), {
    sessionIds: ["a", "b"], activeSessionId: "b",
  });
});

test("activates a viewed terminal and adds it when it is outside current work", () => {
  assert.deepEqual(plain(activateCurrentWorkSession(["a"], "b")), {
    sessionIds: ["a", "b"], activeSessionId: "b",
  });
});

test("sanitizes persisted current-work layout and removes unknown or duplicate sessions", () => {
  const tree = { type: "split", id: "split", direction: "horizontal", ratio: 0.4,
    first: { type: "leaf", id: "left", sessionIds: ["a", "missing"], activeSessionId: "missing" },
    second: { type: "leaf", id: "right", sessionIds: ["a", "b"], activeSessionId: "a" } };
  assert.deepEqual(plain(exports.sanitizeCurrentWorkPaneTree(tree, new Set(["a", "b"]))), {
    type: "split", id: "split", direction: "horizontal", ratio: 0.4,
    first: { type: "leaf", id: "left", sessionIds: ["a"], activeSessionId: "a" },
    second: { type: "leaf", id: "right", sessionIds: ["b"], activeSessionId: "b" },
  });
});

test("sanitizer collapses persisted layout nodes with duplicate identities", () => {
  const tree = { type: "split", id: "duplicate", direction: "horizontal", ratio: 0.5,
    first: { type: "leaf", id: "pane", sessionIds: ["a"], activeSessionId: "a" },
    second: { type: "leaf", id: "pane", sessionIds: ["b"], activeSessionId: "b" } };
  assert.deepEqual(plain(exports.sanitizeCurrentWorkPaneTree(tree, new Set(["a", "b"]))), {
    type: "leaf", id: "pane", sessionIds: ["a"], activeSessionId: "a",
  });
});

test("sanitizer preserves a valid node when an invalid duplicate appears first", () => {
  const tree = { type: "split", id: "split", direction: "horizontal", ratio: 0.5,
    first: { type: "leaf", id: "pane", sessionIds: ["missing"], activeSessionId: "missing" },
    second: { type: "leaf", id: "pane", sessionIds: ["b"], activeSessionId: "b" } };
  assert.deepEqual(plain(exports.sanitizeCurrentWorkPaneTree(tree, new Set(["b"]))), {
    type: "leaf", id: "pane", sessionIds: ["b"], activeSessionId: "b",
  });
});

test("remaps current-work layout session IDs after PTY recreation", () => {
  const tree = { type: "leaf", id: "pane", sessionIds: ["old"], activeSessionId: "old" };
  assert.deepEqual(plain(exports.remapCurrentWorkPaneTreeSessionIds(tree, { old: "new" })), {
    type: "leaf", id: "pane", sessionIds: ["new"], activeSessionId: "new",
  });
});
