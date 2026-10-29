import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function production(path, dependencies = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, require(name) {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, console });
  return exports;
}
const persistence = production("src/shared/preferences/settingsPersistence.ts");
const roots = production("src/shared/preferences/worktreeRootPersistence.ts");
const { createWorktreeRootEditor } = production("src/features/settings/lib/worktreeRootEditor.ts");
const { worktreeRootErrorKey } = production("src/shared/preferences/worktreeRootErrors.ts");
const sync = production("src/features/sync/lib/syncSettings.ts");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(options = {}) {
  const cache = { unrelated: "keep", ...(options.missing ? {} : { worktreeDefaultRoot: "D:/old" }) };
  let disk = { ...cache };
  let published = "D:/old";
  const calls = [];
  let sets = 0, saves = 0;
  const store = {
    async get(key) { calls.push("get"); return cache[key]; },
    async set(key, value) {
      calls.push(`set:${key}:${value}`);
      cache[key] = value;
      // Model autoSave:0 as immediate write, including rejected post-mutation set.
      disk = { ...cache };
      if (key === "worktreeDefaultRoot" && ++sets === options.failSet) throw new Error("set failed");
    },
    async delete(key) { calls.push("delete"); delete cache[key]; disk = { ...cache }; },
    async save() {
      calls.push("save");
      ++saves;
      if (options.gate && saves === 1) await options.gate.promise;
      if (options.failSaves?.includes(saves)) throw new Error(`save failed ${saves}`);
      disk = { ...cache };
    },
    async entries() { return Object.entries(cache); },
  };
  const boundary = persistence.createSettingsPersistence(store);
  const save = roots.createWorktreeRootSaver(async () => boundary, async root => {
    calls.push(`validate:${root}`);
    if (root === "invalid") throw new Error("worktree_default_root_invalid");
    return root.trim();
  }, root => { calls.push("publish"); published = root; });
  return { cache, calls, boundary, save, disk: () => disk, published: () => published };
}

test("load normalization is display-only and preserves strings/default empty", () => {
  assert.equal(roots.loadedWorktreeRoot(undefined), "");
  assert.equal(roots.loadedWorktreeRoot(12), "");
  assert.equal(roots.loadedWorktreeRoot("D:/saved"), "D:/saved");
});

test("validate -> set -> explicit awaited save -> publish; immediate create observes disk", async () => {
  const gate = deferred();
  const s = setup({ gate });
  const pending = s.save(" D:/new ");
  await new Promise(r => setImmediate(r));
  assert.equal(s.published(), "D:/old");
  assert.equal(s.calls.at(-1), "save");
  await assert.rejects(s.save("D:/duplicate"), /save_pending/);
  gate.resolve();
  assert.equal(await pending, "D:/new");
  assert.equal(s.disk().worktreeDefaultRoot, "D:/new");
  assert.equal(s.published(), "D:/new");
  assert.deepEqual(s.calls, ["validate: D:/new ", "get", "set:worktreeDefaultRoot:D:/new", "save", "publish"]);
});

test("validation failure performs no writes", async () => {
  const s = setup();
  await assert.rejects(s.save("invalid"), /worktree_default_root_invalid/);
  assert.equal(s.disk().worktreeDefaultRoot, "D:/old");
  assert.deepEqual(s.calls, ["validate:invalid"]);
});

for (const options of [{ failSaves: [1] }, { failSet: 1 }, { missing: true, failSaves: [1] }]) {
  test(`failure compensates actual cache and disk despite immediate auto-save: ${JSON.stringify(options)}`, async () => {
    const s = setup(options);
    await assert.rejects(s.save("D:/draft"), roots.WorktreeRootSaveError);
    assert.equal(s.cache.worktreeDefaultRoot, options.missing ? undefined : "D:/old");
    assert.equal(s.disk().worktreeDefaultRoot, options.missing ? undefined : "D:/old");
    assert.equal(s.published(), "D:/old");
    await s.boundary.set("unrelated", "later");
    assert.notEqual(s.disk().worktreeDefaultRoot, "D:/draft");
  });
}

test("shared local writer waits until rollback finishes; unrelated fields survive", async () => {
  const gate = deferred();
  const s = setup({ gate, failSaves: [1] });
  const saving = s.save("D:/draft");
  await new Promise(r => setImmediate(r));
  const other = s.boundary.set("unrelated", "changed");
  assert.equal(s.cache.unrelated, "keep");
  gate.resolve();
  await assert.rejects(saving, roots.WorktreeRootSaveError);
  await other;
  assert.equal(s.disk().worktreeDefaultRoot, "D:/old");
  assert.equal(s.disk().unrelated, "changed");
});

test("rollback failures are reported; unresolved cache blocks subsequent automatic writers until retry", async () => {
  const s = setup({ failSaves: [1], failSet: 2 });
  await assert.rejects(s.save("D:/draft"), error => error.rollbackErrors.length === 1);
  await assert.rejects(s.boundary.set("unrelated", "later"), /cache_unresolved/);
  assert.equal(s.published(), "D:/old");
  await s.save("D:/reconciled");
  await s.boundary.set("unrelated", "later");
  assert.equal(s.disk().worktreeDefaultRoot, "D:/reconciled");
});

test("rollback save failure remains visible even when cache was restored", async () => {
  const s = setup({ failSaves: [1, 2] });
  await assert.rejects(s.save("D:/draft"), error => error.rollbackErrors.length === 1);
  assert.equal(s.published(), "D:/old");
  assert.equal(s.cache.worktreeDefaultRoot, "D:/old");
});

test("editor loads actual home; cancelled picker unchanged; failure keeps draft; restore default saves empty", async () => {
  const saved = [];
  let fail = true;
  const editor = createWorktreeRootEditor("D:/old", {
    getDefaultRoot: async () => "C:/Users/person/Worktrees",
    pick: async () => null,
    save: async root => { saved.push(root); if (fail) throw new Error("failed"); return root.trim(); },
  });
  await editor.loadDefault();
  assert.equal(editor.getSnapshot().defaultRoot, "C:/Users/person/Worktrees");
  editor.edit("D:/draft");
  await editor.pick();
  assert.equal(editor.getSnapshot().draft, "D:/draft");
  await editor.save();
  assert.equal(editor.getSnapshot().draft, "D:/draft");
  assert.equal(editor.getSnapshot().saved, false);
  assert.match(String(editor.getSnapshot().error), /failed/);
  fail = false;
  await editor.restoreDefault();
  assert.deepEqual(saved, ["D:/draft", ""]);
  assert.equal(editor.getSnapshot().draft, "");
  assert.equal(editor.getSnapshot().saved, true);
});

test("editor synchronous busy guard prevents duplicate picker/save/reset; dirty external loads retained", async () => {
  const gate = deferred();
  let count = 0;
  const editor = createWorktreeRootEditor("old", {
    getDefaultRoot: async () => "home/Worktrees", pick: async () => "picked",
    save: async root => { ++count; await gate.promise; return root; },
  });
  editor.sync("loaded");
  assert.equal(editor.getSnapshot().draft, "loaded");
  editor.edit("draft"); editor.sync("external");
  assert.equal(editor.getSnapshot().draft, "draft");
  const saving = editor.save();
  await editor.save(); await editor.pick(); await editor.restoreDefault(); editor.edit("not allowed");
  assert.equal(count, 1);
  assert.equal(editor.getSnapshot().draft, "draft");
  gate.resolve(); await saving;
  await editor.pick(); assert.equal(editor.getSnapshot().draft, "picked");
});

test("local machine root excluded from export whitelist and import iteration", () => {
  assert.equal(sync.SETTING_BACKUP_POLICY.worktreeDefaultRoot, "excluded");
  assert.equal(sync.SYNCABLE_SETTING_KEYS.includes("worktreeDefaultRoot"), false);
  const incoming = { language: "en-US", worktreeDefaultRoot: "D:/other-machine" };
  assert.equal(sync.pickSyncableSettings(incoming).worktreeDefaultRoot, undefined);
  const local = { worktreeDefaultRoot: "D:/local" };
  for (const key of sync.SYNCABLE_SETTING_KEYS) if (key in incoming) local[key] = incoming[key];
  assert.equal(local.worktreeDefaultRoot, "D:/local");
  const importSource = readFileSync(new URL("../src/features/sync/api/syncStore.ts", import.meta.url), "utf8");
  assert.match(importSource, /async function applyPreferences[\s\S]*?for \(const key of SYNCABLE_SETTING_KEYS\)/);
});

test("all locked error codes map to translated guidance and unknown diagnostics remain raw", () => {
  for (const [code, key] of [["worktree_default_root_invalid", "rootInvalid"], ["worktree_default_root_read_failed", "rootReadFailed"],
    ["worktree_default_root_inside_repository", "rootInsideRepository"], ["home_dir_unavailable", "rootHomeUnavailable"]]) {
    assert.equal(worktreeRootErrorKey(code), `worktree.settings.${key}`);
  }
  assert.equal(worktreeRootErrorKey("unexpected"), null);
});

test("store uses locked IPC, active store path, exclusive persistence and dedicated update guard; under 2000 lines", () => {
  const source = readFileSync(new URL("../src/shared/preferences/settingsStore.ts", import.meta.url), "utf8");
  assert.match(source, /createSettingsPersistence\(await Store.load\(paths.settingsStorePath/);
  assert.match(source, /git_worktree_validate_default_root", \{ root \}/);
  assert.match(source, /key === "worktreeDefaultRoot"\) throw/);
  assert.match(source, /entries.worktreeDefaultRoot = loadedWorktreeRoot/);
  assert.ok(source.split("\n").length <= 2000);
});
