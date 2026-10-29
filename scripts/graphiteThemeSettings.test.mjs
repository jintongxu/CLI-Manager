import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const settings = read("src/shared/preferences/settingsStore.ts");
const general = read("src/features/settings/components/pages/GeneralSettingsPage.tsx");
const mantine = read("src/shared/ui/MantineThemeProvider.tsx");

function declaration(source, name) {
  const parsed = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of parsed.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.getText(parsed);
    if (!ts.isVariableStatement(statement)) continue;
    const item = statement.declarationList.declarations.find((entry) => entry.name.getText(parsed) === name);
    if (item) return `const ${item.getText(parsed)};`;
  }
  throw new Error(`Missing declaration: ${name}`);
}
function evaluate(source, expression, context = {}) {
  const js = ts.transpileModule(`${source}\nresult = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, context);
  return context.result;
}

test("loading missing palettes defaults to Graphite without migrating existing preferences", () => {
  // Execute the real migration and load block with an in-memory write recorder, never plugin-store.
  const defaultPalette = settings.match(/const DEFAULTS: Settings = \{[\s\S]*?darkThemePalette: "([^"]+)"/u)?.[1];
  assert.equal(defaultPalette, "tokyo-night-storm");
  const start = settings.indexOf("    const storedDarkThemePalette = entries.darkThemePalette;");
  const end = settings.indexOf("    const storedTerminalThemeName", start);
  assert.ok(start > 0 && end > start);
  const source = [declaration(settings, "LEGACY_DARK_PALETTE_MAP"),
    declaration(settings, "migrateDarkThemePalette"), settings.slice(start, end)].join("\n");
  const palettes = [undefined, "graphite", "midnight-aurora", "terminal-acrylic", "night-indigo", "forest-night",
    "graphite-red", "investment-platform", "github-dark", "catppuccin-mocha", "terminal-green", "dracula-purple", "carbon-black"];
  for (const value of palettes) {
    const writes = [];
    const result = evaluate(source, "entries.darkThemePalette", {
      entries: { darkThemePalette: value }, DEFAULTS: { darkThemePalette: defaultPalette },
      persistSetting: (...args) => writes.push(args),
    });
    assert.equal(result, value ?? defaultPalette);
    assert.deepEqual(writes, [], `must not overwrite ${value}`);
  }
  for (const [legacy, expected] of [["crypto-wallet", "investment-platform"], ["nord-night", "terminal-green"]]) {
    const writes = [];
    assert.equal(evaluate(source, "entries.darkThemePalette", {
      entries: { darkThemePalette: legacy }, DEFAULTS: { darkThemePalette: defaultPalette },
      persistSetting: (...args) => writes.push(args),
    }), expected);
    assert.deepEqual(writes, [["darkThemePalette", expected]]);
  }
});

test("Graphite is selectable with bilingual copy and matching contrast values", () => {
  const options = evaluate(declaration(general, "DARK_PALETTE_OPTIONS"), "DARK_PALETTE_OPTIONS");
  const graphite = options.filter((option) => option.value === "graphite");
  assert.equal(graphite.length, 1);
  assert.ok(options.some((option) => option.value === "graphite-red"));
  assert.deepEqual(Array.from(graphite[0].swatches), ["#292c33", "#eef0f6", "#aec8ff"]);
  for (const [name, expected] of [["DARK_TEXT_COLORS", "#eef0f6"], ["DARK_BG_COLORS", "#292c33"]]) {
    assert.equal(evaluate(declaration(general, name), `${name}.graphite`), expected);
  }
  for (const locale of ["en-US", "zh-CN"]) {
    const messages = read(`src/shared/i18n/messages/settings.${locale}.ts`);
    for (const key of [graphite[0].labelKey, graphite[0].descriptionKey]) {
      assert.ok(messages.includes(`"${key}": "`), `${locale}: ${key}`);
    }
  }
  assert.match(general, /update\("darkThemePalette", option.value\)/u);
});

test("Mantine filled primary uses cobalt solid instead of the lighter text accent", () => {
  const source = ["type MantineColorsTuple = string[];", declaration(mantine, "DARK_PRIMARY_COLORS"),
    declaration(mantine, "mixHex"), declaration(mantine, "buildPrimaryShades")].join("\n");
  const shades = evaluate(source, "buildPrimaryShades(DARK_PRIMARY_COLORS.graphite)");
  assert.equal(shades.length, 10);
  assert.equal(shades[6], "#416ee8");
  assert.notEqual(shades[6], "#83a9ff");
  assert.match(mantine, /primaryShade: 6/u);
});
