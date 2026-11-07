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
    const sync = file.endsWith("syncStore.ts");
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
        // Sync's unrelated database/network/domain imports must never run in a preference-only import.
        if (sync && !["zustand"].includes(name)
          && !["/settingsStore", "/syncSettings", "/singleFlight"].some(suffix => name.endsWith(suffix))) return {};
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
  return { ...settings, applyPreferences: sync.applyPreferences, disk,
    ...load("src/shared/preferences/fileCompanion.ts"),
    ...load("src/features/sync/lib/syncSettings.ts") };
}

const cases = [
  [undefined, 0.55], [null, 0.55], [NaN, 0.55], [Infinity, 0.55], [-Infinity, 0.55],
  ["0.7", 0.55], [{}, 0.55], [[], 0.55], [true, 0.55],
  [-1, 0.15], [0, 0.15], [0.15, 0.15], [0.55, 0.55], [0.712345, 0.712345],
  [0.85, 0.85], [1, 0.85], [100, 0.85],
];

test("logical ratio helper uses finite numbers only, clamps boundaries and retains precision", () => {
  const f = fixture();
  assert.equal(f.FILE_COMPANION_PRIMARY_RATIO_DEFAULT, 0.55);
  for (const [value, expected] of cases) {
    assert.equal(f.clampFileCompanionRatio(value), expected);
  }
});

test("production settings migrate missing, malformed and out-of-range ratios on load", async () => {
  for (const [value, expected] of cases) {
    const initial = value === undefined ? {} : { fileCompanionPrimaryRatio: value };
    const f = fixture(initial);
    assert.equal(f.useSettingsStore.getState().fileCompanionPrimaryRatio, 0.55);
    await f.useSettingsStore.getState().load();
    assert.equal(f.useSettingsStore.getState().fileCompanionPrimaryRatio, expected);
    // Existing non-null invalid values are repaired; missing settings use the default.
    if (value !== undefined && value !== null) assert.equal(f.disk.get("fileCompanionPrimaryRatio"), expected);
  }
});

test("existing update path persists normalized logical ratio and reload retains it", async () => {
  const f = fixture();
  await f.useSettingsStore.getState().load();
  const layout = JSON.stringify(f.useSettingsStore.getState().workspaceLayout);
  for (const [value, expected] of cases) {
    await f.useSettingsStore.getState().update("fileCompanionPrimaryRatio", value);
    assert.equal(f.useSettingsStore.getState().fileCompanionPrimaryRatio, expected);
    assert.equal(f.disk.get("fileCompanionPrimaryRatio"), expected);
    await f.useSettingsStore.getState().load();
    assert.equal(f.useSettingsStore.getState().fileCompanionPrimaryRatio, expected);
    assert.equal(JSON.stringify(f.useSettingsStore.getState().workspaceLayout), layout);
  }
});

test("curated sync export and actual preference import retain and normalize the ratio", async () => {
  const f = fixture();
  assert.equal(f.SETTING_BACKUP_POLICY.fileCompanionPrimaryRatio, "preferences");
  assert.ok(f.SYNCABLE_SETTING_KEYS.includes("fileCompanionPrimaryRatio"));
  assert.equal(f.pickSyncableSettings({ fileCompanionPrimaryRatio: 0.71, runtimeWidth: 42 }).fileCompanionPrimaryRatio, 0.71);
  assert.equal(f.pickSyncableSettings({ runtimeWidth: 42 }).runtimeWidth, undefined);
  for (const [value, expected] of cases) {
    await f.applyPreferences({ fileCompanionPrimaryRatio: value });
    assert.equal(f.disk.get("fileCompanionPrimaryRatio"), expected);
    assert.equal(f.useSettingsStore.getState().fileCompanionPrimaryRatio, expected);
  }
  await f.applyPreferences({ fontSize: 18 });
  assert.equal(f.disk.get("fileCompanionPrimaryRatio"), 0.85);
});
