import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, require = () => { throw new Error("Unexpected dependency"); }) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require });
  return exports;
}

test("repository scopes current terminal before the limit and returns persisted timestamp", async () => {
  const calls = [];
  const repository = load("src/features/terminal/lib/btwThreadRepository.ts", (name) => {
    assert.ok(name.endsWith("shared/platform/db"));
    return { getDb: async () => ({ select: async (sql, args) => {
      calls.push({ sql, args });
      return sql.includes("SELECT *") ? [{ id: "saved", source_terminal_id: "term-a", created_at: 1234 }] : [];
    } }) };
  });
  const rows = await repository.listBtwThreads({ terminalId: "term-a", query: "answer", limit: 100 });
  assert.match(calls[0].sql, /source_terminal_id = \$1[\s\S]*ORDER BY[\s\S]*LIMIT \$3 OFFSET \$4/);
  assert.equal(calls[0].args[0], "term-a");
  assert.equal(calls[0].args[1], "%answer%");
  assert.equal(rows[0].createdAt, 1234);
});

test("terminal-specific history hydration retains another terminal's pending owner request", async () => {
  const { BtwThreadModel } = load("src/features/terminal/lib/btwThreadModel.ts");
  let resolveAnswer;
  let options;
  const model = new BtwThreadModel({
    ask: () => new Promise((resolve) => { resolveAnswer = resolve; }),
    listen: async () => () => {}, cancel: async () => {}, context: async () => {},
  }, { list: async (value) => { options = value; return []; }, save: async () => {}, remove: async () => {} });
  model.stage("quote", { terminalId: "term-a", sessionId: null, reason: "no_source_session" });
  model.setQuestion("pending question");
  const id = model.submitEmbedded();
  for (let n = 0; n < 10; n++) await Promise.resolve();
  model.stage("", { terminalId: "term-b", sessionId: null, reason: "no_source_session" });
  const live = model.getSnapshot().entries[0];
  await model.loadHistory("not matching", false, "term-b");
  assert.equal(options.terminalId, "term-b");
  assert.equal(model.getSnapshot().entries[0], live);
  resolveAnswer("finished in background");
  for (let n = 0; n < 10; n++) await Promise.resolve();
  assert.equal(model.getSnapshot().entries.find((entry) => entry.id === id).answer, "finished in background");
});

test("initial history hydration cannot replace a newly running owner turn", async () => {
  const { BtwThreadModel } = load("src/features/terminal/lib/btwThreadModel.ts");
  let hydrate;
  const model = new BtwThreadModel({
    ask: () => new Promise(() => {}), listen: async () => () => {}, cancel: async () => {}, context: async () => {},
  }, { list: () => new Promise((resolve) => { hydrate = resolve; }), save: async () => {}, remove: async () => {} });
  const starting = model.start();
  for (let n = 0; n < 10; n++) await Promise.resolve();
  model.stage("", { terminalId: "term", sessionId: null, reason: "no_source_session" });
  model.setQuestion("new turn"); model.submitEmbedded();
  const live = model.getSnapshot().entries[0];
  hydrate([]); await starting;
  assert.equal(model.getSnapshot().entries[0], live);
});

test("history toolbar toggling does not stage or reset the selected embedded reader", () => {
  const controller = read("src/features/terminal/hooks/useTerminalTabsController.tsx");
  const toggle = controller.slice(controller.indexOf("handleToggleBtwPanel:"), controller.indexOf("handleToggleBtwPanel:") + 600);
  assert.doesNotMatch(toggle, /stageFromTerminal/);
  assert.match(controller, /openBtwReader: \(\) => \{ closeHistory\(\); closeGitWorkspace\(\); setActiveWorkspaceTab\("terminal"\); setBtwDrawerOpen\(true\); \}/);
  const toolbar = read("src/features/terminal/hooks/useTerminalToolbarRenderer.tsx");
  assert.match(toolbar, /title=\{t\("terminal.btw.historyTooltip"\)\}/);
  assert.match(toolbar, /<MessageSquare size=\{13\}/);
});
