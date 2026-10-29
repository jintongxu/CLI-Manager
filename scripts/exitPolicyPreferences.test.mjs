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
  return { ...settings, applyPreferences: sync.applyPreferences, disk };
}

test("production settings load and update normalize exit policy without touching appearance preview", async () => {
  const f = fixture({ exitWithRunningTasksBehavior: "background" });
  await f.useSettingsStore.getState().load();
  assert.equal(f.useSettingsStore.getState().exitWithRunningTasksBehavior, "ask");
  const owner = await f.appearancePreview.begin();
  f.appearancePreview.preview(owner, { theme: "light" });
  for (const value of ["background", "invalid", null, {}, "minimize", "discard", "ask"]) {
    await f.useSettingsStore.getState().update("exitWithRunningTasksBehavior", value);
    const expected = ["minimize", "discard"].includes(value) ? value : "ask";
    assert.equal(f.useSettingsStore.getState().exitWithRunningTasksBehavior, expected);
    assert.equal(f.disk.get("exitWithRunningTasksBehavior"), expected);
    assert.equal(f.useSettingsStore.getState().theme, "light");
  }
  assert.equal(f.appearancePreview.preview(owner, { theme: "dark" }), true);
  await f.appearancePreview.cancel(owner);
});

test("actual sync applyPreferences entry normalizes imported legacy and invalid exit settings", async () => {
  const f = fixture();
  for (const value of ["background", "invalid", null, 7, {}, "minimize", "discard", "ask"]) {
    await f.applyPreferences({ exitWithRunningTasksBehavior: value, fontSize: 18, notASetting: true });
    const expected = ["minimize", "discard"].includes(value) ? value : "ask";
    assert.equal(f.disk.get("exitWithRunningTasksBehavior"), expected);
    assert.equal(f.useSettingsStore.getState().exitWithRunningTasksBehavior, expected);
    assert.equal(f.disk.get("fontSize"), 18);
    assert.equal(f.disk.has("notASetting"), false);
  }
  await f.applyPreferences({ fontSize: 19 });
  assert.equal(f.disk.get("exitWithRunningTasksBehavior"), "ask");
});

test("exit settings and dialog offer no background choice and default to minimize", () => {
  const dialog = readFileSync("src/features/terminal/api/RunningTasksExitDialog.tsx", "utf8");
  const page = readFileSync("src/features/settings/components/pages/ThemeSettingsPage.tsx", "utf8");
  assert.doesNotMatch(dialog, /value="background"|onBackground\(remember\)/);
  assert.match(dialog, /useState<RunningTasksExitAction>\("minimize"\)/);
  assert.match(dialog, /setAction\("minimize"\)/);
  assert.doesNotMatch(page, /settings\.options\.exitTasks\.background/);
  for (const locale of ["zh-CN", "en-US"]) {
    const common = readFileSync(`src/shared/i18n/messages/common.${locale}.ts`, "utf8");
    const settings = readFileSync(`src/shared/i18n/messages/settings.${locale}.ts`, "utf8");
    assert.match(common, /"dialogs.runningTasksExit.discardDescription"/);
    assert.doesNotMatch(common + settings, /"(?:dialogs\.runningTasksExit|settings\.options\.exitTasks)\.background"/);
  }
});
