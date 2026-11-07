import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function fixture(disk = {}) {
  let state;
  const writes = [];
  let fail = false;
  const memory = structuredClone(disk);
  const store = { async get(key) { return memory[key]; }, async set(key, value) { memory[key] = structuredClone(value); }, async save() {
    writes.push("save");
    if (fail) throw new Error("disk");
    Object.assign(disk, structuredClone(memory));
  } };
  const create = initialize => {
    const api = { getState: () => state, setState: update => { state = { ...state, ...update }; } };
    state = initialize();
    return api;
  };
  const cache = new Map();
  function loadModule(path) {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require(id) { return loadModule(resolve(dirname(path), id + ".ts")); } });
    return exports;
  }
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./sessionStore.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(id) {
    if (id === "zustand") return { create };
    if (id.includes("plugin-store")) return { Store: { load: async () => store } };
    if (id.includes("appPaths")) return { getCliManagerDataPaths: async () => ({ sessionsStorePath: "sessions.dev.json" }) };
    if (id.includes("singleFlight")) return { singleFlight: fn => fn };
    if (id.startsWith(".")) return loadModule(resolve(dirname(fileURLToPath(import.meta.url)), id + ".ts"));
    throw new Error(id);
  } });
  return { api: exports.useSessionStore, exports, store, loadModule, disk, writes, fail(value) { fail = value; } };
}

test("whole session snapshot excludes anonymous Pi from restart recovery", async () => {
  const f = fixture();
  const records = [
    { id: "auto", title: "Pi · 8", titleNaming: { source: "auto", base: "Pi", ordinal: 8 }, cliSessionId: "conversation" },
    { id: "legacy", title: "Terminal" },
    { id: "custom", title: "Pi · 1", titleNaming: { source: "custom" } },
    { id: "task", title: "Install", titleNaming: { source: "task" } },
  ];
  await f.api.getState().saveSessions([...records, { id: "temporary", kind: "ephemeral-pi" }]);
  assert.deepEqual(f.disk.sessions, records);
  assert.deepEqual(Object.keys(f.disk), ["sessions"]);
  assert.equal(f.writes.length, 1);
  const reopened = fixture(f.disk);
  await reopened.api.getState().load();
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.api.getState().sessions)), records);
});

test("runtime persistence exposes only canonical topology, including after load and clear", async () => {
  const f = fixture({ sessions: [{ id: "a" }], currentWorkSessionIds: ["a"] });
  const assertCanonical = () => {
    for (const key of ["currentWorkSessionIds", "currentWorkActiveSessionId", "currentWorkPaneTree", "saveCurrentWork", "replaceCurrentWorkSession"]) {
      assert.equal(key in f.api.getState(), false, key);
    }
  };
  assertCanonical();
  await f.api.getState().load();
  assertCanonical();
  await f.api.getState().saveWorkspans(f.api.getState().workspans, f.api.getState().activeWorkspanId, f.api.getState().sessions);
  assertCanonical();
  await f.api.getState().clear();
  assertCanonical();
});

test("failed save is observable; retry saves full latest snapshot", async () => {
  const f = fixture({ sessions: [{ id: "legacy", title: "Old" }] });
  f.fail(true);
  await assert.rejects(f.api.getState().saveSessions([{ id: "new", title: "Pi · 1" }]));
  assert.equal(f.disk.sessions[0].id, "legacy");
  f.fail(false);
  await f.api.getState().saveSessions([{ id: "new", title: "Pi · 2", titleNaming: { source: "auto", base: "Pi", ordinal: 2 } }]);
  assert.equal(f.disk.sessions[0].title, "Pi · 2");
});

const leaf = (id, sessionIds, activeSessionId = sessionIds[0]) => ({ type: "leaf", id, sessionIds, activeSessionId });
const split = (id, first, second, ratio = 0.37) => ({ type: "split", id, first, second, ratio, direction: "vertical" });
const workspan = (id, paneTree) => ({ id, paneTree, activePaneId: "left", activeSessionId: "a" });
const plain = value => JSON.parse(JSON.stringify(value));

test("migration conserves hidden members, promotes CW geometry and retains residual splits", async () => {
  const legacy = {
    sessions: ["a", "b", "c", "d", "missing", "ownerless"].map(id => ({ id, tabHidden: id === "b" })),
    workspans: [workspan("ordinary", split("ordinary-split", leaf("left", ["a", "c"]), leaf("right", ["d"]), 0.61))],
    currentWorkSessionIds: ["a", "b", "missing", "invalid"], currentWorkActiveSessionId: "a",
    currentWorkPaneTree: split("cw", leaf("cw-left", ["a"], "a"), leaf("cw-right", ["b"], "b")),
  };
  const f = fixture(plain(legacy));
  await f.api.getState().load();
  assert.deepEqual(f.disk.terminalLayoutMigrationBackup.sessions, legacy.sessions);
  assert.equal(f.disk.terminalLayoutVersion, 1);
  assert.equal(f.disk.workspans[0].paneTree.ratio, 0.37);
  assert.deepEqual(f.disk.workspans[0].paneTree.first.sessionIds, ["a", "missing"]);
  assert.equal(f.disk.workspans[0].paneTree.first.activeSessionId, "a");
  assert.equal(f.disk.workspans[1].paneTree.ratio, 0.61);
  assert.deepEqual(f.disk.workspans[1].paneTree.first.sessionIds, ["c"]);
  assert.equal(f.disk.sessions.find(item => item.id === "b").tabHidden, true);
  assert.deepEqual(f.disk.currentWorkSessionIds, []);
  const first = plain(f.disk.workspans);
  await f.api.getState().load();
  assert.deepEqual(f.disk.workspans, first);
  assert.equal(f.writes.length, 2);
});

test("malformed migration repairs duplicate nodes and memberships, excludes transient and anonymous snapshots", async () => {
  const f = fixture({ sessions: [{ id: "a" }, { id: "hidden", tabHidden: true }, { id: "temp", transientBackground: true }, { id: "anon", kind: "ephemeral-pi" }],
    workspans: [workspan("old", split("s", leaf("duplicate", ["a", "a"]), leaf("duplicate", ["hidden", "temp", "anon"]), Number.NaN))],
    currentWorkSessionIds: ["hidden", "hidden"], currentWorkPaneTree: { type: "split", id: "bad" } });
  await f.api.getState().load();
  assert.deepEqual(f.disk.sessions.map(item => item.id), ["a", "hidden"]);
  const ids = f.disk.workspans.flatMap(span => span.paneTree.sessionIds ?? []);
  assert.deepEqual(ids.sort(), ["a", "hidden"]);
});

for (const failingSave of [1, 2]) test(`migration failure at save ${failingSave} retains original backup and retries without early marker`, async () => {
  const original = { sessions: [{ id: "a" }], currentWorkSessionIds: ["a"], currentWorkActiveSessionId: "a" };
  const f = fixture(plain(original));
  const save = f.store.save.bind(f.store);
  let count = 0;
  f.store.save = async () => { if (++count === failingSave) throw Error("disk"); return save(); };
  await assert.rejects(f.api.getState().load());
  assert.equal(f.api.getState().loaded, false);
  assert.notEqual(await f.store.get("terminalLayoutVersion"), 1);
  assert.deepEqual(await f.store.get("sessions"), original.sessions);
  f.store.save = save;
  await f.api.getState().load();
  assert.equal(f.disk.terminalLayoutVersion, 1);
  assert.deepEqual(f.disk.terminalLayoutMigrationBackup.sessions, original.sessions);
  assert.equal(f.disk.workspans.length, 1);
});

test("complete workspan save and exit/recovery never reimport runtime legacy membership", async () => {
  const f = fixture();
  await f.api.getState().load();
  const sessions = [{ id: "a", tabHidden: true }, { id: "b" }];
  const workspans = [workspan("one", split("s", leaf("left", ["a"]), leaf("right", ["b"])))];
  // Old disk metadata must not become runtime state or reimport after migration.
  await f.store.set("currentWorkSessionIds", ["b"]);
  await f.store.set("currentWorkPaneTree", leaf("legacy", ["b"]));
  await f.api.getState().saveWorkspans(workspans, "one", sessions);
  assert.deepEqual(f.disk.sessions, sessions);
  assert.equal(f.disk.workspans[0].paneTree.ratio, 0.37);
  assert.deepEqual(f.disk.currentWorkSessionIds, []);
  await f.exports.saveRecoverySnapshot(() => ({ sessions, workspans, activeWorkspanId: "one", activeSessionId: "b" }));
  await f.exports.saveRestorableExitSnapshot({ sessions, splits: [], workspans, activeWorkspanId: "one", activeSessionId: "b" });
  assert.equal(f.disk.currentWorkPaneTree, null);
  assert.equal(f.disk.sessions[0].tabHidden, true);
});

test("migration queued behind older writes cannot publish loaded/marker before disk success", async () => {
  const f = fixture({ sessions: [{ id: "a" }], currentWorkSessionIds: ["a"] });
  const barrier = f.loadModule(resolve(dirname(fileURLToPath(import.meta.url)), "sessionPersistenceBarrier.ts"));
  let release;
  const older = barrier.queueSessionPersistence(() => new Promise(done => { release = done; }));
  await Promise.resolve();
  const loading = f.api.getState().load();
  await Promise.resolve();
  assert.equal(f.api.getState().loaded, false);
  assert.equal(f.disk.terminalLayoutVersion, undefined);
  release();
  await older;
  await loading;
  assert.equal(f.api.getState().loaded, true);
  assert.equal(f.disk.terminalLayoutVersion, 1);
});

test("canonical remap retains hidden pane geometry, pruning only failed restore IDs", () => {
  const f = fixture();
  const migration = f.loadModule(resolve(dirname(fileURLToPath(import.meta.url)), "terminalLayoutMigration.ts"));
  const workspanApi = f.loadModule(resolve(dirname(fileURLToPath(import.meta.url)), "terminalWorkspan.ts"));
  const result = migration.canonicalizeTerminalSnapshot({ sessions: [{ id: "a" }, { id: "b", tabHidden: true }, { id: "failed" }],
    currentWorkPaneTree: split("cw", leaf("left", ["a", "failed"], "a"), leaf("right", ["b"])), currentWorkSessionIds: ["a", "b"] }, true);
  const restored = workspanApi.restoreTerminalWorkspans(result.workspans, { a: "new-a", b: "b" });
  assert.equal(restored[0].paneTree.ratio, 0.37);
  assert.deepEqual(plain(restored[0].paneTree.first.sessionIds), ["new-a"]);
  assert.deepEqual(plain(restored[0].paneTree.second.sessionIds), ["b"]);
});

for (const migration of [false, true]) {
  // Complete writes: eight keys, save, marker set, save. Migration also sets backup.
  for (let boundary = 1; boundary <= (migration ? 12 : 11); boundary++) {
    test(`${migration ? "migration" : "complete"} rollback at operation ${boundary}: cache, later write and fresh process`, async () => {
      const original = { sessions: [{ id: "old" }], workspans: [], activeSessionId: "old",
        activeWorkspanId: null, splits: [], currentWorkSessionIds: ["old"],
        currentWorkActiveSessionId: "old", currentWorkPaneTree: null,
        ...(migration ? {} : { terminalLayoutVersion: 1 }) };
      const f = fixture(plain(original));
      const set = f.store.set.bind(f.store), save = f.store.save.bind(f.store);
      let operation = 0;
      const check = () => { if (++operation === boundary) throw Error(`boundary ${boundary}`); };
      f.store.set = async (...args) => { check(); return set(...args); };
      f.store.save = async () => { check(); return save(); };
      await assert.rejects(migration ? f.api.getState().load() : f.api.getState().saveWorkspans([], null, [{ id: "new" }]));
      assert.equal(f.api.getState().loaded, false);
      assert.deepEqual(await f.store.get("sessions"), original.sessions);
      assert.equal(await f.store.get("terminalLayoutVersion"), original.terminalLayoutVersion ?? null);
      // Reopen from disk without using repaired cache (after either save boundary).
      const fresh = fixture(plain(f.disk));
      await fresh.api.getState().load();
      assert.equal(fresh.api.getState().sessions.length, 1);
      assert.equal(new Set(fresh.api.getState().sessions.map(s => s.id)).size, 1);
      f.store.set = set; f.store.save = save;
      await f.api.getState().saveSessions(original.sessions);
      assert.equal(f.disk.terminalLayoutVersion ?? null, original.terminalLayoutVersion ?? null);
      assert.deepEqual(f.disk.workspans, original.workspans);
      await f.api.getState().load();
      assert.equal(f.disk.terminalLayoutVersion, 1);
    });
  }
}

test("decoder skips null/invalid IDs and deterministically keeps first valid duplicate; backup is lossless", async () => {
  const records = [null, false, [], {}, { id: 4 }, { id: "" }, { id: "  " }, { id: "a", title: "first" }, { id: "a", title: "second" }, { id: "b" }];
  const f = fixture({ sessions: records });
  await f.api.getState().load();
  assert.deepEqual(f.disk.sessions, [{ id: "a", title: "first" }, { id: "b" }]);
  assert.deepEqual(f.disk.terminalLayoutMigrationBackup.sessions, records);
  assert.equal(f.api.getState().sessions.length, 2);
});

test("recovery publishes the committed replacement IDs and active leaf wins stale selectors across saves", async () => {
  const f = fixture();
  await f.api.getState().load();
  const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const spans = [workspan("one", leaf("left", ["a"])),
    { ...workspan("two", leaf("left", ["b", "c"], "c")), activeSessionId: "b" }];
  await f.api.getState().saveWorkspans(spans, "two", sessions);
  assert.equal(f.api.getState().activeSessionId, "c");
  assert.equal(f.disk.activeSessionId, "c");
  await f.api.getState().saveActiveSessionId("a");
  assert.equal(f.disk.activeSessionId, "c");
  spans[1].paneTree.activeSessionId = "b";
  await f.api.getState().saveWorkspans(spans, "two", sessions);
  assert.equal(f.disk.activeSessionId, "b");
  const replacement = { sessions: [{ id: "replacement" }], workspans: [workspan("replacement-span", leaf("left", ["replacement"]))], activeWorkspanId: "replacement-span", activeSessionId: "b" };
  await f.exports.saveRecoverySnapshot(() => replacement);
  assert.equal(f.api.getState().activeSessionId, "replacement");
  assert.equal(f.api.getState().activeWorkspanId, "replacement-span");
  assert.deepEqual(plain(f.api.getState().workspans), f.disk.workspans);
  assert.deepEqual(plain(f.api.getState().sessions), f.disk.sessions);
});

test("actual App sessions-stage callback propagates a one-shot migration failure, never authorizing clear; reload retries", async () => {
  const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../../../app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(app) === "runStartupStage" && node.arguments[0]?.text === "sessions") callback = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(app);
  assert.ok(callback, "actual startup callback");
  const source = ts.transpileModule(`exports.run = ${callback.getText(app)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const original = { sessions: [{ id: "a" }], currentWorkSessionIds: ["a"] };
  const f = fixture(plain(original));
  const save = f.store.save.bind(f.store);
  let once = true;
  f.store.save = async () => { if (once) { once = false; throw Error("actual migration disk failure"); } return save(); };
  const exported = {};
  vm.runInNewContext(source, { exports: exported, useSessionStore: f.api });
  let clearAuthorized = false;
  await assert.rejects(async () => { await exported.run(); clearAuthorized = true; }, /actual migration disk failure/);
  assert.equal(clearAuthorized, false);
  assert.deepEqual(f.disk.sessions, original.sessions);
  const reopened = fixture(plain(f.disk));
  await reopened.api.getState().load();
  assert.equal(reopened.api.getState().sessions[0].id, "a");
});

test("failed rollback fences unrelated queued writes until every cached key is repaired", async () => {
  const f = fixture({ sessions: [{ id: "old" }], terminalLayoutVersion: 1 });
  const set = f.store.set.bind(f.store), save = f.store.save.bind(f.store);
  let broken = false;
  f.store.set = async (...args) => { if (broken) throw Error("cache unavailable"); return set(...args); };
  f.store.save = async () => { broken = true; throw Error("disk unavailable"); };
  await assert.rejects(f.api.getState().saveWorkspans([], null, [{ id: "new" }]), /disk unavailable/);
  await assert.rejects(f.api.getState().saveSessions([{ id: "unrelated" }]), /cache unavailable/);
  assert.equal(f.disk.sessions[0].id, "old");
  broken = false; f.store.save = save;
  await f.api.getState().saveSessions([{ id: "old" }]);
  assert.equal(f.disk.sessions[0].id, "old");
  assert.equal(f.disk.workspans, null);
  assert.equal(f.disk.terminalLayoutVersion, 1);
});

test("versioned malformed sessions are backed up before canonical publication", async () => {
  const records = [null, { id: "a" }, { id: "a", title: "duplicate" }];
  const f = fixture({ sessions: records, terminalLayoutVersion: 1 });
  await f.api.getState().load();
  assert.deepEqual(f.disk.terminalLayoutMigrationBackup.sessions, records);
  assert.deepEqual(f.disk.sessions, [{ id: "a" }]);
});
