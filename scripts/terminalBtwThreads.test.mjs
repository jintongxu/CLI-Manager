import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (file) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/features/terminal/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports });
  return exports;
};
const { BtwThreadModel, btwThreadText } = load("lib/btwThreadModel.ts");
const { resolveBtwSource } = load("lib/btwSource.ts");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const source = (id = "one") => ({ terminalId: `terminal-${id}`, sessionId: id, reason: null });
const context = (text = "snapshot", truncated = false) => ({ available: true, text, truncated, reason: null });
function harness({ delayedListen = false } = {}) {
  const requests = [], contexts = [], cancels = [], events = new Set(), subscriptions = [];
  const model = new BtwThreadModel({
    context: (request) => { const d = deferred(); contexts.push({ id: request.sourceSessionId, request, ...d }); return d.promise; },
    ask: (request) => { const d = deferred(); requests.push({ request, ...d }); return d.promise; },
    cancel: async (id) => { cancels.push(id); },
    listen: (callback) => {
      const d = deferred(); const item = { ...d, closeCount: 0 };
      item.release = () => { events.add(callback); d.resolve(() => { item.closeCount++; events.delete(callback); }); };
      subscriptions.push(item); if (!delayedListen) item.release(); return d.promise;
    },
  });
  const create = (question = "why", inherit = false, id = "one") => {
    model.stage(`quote-${id}`, source(id)); model.setInherit(inherit); model.setQuestion(question); model.submit();
    return model.getSnapshot().entries.at(-1).id;
  };
  const find = (id) => model.getSnapshot().entries.find((item) => item.id === id);
  const progress = (request, text) => events.forEach((callback) => callback({ ...request, text }));
  return { model, requests, contexts, cancels, events, subscriptions, create, find, progress };
}

test("default-off staging never reads transcript; inherited snapshot is acquired at creation and immutable", async () => {
  const h = harness(); h.model.stage("quote", source()); h.model.setInherit(true);
  assert.equal(h.contexts.length, 0); h.model.setQuestion("why"); h.model.submit();
  const id = h.model.getSnapshot().entries[0].id;
  assert.equal(h.contexts.length, 1); assert.equal(h.requests.length, 0);
  const snapshot = context("fresh at creation", true); h.contexts[0].resolve(snapshot); await tick();
  snapshot.text = "mutated external object";
  assert.equal(h.requests[0].request.context, "fresh at creation");
  assert.equal(h.find(id).context.text, "fresh at creation"); assert.equal(h.find(id).context.truncated, true);
  h.requests[0].resolve("answer"); await tick(); h.model.setDraft(id, "more"); h.model.send(id); await tick();
  assert.equal(h.contexts.length, 1); assert.equal(h.requests[1].request.context, "fresh at creation");
  assert.equal(h.requests[1].request.messages.length, 3); h.model.dispose();
});

test("two concurrent cards stream cumulative scoped output and retain source despite new quotes", async () => {
  const h = harness(); const a = h.create("first", false, "a"); const b = h.create("second", false, "b"); await tick();
  assert.equal(h.model.getSnapshot().openId, null); assert.equal(h.contexts.length, 0);
  h.progress(h.requests[0].request, "A"); h.progress(h.requests[0].request, "AB");
  h.progress({ ...h.requests[0].request, threadId: b }, "wrong thread");
  assert.equal(h.find(a).answer, "AB"); assert.equal(h.find(b).answer, "");
  h.model.stage("new quote", source("c")); h.model.open(a); h.model.open(null);
  assert.equal(h.find(a).source.sessionId, "a"); assert.equal(h.find(a).quote, "quote-a");
  h.requests[1].resolve("second answer"); h.requests[0].resolve("first answer"); await tick();
  assert.equal(h.find(a).messages[1].content, "first answer"); assert.equal(h.find(b).messages[1].content, "second answer");
  assert.equal(h.events.size, 0); assert.match(btwThreadText(h.find(a)), /user: first\n\nassistant: first answer/);
});

test("failed and stopped retries preserve exactly one user turn and fence old results", async () => {
  const h = harness(); const id = h.create(); await tick(); h.requests[0].reject("failure"); await tick();
  assert.equal(h.find(id).status, "failed"); h.model.send(id, true); await tick();
  assert.equal(h.requests[1].request.messages.length, 1); h.model.stop(id);
  assert.equal(h.find(id).status, "stopped"); assert.equal(h.events.size, 0);
  h.model.send(id, true); await tick(); h.requests[1].resolve("late"); await tick();
  assert.equal(h.find(id).status, "pending"); assert.equal(h.find(id).messages.length, 1);
  h.requests[2].resolve("recovered"); await tick(); assert.equal(h.find(id).messages.length, 2);
  assert.deepEqual(h.cancels, [h.requests[1].request.requestId]);
  h.model.send(id, true); await tick(); assert.equal(h.requests.length, 3);
});

test("delete, reset, clear and dispose cancel active work, release listeners immediately, reject late events/results", async () => {
  for (const action of ["remove", "reset", "clear", "dispose"]) {
    const h = harness(); const id = h.create(); await tick(); const request = h.requests[0];
    h.model[action](id); assert.equal(h.events.size, 0); assert.equal(h.cancels[0], request.request.requestId);
    h.progress(request.request, "late"); request.resolve("late final"); await tick();
    assert.equal(h.find(id)?.messages.length ?? 0, action === "dispose" ? 1 : 0); assert.notEqual(h.find(id)?.answer, "late final");
    assert.equal(h.subscriptions[0].closeCount, 1);
  }
});

test("stop/delete before listener registration never starts inference and cleans delayed subscription", async () => {
  for (const action of ["stop", "remove", "reset", "dispose"]) {
    const h = harness({ delayedListen: true }); const id = h.create();
    h.model[action](id); h.subscriptions[0].release(); await tick();
    assert.equal(h.requests.length, 0); assert.equal(h.events.size, 0); assert.equal(h.subscriptions[0].closeCount, 1);
  }
});

test("pending snapshots are fenced by source, generation, delete, clear and unmount", async () => {
  const h = harness(); const a = h.create("first", true, "a"); const b = h.create("second", true, "b");
  h.model.stage("third", source("c")); h.model.reset(a, true); h.model.remove(b);
  h.contexts[0].resolve(context("old-a")); h.contexts[1].resolve(context("deleted-b")); await tick();
  assert.equal(h.requests.length, 0); h.contexts[2].resolve(context("new-a")); await tick();
  assert.equal(h.find(a).context.text, "new-a"); assert.equal(h.find(a).source.sessionId, "a");
  h.model.send(a); await tick(); assert.equal(h.requests[0].request.context, "new-a");
  h.model.reset(a, true); h.model.reset(a, false); h.contexts[3].resolve(context("late reset")); await tick();
  assert.equal(h.find(a).inherit, false); assert.equal(h.find(a).context.text, "");
  h.create("dispose", true); h.model.dispose(); h.contexts[4].resolve(context()); await tick();
  assert.equal(h.model.getSnapshot().entries.length, 2);
});

test("unavailable context remains precisely explained and noninherit inference usable", async () => {
  const h = harness(); const id = h.create("why", true);
  h.contexts[0].resolve({ available: false, text: "", truncated: false, reason: "source_ambiguous" }); await tick();
  assert.equal(h.find(id).inherit, true); assert.equal(h.find(id).context.reason, "source_ambiguous");
  assert.equal(h.find(id).status, "failed"); assert.equal(h.find(id).draft, "why");
  assert.equal(h.find(id).messages.length, 0); assert.equal(h.requests.length, 0);
  h.model.send(id); await tick(); assert.equal(h.requests.length, 0);
  h.model.send(id, true); assert.equal(h.contexts.length, 2);
  h.contexts[1].resolve(context("retry snapshot")); await tick();
  assert.equal(h.requests[0].request.context, "retry snapshot");
  assert.equal(h.requests[0].request.messages.length, 1);
  assert.equal(h.requests[0].request.messages[0].content, "why"); h.model.dispose();
});

test("exact right-click terminal identity wins over active/fallback; remote and unbound sources unavailable", () => {
  const sessions = [{ id: "clicked", cliTool: "pi", cliSessionId: "stored" }, { id: "active", cliTool: "pi", cliSessionId: "active-pi" }];
  assert.equal(resolveBtwSource("clicked", sessions, { clicked: { agentIdentity: { source: "pi", sessionId: "runtime" } } }).sessionId, "runtime");
  assert.equal(resolveBtwSource("clicked", sessions, {}).sessionId, "stored");
  assert.equal(resolveBtwSource("unknown", sessions, {}).reason, "no_source_session");
  assert.equal(resolveBtwSource("clicked", [{ ...sessions[0], environmentType: "wsl" }], {}).reason, "remote_source");
  assert.equal(resolveBtwSource("clicked", [{ id: "clicked", cliTool: "codex", cliSessionId: "not-pi" }], {}).sessionId, null);
  const selection = readFileSync(new URL("../src/features/terminal/hooks/useTerminalSelectionActions.ts", import.meta.url), "utf8");
  assert.match(selection, /onAskBtw\?\.\(selection, sessionId\)/);
});

test("hook IPC adapter subscribes before structured ask; StrictMode probe survives and real unmount cancels", async () => {
  const exports = {}, calls = [], callbacks = [], effects = [];
  const requests = [], subscriptions = new Set();
  const code = ts.transpileModule(readFileSync(new URL("../src/features/terminal/hooks/useBtwSideQuestion.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, queueMicrotask, require: (name) => {
    if (name === "react") return {
      useMemo: (fn) => fn(), useRef: (value) => ({ current: value }),
      useSyncExternalStore: (_, get) => get(), useEffect: (setup) => effects.push(setup),
    };
    if (name === "./useBtwNativeWindow") return { useBtwNativeWindow: () => {} };
    if (name === "../state") return { useTerminalStore: { getState: () => ({ activeSessionId: "active", sessions: [
      { id: "clicked", cliTool: "pi", cliSessionId: "clicked-pi" }, { id: "active", cliTool: "pi", cliSessionId: "active-pi" },
    ], tabStatuses: {} }) } };
    if (name === "../lib/btwSource") return { resolveBtwSource };
    if (name === "../lib/btwThreadRepository") return { listBtwThreads: async () => [], saveBtwThread: async () => {}, deleteBtwThread: async () => {} };
    if (name === "../lib/btwThreadModel") return { BtwThreadModel };
    if (name === "@tauri-apps/api/event") return { listen: async (event, callback) => {
      calls.push(["listen", event]); callbacks.push(callback); subscriptions.add(callback);
      return () => subscriptions.delete(callback);
    } };
    if (name === "@tauri-apps/api/core") return { invoke: (command, args) => {
      calls.push([command, args]);
      if (command === "side_question_context") return Promise.resolve(context("ipc snapshot"));
      if (command === "side_question_ask") { const d = deferred(); requests.push(d); return d.promise; }
      return Promise.resolve();
    } };
    throw new Error(name);
  } });
  const hook = exports.useBtwSideQuestion();
  const probeCleanup = effects[0](); probeCleanup(); const unmount = effects[0](); await tick();
  hook.stageFromTerminal("quote", "clicked"); hook.model.setInherit(true); hook.setQuestion("why"); hook.submit(); await tick();
  assert.ok(calls[0][1].request.requestId);
  assert.equal(calls[0][0], "side_question_context"); assert.equal(calls[0][1].request.sourceSessionId, "clicked-pi");
  assert.equal(calls[1][0], "listen"); assert.equal(calls[1][1], "side-question-progress");
  assert.equal(calls[2][0], "side_question_ask"); const request = calls[2][1].request;
  assert.equal(request.quote, "quote"); assert.equal(request.context, "ipc snapshot"); assert.equal(request.messages[0].role, "user");
  callbacks[0]({ payload: { threadId: request.threadId, requestId: request.requestId, text: "stream" } });
  assert.equal(hook.model.getSnapshot().entries[0].answer, "stream");
  unmount(); await tick();
  assert.equal(subscriptions.size, 0); assert.equal(calls[3][0], "side_question_cancel"); assert.equal(calls[3][1].requestId, request.requestId);
  requests[0].resolve("late after unmount"); await tick(); assert.equal(hook.model.getSnapshot().entries.length, 1);
});

test("listener and snapshot failures are safe; clear fences unresolved context", async () => {
  const h = harness({ delayedListen: true }); const id = h.create();
  h.subscriptions[0].reject(new Error("listen failed")); await tick();
  assert.equal(h.find(id).status, "failed"); assert.equal(h.requests.length, 0);
  h.model.send(id, true); h.subscriptions[1].release(); await tick();
  assert.equal(h.requests[0].request.messages.length, 1); h.model.dispose();
  const c = harness(); const failedContext = c.create("why", true);
  c.contexts[0].reject(new Error("context failed")); await tick();
  assert.equal(c.find(failedContext).inherit, true); assert.match(c.find(failedContext).context.reason, /context failed/);
  assert.equal(c.requests.length, 0);
  c.model.reset(failedContext, false); c.model.send(failedContext); await tick();
  assert.equal(c.requests[0].request.context, "");
  assert.equal(c.requests[0].request.messages.length, 1);
  c.create("clear", true); c.model.clear(); c.contexts[1].resolve(context("late")); await tick();
  assert.equal(c.model.getSnapshot().entries.length, 0); assert.equal(c.requests.length, 1);
});

test("selection action uses captured menu quote and its own terminal ID, without PTY writes", () => {
  const exports = {}, calls = [];
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/features/terminal/hooks/useTerminalSelectionActions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => ({}) });
  const ref = { current: "captured-ref" };
  const actions = exports.useTerminalSelectionActions({
    sessionId: "rightclicked-not-active", terminalRef: { current: { getSelection: () => "live", clearSelection: () => {} } },
    contextMenuSelectionRef: ref, menuState: { selection: "menu" }, closeContextMenu: () => {},
    focusTerminalWithCodexCursorPolicy: () => {}, onAskBtw: (...args) => calls.push(args),
  });
  actions.handleMenuAskBtw("explicit-menu"); assert.deepEqual(calls[0], ["explicit-menu", "rightclicked-not-active"]);
  ref.current = "captured-ref"; actions.handleMenuAskBtw(); assert.deepEqual(calls[1], ["captured-ref", "rightclicked-not-active"]);
  assert.equal(ref.current, "");
  const empty = exports.useTerminalSelectionActions({ sessionId: "empty-clicked", terminalRef: { current: null },
    contextMenuSelectionRef: ref, menuState: null, closeContextMenu: () => {}, onAskBtw: (...args) => calls.push(args) });
  empty.handleMenuAskBtw(); assert.deepEqual(calls[2], ["", "empty-clicked"]);
});

test("caller-known context handles cancel on reset/delete/clear/unmount and fence replacement", async () => {
  for (const action of ["remove", "reset", "clear", "dispose"]) {
    const h = harness(); const id = h.create("why", true);
    const old = h.contexts[0];
    assert.equal(h.find(id).contextRequestId, old.request.requestId);
    assert.equal(old.request.sourceSessionId, "one");
    h.model[action](id);
    assert.ok(h.cancels.includes(old.request.requestId));
    old.resolve(context("stale")); await tick();
    assert.equal(h.requests.length, 0);
    if (action === "reset") {
      assert.notEqual(h.contexts[1].request.requestId, old.request.requestId);
      h.contexts[1].resolve(context("current")); await tick();
      assert.equal(h.find(id).context.text, "current");
    }
    h.model.dispose();
  }
});

test("snapshot retry failure stays inherited and never duplicates an unsent question", async () => {
  const h = harness(); const id = h.create("original", true);
  h.contexts[0].reject("failure"); await tick();
  h.model.send(id, true); h.model.send(id, true);
  assert.equal(h.contexts.length, 2);
  h.contexts[1].resolve({ available: false, text: "", truncated: false, reason: "source_not_found" }); await tick();
  assert.equal(h.find(id).inherit, true); assert.equal(h.find(id).messages.length, 0);
  assert.equal(h.find(id).status, "failed"); assert.equal(h.requests.length, 0);
  h.model.reset(id, false); h.model.send(id); await tick();
  assert.equal(h.requests[0].request.messages.length, 1);
  assert.equal(h.requests[0].request.messages[0].content, "original");
  h.model.dispose();
});
