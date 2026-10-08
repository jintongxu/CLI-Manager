import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./sessionStore.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require(id) {
    if (id === "zustand") return { create };
    if (id.includes("plugin-store")) return { Store: { load: async () => store } };
    if (id.includes("appPaths")) return { getCliManagerDataPaths: async () => ({ sessionsStorePath: "sessions.dev.json" }) };
    if (id.includes("singleFlight")) return { singleFlight: fn => fn };
    if (id === "./terminalWorkspan") return { migrateTerminalWorkspans: v => v ?? [], sanitizeTerminalWorkspans: v => v };
    throw new Error(id);
  } });
  return { api: exports.useSessionStore, disk, writes, fail(value) { fail = value; } };
}

test("whole session snapshot explicitly saves naming/identity and reloads legacy verbatim without new persisted keys", async () => {
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

test("failed save is observable; retry saves full latest snapshot", async () => {
  const f = fixture({ sessions: [{ id: "legacy", title: "Old" }] });
  f.fail(true);
  await assert.rejects(f.api.getState().saveSessions([{ id: "new", title: "Pi · 1" }]));
  assert.equal(f.disk.sessions[0].id, "legacy");
  f.fail(false);
  await f.api.getState().saveSessions([{ id: "new", title: "Pi · 2", titleNaming: { source: "auto", base: "Pi", ordinal: 2 } }]);
  assert.equal(f.disk.sessions[0].title, "Pi · 2");
});
