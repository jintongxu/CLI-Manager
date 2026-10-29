import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the complete production module (not extracted declarations/source regex).
function moduleFrom(path, dependencies = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, console, window: { matchMedia: () => ({ matches: systemDark }) } });
  return exports;
}
let systemDark = true;
const production = moduleFrom("src/shared/preferences/appearanceTransaction.ts");
const settingsProduction = moduleFrom("src/shared/preferences/settingsAppearance.ts", {
  "./appearanceTransaction": production,
  "../lib/terminalThemes": { resolveAutoTerminalThemeId: mode => `${mode}-auto` },
});
const initial = () => ({ theme: "system", lightThemePalette: "sea-salt", darkThemePalette: "graphite",
  terminalThemeMode: "system", terminalThemeName: "auto", loaded: true,
  language: "en-US", fontSize: 16, terminalBackground: { enabled: true }, resolvedTheme: "dark" });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(persist = async () => {}) {
  let state = initial();
  const disk = { ...state };
  const writes = [];
  const service = settingsProduction.createSettingsAppearance(() => state,
    patch => { state = { ...state, ...patch }; }, async (key, value) => {
      writes.push([key, value]);
      await persist(key, value, writes.length);
      disk[key] = value;
    });
  return { ...service, tx: service.transaction, writes, disk, get: () => state,
    unrelated: () => { state = { ...state, language: "zh-CN", fontSize: 20 }; } };
}

test("begin/preview are atomic memory-only and runtime-whitelist unrelated settings", async () => {
  const s = setup();
  const owner = await s.tx.begin();
  s.tx.preview(owner, { theme: "light", darkThemePalette: "tokyo-night-storm", language: "bad" });
  assert.equal(s.get().resolvedTheme, "light");
  assert.equal(s.get().language, "en-US");
  assert.equal(s.writes.length, 0);
  s.unrelated();
  systemDark = false;
  await s.tx.cancel(owner);
  assert.equal(s.get().theme, "system");
  assert.equal(s.get().resolvedTheme, "light", "system rollback uses current OS, not captured resolvedTheme");
  assert.equal(s.get().language, "zh-CN");
  assert.equal(s.get().fontSize, 20);
  assert.equal(s.get().terminalBackground.enabled, true);
  assert.equal(s.writes.length, 0);
  systemDark = true;
});

test("dirty keys only; repeated confirm shares promise; close during save never rolls back success", async () => {
  const gate = deferred();
  const s = setup(async () => gate.promise);
  const owner = await s.tx.begin();
  s.tx.preview(owner, { theme: "light", terminalThemeName: "custom" });
  const confirm = s.tx.confirm(owner);
  assert.equal(s.tx.confirm(owner), confirm);
  assert.equal(s.tx.getStatus().phase, "confirming");
  assert.equal(s.tx.preview(owner, { theme: "dark" }), false);
  const close = s.tx.cancel(owner);
  assert.equal(close, confirm);
  gate.resolve();
  await close;
  assert.deepEqual(s.writes, [["theme", "light"], ["terminalThemeName", "custom"]]);
  assert.equal(s.get().theme, "light");
  assert.equal(s.tx.getStatus().phase, "idle");
});

test("each forward failure compensates attempted keys in reverse; close settles failure explicitly", async () => {
  for (const failureAt of [1, 2, 3, 4, 5]) {
    const s = setup(async (_k, _v, n) => { if (n === failureAt) throw new Error("disk write"); });
    const owner = await s.tx.begin();
    s.tx.preview(owner, { theme: "light", lightThemePalette: "warm-paper", darkThemePalette: "tokyo-night-storm",
      terminalThemeMode: "independent", terminalThemeName: "new" });
    const confirm = s.tx.confirm(owner);
    const closed = s.tx.cancel(owner);
    await assert.rejects(closed, error => error.name === "AppearanceCommitError" && !error.compensationErrors.length);
    await assert.rejects(confirm);
    assert.equal(s.get().theme, "system");
    assert.equal(s.disk.theme, "system");
    assert.equal(s.tx.getStatus().phase, "error");
    const forwards = s.writes.slice(0, failureAt).map(([key]) => key);
    assert.deepEqual(s.writes.slice(failureAt).map(([key]) => key), forwards.reverse());
  }
});

test("compensation failure is observable with both original and compensation errors", async () => {
  const s = setup(async (_k, _v, n) => { if (n >= 2) throw new Error(`fault-${n}`); });
  const owner = await s.tx.begin();
  s.tx.preview(owner, { theme: "light", terminalThemeName: "new" });
  await assert.rejects(s.tx.confirm(owner), error => {
    assert.equal(error.writeError.message, "fault-2");
    assert.equal(error.compensationErrors.length, 2);
    assert.equal(s.tx.getStatus().error, error);
    return true;
  });
  assert.equal(s.get().theme, "system");
  assert.equal(s.disk.theme, "light", "partial persistence is not misreported as rolled back");
});

test("pending old setters complete before async begin captures baseline, never overwrite preview", async () => {
  const gate = deferred();
  const s = setup(async (_k, _v, n) => { if (n === 1) await gate.promise; });
  const old = s.setTheme("dark");
  const opening = s.tx.begin();
  await Promise.resolve();
  assert.equal(s.get().theme, "system");
  gate.resolve();
  await old;
  const owner = await opening;
  s.tx.preview(owner, { theme: "light" });
  await Promise.resolve();
  assert.equal(s.get().theme, "light");
  await s.tx.cancel(owner);
  assert.equal(s.get().theme, "dark");
});

test("external setters invalidate owner and queue in invocation order even with reverse completion pressure", async () => {
  const gate = deferred();
  const s = setup(async (_k, _v, n) => { if (n === 1) await gate.promise; });
  const old = await s.tx.begin();
  s.tx.preview(old, { theme: "light", terminalThemeName: "draft" });
  const first = s.setTheme("dark");
  const second = s.setTerminalThemeMode("independent");
  const opening = s.tx.begin();
  await Promise.resolve();
  assert.equal(s.writes.length, 1, "later persistence cannot race earlier setter");
  gate.resolve();
  await Promise.all([first, second]);
  const owner = await opening;
  s.tx.preview(owner, { theme: "light" });
  await s.tx.cancel(old);
  assert.equal(s.get().theme, "light", "stale cancel cannot touch new owner");
  assert.equal(s.get().terminalThemeName, "dark-auto", "external factory uses committed state, not preview");
  assert.equal(s.tx.preview(old, { theme: "system" }), false);
  await assert.rejects(s.tx.confirm(old));
  await s.tx.cancel(owner);
  assert.equal(s.get().theme, "dark");
});

test("external write waits for confirm compensation before applying; stale close cannot revert it", async () => {
  for (const fail of [false, true]) {
    const gate = deferred();
    const s = setup(async (_k, _v, n) => { if (n === 1) { await gate.promise; if (fail) throw new Error("fail"); } });
    const owner = await s.tx.begin();
    s.tx.preview(owner, { theme: "light" });
    const saving = s.tx.confirm(owner);
    const external = s.setTheme("dark");
    const outcome = saving.catch(error => error);
    gate.resolve();
    await outcome;
    await external;
    await s.tx.cancel(owner);
    assert.equal(s.get().theme, "dark");
    assert.equal(s.disk.theme, "dark");
  }
});

test("subscriptions expose immutable status without leaking owner; errors don't poison queue", async () => {
  const s = setup();
  let notifications = 0;
  const unsubscribe = s.tx.subscribe(() => { notifications++; });
  const owner = await s.tx.begin();
  await assert.rejects(s.tx.begin());
  const oldStatus = s.tx.getStatus();
  s.tx.preview(owner, { theme: "light" });
  assert.ok(s.tx.getStatus().revision > oldStatus.revision);
  assert.equal("owner" in s.tx.getStatus(), false);
  assert.ok(Object.isFrozen(s.tx.getStatus().dirtyKeys));
  await s.tx.confirm(owner);
  unsubscribe();
  assert.ok(notifications >= 4);
  const next = await s.tx.begin();
  await s.tx.cancel(next);
});

test("confirm with no changes writes nothing; confirm rejects after external invalidation", async () => {
  const s = setup();
  const owner = await s.tx.begin();
  s.tx.preview(owner, { theme: "light" });
  s.tx.preview(owner, { theme: "system" });
  await s.tx.confirm(owner);
  assert.equal(s.writes.length, 0);
  const next = await s.tx.begin();
  s.tx.preview(next, { theme: "light" });
  const external = s.setTheme("dark");
  await assert.rejects(s.tx.confirm(next));
  await external;
  assert.equal(s.get().theme, "dark");
});

test("write queued after begin but before begin resolves invalidates preview safely", async () => {
  const s = setup();
  const opening = s.tx.begin();
  const external = s.setTheme("dark");
  const owner = await opening;
  s.tx.preview(owner, { theme: "light" });
  const saved = s.tx.confirm(owner).catch(error => error);
  await external;
  await saved;
  assert.equal(s.get().theme, "dark");
  assert.equal(s.disk.theme, "dark");
  assert.equal(s.tx.getStatus().phase, "idle");
});

const syncSettingsProduction = moduleFrom("src/features/sync/lib/syncSettings.ts");
function backupReader(s) {
  return moduleFrom("src/features/sync/lib/backupSettingsSnapshot.ts", {
    "../../../shared/preferences/settingsStore": {
      useSettingsStore: { getState: s.get }, appearancePreview: s.tx,
    },
    "./syncSettings": syncSettingsProduction,
  }).readBackupPreferences;
}

test("production backup snapshot uses committed subset during preview and pending confirm, without cancelling owner", async () => {
  const gate = deferred();
  const s = setup(async () => gate.promise);
  const readBackup = backupReader(s);
  const owner = await s.tx.begin();
  s.tx.preview(owner, { theme: "light", darkThemePalette: "tokyo-night-storm", terminalThemeName: "draft" });
  s.unrelated();
  const snapshot = readBackup();
  assert.equal(snapshot.theme, "system");
  assert.equal(snapshot.darkThemePalette, "graphite");
  assert.equal(snapshot.terminalThemeName, "auto");
  assert.equal(snapshot.language, "zh-CN");
  assert.equal(snapshot.fontSize, 20);
  assert.equal("terminalBackground" in snapshot, false, "existing backup exclusion is unchanged");
  assert.equal(s.get().theme, "light", "export does not end the preview");
  assert.equal(s.tx.preview(owner, { terminalThemeName: "confirmed" }), true);
  const saving = s.tx.confirm(owner);
  await Promise.resolve();
  assert.equal(readBackup().theme, "system", "exit/local/cloud snapshots cannot see partial confirmation");
  gate.resolve();
  await saving;
  assert.equal(readBackup().theme, "light");
  assert.equal(readBackup().terminalThemeName, "confirmed");
  assert.equal(snapshot.theme, "system", "collected snapshot remains detached");
  const committed = s.tx.getCommittedValues();
  committed.theme = "dark";
  assert.equal(s.tx.getCommittedValues().theme, "light");
});

test("backup remains at baseline after failed confirm/compensation and does not change stale owner semantics", async () => {
  const s = setup(async (_k, _v, n) => { if (n >= 2) throw Error("disk unavailable"); });
  const readBackup = backupReader(s);
  const old = await s.tx.begin();
  s.tx.preview(old, { theme: "light", terminalThemeName: "draft" });
  await assert.rejects(s.tx.confirm(old));
  assert.equal(readBackup().theme, "system");
  const next = await s.tx.begin();
  s.tx.preview(next, { theme: "dark" });
  await s.tx.cancel(old);
  assert.equal(s.get().theme, "dark");
  assert.equal(readBackup().theme, "system");
  await s.tx.cancel(next);
  assert.equal(s.tx.getStatus().phase, "error", "cancel cannot publish success while persistence is unknown");
});

test("failed compensation keys reconcile on same-value setter and zero-dirty confirm before success", async () => {
  for (const retry of ["setter", "confirm", "other-key"]) {
    const s = setup(async (_k, _v, n) => { if (n >= 2 && n <= 4) throw Error(`fault-${n}`); });
    const owner = await s.tx.begin();
    s.tx.preview(owner, { theme: "light", terminalThemeName: "draft" });
    await assert.rejects(s.tx.confirm(owner));
    assert.equal(s.disk.theme, "light");
    assert.deepEqual([...s.tx.getStatus().unresolvedKeys], ["theme", "terminalThemeName"]);
    const start = s.writes.length;
    if (retry === "setter") await s.setTheme("system");
    else {
      const next = await s.tx.begin();
      if (retry === "other-key") s.tx.preview(next, { darkThemePalette: "tokyo-night-storm" });
      await s.tx.confirm(next);
    }
    assert.ok(s.writes.slice(start).some(([k, v]) => k === "theme" && v === "system"));
    assert.ok(s.writes.slice(start).some(([k, v]) => k === "terminalThemeName" && v === "auto"));
    assert.equal(s.disk.theme, "system");
    assert.equal(s.disk.terminalThemeName, "auto");
    assert.deepEqual([...s.tx.getStatus().unresolvedKeys], []);
    assert.equal(s.tx.getStatus().phase, "idle");
  }
});

test("failed reconciliation retains unattempted uncertain keys and queue converges only after successful retry", async () => {
  let available = false;
  let failures = 0;
  const s = setup(async () => { if (!available && ++failures >= 2) throw Error("offline"); });
  const owner = await s.tx.begin();
  s.tx.preview(owner, { theme: "light", terminalThemeName: "draft" });
  await assert.rejects(s.tx.confirm(owner));
  const next = await s.tx.begin();
  await assert.rejects(s.tx.confirm(next));
  assert.deepEqual([...s.tx.getStatus().unresolvedKeys], ["theme", "terminalThemeName"]);
  await assert.rejects(s.setTheme("system"));
  assert.equal(s.tx.getStatus().phase, "error");
  available = true;
  const same = s.setTheme("system");
  const other = s.tx.write(() => ({ darkThemePalette: "tokyo-night-storm" }));
  await Promise.all([same, other]);
  assert.equal(s.disk.theme, "system");
  assert.equal(s.disk.terminalThemeName, "auto");
  assert.equal(s.disk.darkThemePalette, "tokyo-night-storm");
  assert.equal(s.tx.getStatus().phase, "idle");
  assert.deepEqual([...s.tx.getStatus().unresolvedKeys], []);
});
