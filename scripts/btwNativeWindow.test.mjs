import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports });
  return exports;
};
const { BtwThreadModel } = load("src/features/terminal/lib/btwThreadModel.ts");
const { BtwWindowOwner, newerBtwSnapshot } = load("src/features/terminal/lib/btwWindowProtocol.ts");
const tick = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
function harness() {
  const requests = [], cancels = [];
  const model = new BtwThreadModel({ context: async () => ({ available: true, text: "source snapshot", truncated: false, reason: null }),
    ask: (request) => new Promise((resolve) => requests.push({ request, resolve })),
    cancel: async (id) => { cancels.push(id); }, listen: async () => () => {} });
  const owner = new BtwWindowOwner("epoch-one", model);
  const create = (title) => { model.stage("quote", { terminalId: "test", sessionId: "pi-test", reason: null });
    model.setQuestion(title); model.submit(); return model.getSnapshot().entries.at(-1).id; };
  const replay = () => owner.snapshot("en-US", false, "clear-focus", "midnight-aurora");
  let sequence = 0;
  const command = (snapshot, action, extra = {}) => ({ commandSession: 1, commandSequence: ++sequence,
    ownerEpoch: snapshot.ownerEpoch, revision: snapshot.revision, selectionRevision: snapshot.selectionRevision,
    threadId: snapshot.thread?.id, generation: snapshot.thread?.generation, action, ...extra });
  return { model, owner, create, replay, command, requests, cancels };
}

test("ready/reopen replays selected thread without inference; streaming and atomic draft+send dedup", async () => {
  const h = harness(); const id = h.create("first"); await tick();
  h.model.open(id); const first = h.replay();
  assert.equal(first.thread.id, id); assert.equal(h.requests.length, 1);
  for (let n = 0; n < 5; n++) h.replay();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve("answer"); await tick(); const latest = h.replay();
  const send = h.command(latest, "send", { draft: "final keystroke" });
  assert.equal(h.owner.accept(send), true); assert.equal(h.owner.accept(send), false); await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].request.messages.at(-1).content, "final keystroke");
  // A second click while pending cannot queue a later duplicate.
  assert.equal(h.owner.accept(h.command(h.replay(), "send", { draft: "duplicate" })), false);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve("second answer"); await tick();
  // A delayed double click from the prior generation is invalid even after completion.
  assert.equal(h.owner.accept({ ...send, commandSequence: 999 }), false);
  assert.equal(h.requests.length, 2); h.model.dispose();
});

test("epoch/revision/selection fences reject stale switched-thread commands and deleted owner", async () => {
  const h = harness(); const a = h.create("A"), b = h.create("B"); await tick();
  h.model.open(a); const old = h.replay(); h.model.open(b); h.replay(); h.model.open(a); const current = h.replay();
  assert.equal(h.owner.accept(h.command(old, "stop")), false);
  assert.equal(h.owner.accept(h.command(current, "stop", { ownerEpoch: "forged" })), false);
  assert.equal(h.owner.accept(h.command(current, "stop", { revision: 999 })), false);
  assert.equal(h.owner.accept(h.command(current, "reset", { inherit: "yes" })), false);
  assert.equal(h.owner.accept(h.command(current, "invoke")), false);
  assert.equal(h.owner.accept(h.command(current, "draft", { draft: {} })), false);
  h.model.remove(a); assert.equal(h.replay().thread, null);
  assert.equal(h.owner.accept(h.command(current, "send", { draft: "resurrect" })), false);
  h.model.open(b); const beforeClear = h.replay(); h.model.clear(); assert.equal(h.replay().thread, null);
  assert.equal(h.owner.accept(h.command(beforeClear, "retry")), false);
  const c = h.create("C"); h.model.open(c); const beforeDispose = h.replay(); h.owner.dispose(); h.model.dispose();
  assert.equal(h.owner.accept(h.command(beforeDispose, "stop")), false);
  assert.equal(h.model.getSnapshot().entries.length, 0); assert.ok(h.cancels.length >= 3);
});

test("late replay snapshots cannot regress revision or replace the native handshake epoch", () => {
  const palettes = { dark: true, lightThemePalette: "warm-paper", darkThemePalette: "dracula-purple" };
  const current = { ...palettes, ownerEpoch: "new", revision: 8 };
  assert.equal(newerBtwSnapshot(current, { ...palettes, ownerEpoch: "old", revision: 99 }, "new"), current);
  assert.equal(newerBtwSnapshot(current, { ...palettes, ownerEpoch: "new", revision: 7 }, "new"), current);
  assert.equal(newerBtwSnapshot(current, { ...palettes, ownerEpoch: "new", revision: 8 }, "new"), current);
  assert.equal(newerBtwSnapshot(current, { ...palettes, ownerEpoch: "new", revision: 9 }, "new").revision, 9);
});

test("native close preserves history; explicit close unselects but does not cancel requests", async () => {
  const h = harness(); const id = h.create("question"); h.model.open(id); await tick(); const before = h.replay();
  // Native OS close only hides, so a same-card open is a new reveal even with identical selection.
  const version = h.model.getSnapshot().openVersion; h.model.open(id);
  assert.ok(h.model.getSnapshot().openVersion > version);
  assert.equal(h.replay().thread.status, "pending"); assert.equal(h.cancels.length, 0);
  assert.equal(h.owner.accept(h.command(before, "close")), true); assert.equal(h.replay().thread, null);
  assert.equal(h.cancels.length, 0); h.model.open(id); assert.equal(h.replay().thread.status, "pending");
  assert.equal(h.requests.length, 1); h.model.dispose();
});

test("native startup, limited capabilities, verified command gate and no child modal/model", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const child = config.app.windows.filter((window) => window.label === "btw-thread");
  assert.equal(child.length, 1); assert.equal(child[0].visible, false);
  for (const key of ["decorations", "resizable", "minimizable", "maximizable"]) assert.equal(child[0][key], true);
  const cap = JSON.parse(read("src-tauri/capabilities/btw-thread.json"));
  assert.deepEqual(cap.windows, ["btw-thread"]);
  assert.ok(!cap.permissions.some((permission) => /sql|store|fs:|emit|destroy|read-text|process/.test(permission)));
  assert.ok(!JSON.parse(read("src-tauri/capabilities/default.json")).windows.includes("btw-thread"));
  const bootstrap = read("src/main.tsx"); assert.ok(bootstrap.indexOf('label === "btw-thread"') < bootstrap.indexOf('import("./app/App")'));
  const reader = read("src/features/terminal/components/BtwThreadDialog.tsx");
  assert.doesNotMatch(reader, /<Dialog|DialogContent|useBtwSideQuestion/);
  assert.match(reader, /MarkdownContent/); assert.match(reader, /btw-question-outline/); assert.match(reader, /btw-reading-composer/);
  const app = read("src/features/terminal/api/BtwWindowApp.tsx");
  assert.doesNotMatch(app, /new BtwThreadModel|useBtwSideQuestion|side_question_ask/);
  assert.ok(app.indexOf("await listen<") < app.indexOf("await replay();"));
  const rust = read("src-tauri/src/features/terminal/btw_window.rs");
  assert.match(rust, /require\(window.label\(\), CHILD\)/);
  assert.match(rust, /api.prevent_close\(\)/); assert.match(rust, /handle.hide\(\)/);
  const entry = read("src-tauri/src/lib.rs");
  assert.match(entry, /child_command_allowed[\s\S]*invoke.message.webview_ref\(\).label\(\)/);
  assert.match(entry, /ExitRequested[\s\S]*commands::side_question::shutdown\(\)/);
  for (const locale of ["en-US", "zh-CN"]) {
    const messages = read(`src/shared/i18n/messages/terminal.${locale}.ts`);
    for (const key of ["windowTitle", "windowEmpty", "windowUnavailable"]) assert.ok(messages.includes(`terminal.btw.${key}`));
  }
});

test("bounded sequence protocol continues past 100k edits and fences old sequences and sessions", async () => {
  const h = harness(); const id = h.create("question"); h.model.open(id); await tick();
  const snapshot = h.replay();
  const first = h.command(snapshot, "draft", { draft: "first" });
  assert.equal(h.owner.accept(first), true);
  for (let n = 1; n < 100_001; n++) {
    assert.equal(h.owner.accept(h.command(snapshot, "draft", { draft: "edit" })), true);
  }
  assert.equal(h.owner.accept(first), false);
  for (const commandSequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(h.owner.accept(h.command(snapshot, "stop", { commandSequence })), false);
  }
  assert.equal(h.owner.accept(h.command(snapshot, "stop")), true);
  assert.equal(h.owner.accept(h.command(h.replay(), "retry")), true); await tick();
  assert.equal(h.requests.length, 2);
  assert.equal(h.owner.accept(h.command(h.replay(), "reset", { inherit: false })), true);
  assert.equal(h.owner.accept(h.command(h.replay(), "send", { draft: "past budget" })), true); await tick();
  assert.equal(h.requests.length, 3);
  const refreshed = h.replay();
  assert.equal(h.owner.accept(h.command(refreshed, "draft", { commandSession: 2, commandSequence: 1, draft: "refresh" })), true);
  assert.equal(h.owner.accept(h.command(refreshed, "close")), false);
  assert.equal(h.owner.accept(h.command(refreshed, "close", { commandSession: 2, commandSequence: 2 })), true);
  h.model.dispose();
});

test("snapshot palette schema rejects missing, unknown or wrong typed palettes", () => {
  const base = { ownerEpoch: "e", revision: 1, dark: true, lightThemePalette: "warm-paper", darkThemePalette: "dracula-purple" };
  assert.equal(newerBtwSnapshot(null, base, "e"), base);
  for (const invalid of [{ lightThemePalette: undefined }, { darkThemePalette: "unknown" },
    { lightThemePalette: 1 }, { dark: "dark" }]) {
    assert.equal(newerBtwSnapshot(null, { ...base, ...invalid }, "e"), null);
  }
});
