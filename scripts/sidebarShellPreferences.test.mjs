import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function fixture(initial = {}) {
  const disk = new Map(Object.entries(initial));
  const cache = new Map();
  const nativeStore = { entries: async () => [...disk], set: async (k, v) => { disk.set(k, v); } };
  function load(file, expose = "") {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8") + expose, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, console, TextEncoder, TextDecoder, setTimeout, clearTimeout,
      window: { matchMedia: () => ({ matches: true }), setTimeout, clearTimeout },
      require(name) {
        if (name === "@tauri-apps/plugin-store") return { Store: { load: async () => nativeStore } };
        if (name === "@tauri-apps/api/core") return { invoke: async () => {} };
        if (name.endsWith("/appPaths")) return { getCliManagerDataPaths: async () => ({ settingsStorePath: "test" }) };
        if (name.endsWith("/shell")) return { getOsPlatform: async () => "windows", defaultShellForOs: () => "powershell", isWindowsOnlyShellKey: () => true };
        if (name.endsWith("/assetUrl")) return { backgroundImageExists: async () => true };
        if (!name.startsWith(".")) return require(name);
        const base = resolve(dirname(file), name);
        const path = [base, base + ".ts", base + ".tsx"].find(p => existsSync(p));
        if (!path) throw Error(`Missing dependency ${name}`);
        return load(path);
      },
    });
    return exports;
  }
  const settings = load("src/shared/preferences/settingsStore.ts");
  // Expose the real private entry without replacing or extracting its implementation.
  const sync = load("src/features/sync/api/syncStore.ts", "\nexport { applyPreferences };\n");
  return { ...settings, applyPreferences: sync.applyPreferences, disk };
}

test("shell visibility defaults on for missing, legacy and malformed preferences", async () => {
  for (const stored of [undefined, null, false, "invalid", 7, [], {}, { files: false, stats: false }, { shell: "false" }]) {
    const f = fixture({ terminalToolbarVisibility: stored });
    assert.equal(f.useSettingsStore.getState().terminalToolbarVisibility.shell, true);
    await f.useSettingsStore.getState().load();
    const visibility = f.useSettingsStore.getState().terminalToolbarVisibility;
    assert.equal(visibility.shell, true);
    assert.equal(visibility.files, stored?.files === false ? false : true);
    assert.equal(visibility.stats, stored?.stats === false ? false : true);
  }
});

test("explicit shell visibility survives load, update and reload without changing siblings", async () => {
  const f = fixture({ terminalToolbarVisibility: { shell: false, files: false, replay: true, showText: true } });
  await f.useSettingsStore.getState().load();
  const original = { ...f.useSettingsStore.getState().terminalToolbarVisibility };
  assert.equal(original.shell, false);
  for (const shell of [true, false]) {
    const next = { ...original, shell };
    await f.useSettingsStore.getState().update("terminalToolbarVisibility", next);
    assert.deepEqual(f.disk.get("terminalToolbarVisibility"), next);
    await f.useSettingsStore.getState().load();
    assert.deepEqual({ ...f.useSettingsStore.getState().terminalToolbarVisibility }, next);
  }
});

test("extracted migrations preserve public exports, defaults and boolean handling", () => {
  const f = fixture();
  const defaults = f.migrateTerminalToolbarVisibility(undefined);
  assert.deepEqual({ ...f.migrateTerminalToolbarVisibility({}) }, { ...defaults });
  assert.equal(defaults.replay, false);
  assert.equal(defaults.systemResources, false);
  assert.equal(defaults.showText, false);
  for (const shell of [false, true]) {
    const input = Object.fromEntries(Object.keys(defaults).map(key => [key, shell]));
    assert.deepEqual({ ...f.migrateTerminalToolbarVisibility(input) }, input);
  }
  assert.equal("unknown" in f.migrateTerminalToolbarVisibility({ unknown: false }), false);
  defaults.shell = false;
  assert.equal(f.migrateTerminalToolbarVisibility(undefined).shell, true);
  assert.deepEqual({ ...f.migrateSidebarToolbarVisibility({ stats: false, gitChanges: "false" }) }, { stats: false, gitChanges: true });
});

test("toolbar order migration retains existing behavior for the fixed shell slot", async () => {
  const f = fixture({ terminalToolbarOrder: ["stats", "files", "invalid", 7] });
  await f.useSettingsStore.getState().load();
  const order = f.useSettingsStore.getState().terminalToolbarOrder;
  assert.deepEqual(Array.from(order.slice(0, 2)), ["stats", "files"]);
  assert.equal(order.includes("invalid"), false);
  assert.equal(order.includes("shell"), false);
  const custom = f.migrateTerminalToolbarOrder(["shell", "stats"]);
  assert.equal(custom[0], "stats");
  assert.equal(custom.includes("shell"), false);
});

test("sidebar display option uses the shared shell label and settings remain under the line cap", () => {
  const page = readFileSync("src/features/settings/components/pages/SidebarSettingsPage.tsx", "utf8");
  assert.match(page, /key: "shell", labelKey: "terminal\.panel\.shell"/);
  const source = readFileSync("src/shared/preferences/settingsStore.ts", "utf8");
  assert.ok(source.trimEnd().split(/\r?\n/).length < 2000);
});

test("bottom terminal restored height defaults, sanitizes, persists and reloads", async () => {
  const f = fixture({ auxiliaryTerminalHeight: "broken" });
  assert.equal(f.useSettingsStore.getState().auxiliaryTerminalHeight, 240);
  await f.useSettingsStore.getState().load();
  assert.equal(f.useSettingsStore.getState().auxiliaryTerminalHeight, 240);
  for (const [input, expected] of [[321.4, 321], [-10, 80], [10000, 2000], [NaN, 240]]) {
    await f.useSettingsStore.getState().update("auxiliaryTerminalHeight", input);
    assert.equal(f.disk.get("auxiliaryTerminalHeight"), expected);
    await f.useSettingsStore.getState().load();
    assert.equal(f.useSettingsStore.getState().auxiliaryTerminalHeight, expected);
  }
});
