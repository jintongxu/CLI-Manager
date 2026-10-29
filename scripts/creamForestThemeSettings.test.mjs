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
  context.exports ??= {};
  context.result = undefined;
  vm.runInNewContext(js, context);
  return context.result;
}

test("current defaults resolve dark while every stored theme and current palette survives without writes", () => {
  const defaults = settings.match(/const DEFAULTS: Settings = \{([\s\S]*?)\n\};/u)?.[1];
  const defaultTheme = defaults.match(/theme: "([^"]+)"/u)?.[1];
  const defaultPalette = defaults.match(/lightThemePalette: "([^"]+)"/u)?.[1];
  assert.equal(defaultTheme, "dark");
  assert.equal(defaultPalette, "sea-salt");
  const themeLine = settings.match(/    const theme = .*;/u)?.[0];
  const start = settings.indexOf("    const storedLightThemePalette = entries.lightThemePalette;");
  const end = settings.indexOf("    const storedDarkThemePalette", start);
  assert.ok(themeLine && start > 0 && end > start);
  const source = [declaration(settings, "LEGACY_LIGHT_PALETTE_MAP"), declaration(settings, "migrateLightThemePalette"),
    declaration(read("src/shared/preferences/settingsAppearance.ts"), "resolveTheme"), themeLine, settings.slice(start, end)].join("\n");
  const palettes = evaluate(declaration(general, "LIGHT_PALETTE_OPTIONS"), "LIGHT_PALETTE_OPTIONS.map(o => o.value)");
  for (const theme of [undefined, "light", "dark", "system"]) {
    for (const palette of [undefined, ...palettes]) {
      const entries = {};
      if (theme !== undefined) entries.theme = theme;
      if (palette !== undefined) entries.lightThemePalette = palette;
      const writes = [];
      const result = evaluate(source, "({ theme, resolved: resolveTheme(theme), palette: entries.lightThemePalette })", {
        entries, DEFAULTS: { theme: defaultTheme, lightThemePalette: defaultPalette },
        getSystemTheme: () => "dark", persistSetting: (...args) => writes.push(args),
      });
      assert.equal(result.theme, theme ?? defaultTheme);
      assert.equal(result.resolved, theme === "system" ? "dark" : theme ?? defaultTheme);
      assert.equal(result.palette, palette ?? "sea-salt");
      assert.deepEqual(writes, []);
      if (theme !== undefined) assert.equal(entries.theme, theme);
    }
  }
  assert.match(settings, /resolvedTheme: resolveTheme\(DEFAULTS.theme\)/u);
});

test("Cream Forest stays distinct and selectable with bilingual copy and matching contrast colors", () => {
  const options = evaluate(declaration(general, "LIGHT_PALETTE_OPTIONS"), "LIGHT_PALETTE_OPTIONS");
  const forest = options.filter((option) => option.value === "cream-forest");
  assert.equal(forest.length, 1);
  assert.ok(options.some((option) => option.value === "cream-green"));
  assert.deepEqual(Array.from(forest[0].swatches), ["#FFF9EE", "#263D30", "#286044"]);
  for (const [name, expected] of [["LIGHT_TEXT_COLORS", "#263D30"], ["LIGHT_BG_COLORS", "#FFF9EE"]]) {
    assert.equal(evaluate(declaration(general, name), `${name}["cream-forest"]`), expected);
  }
  for (const locale of ["en-US", "zh-CN"]) {
    const messages = read(`src/shared/i18n/messages/settings.${locale}.ts`);
    for (const key of [forest[0].labelKey, forest[0].descriptionKey]) {
      assert.ok(messages.includes(`"${key}": "`), `${locale}: ${key}`);
    }
    assert.ok(messages.includes(locale === "en-US" ? '"Cream Forest"' : '"奶油森林"'));
  }
  assert.match(general, /update\("lightThemePalette", option.value\)/u);
});

test("Mantine primary filled controls use forest green", () => {
  const source = [declaration(mantine, "LIGHT_PRIMARY_COLORS"), declaration(mantine, "mixHex"),
    declaration(mantine, "buildPrimaryShades")].join("\n");
  const shades = evaluate(source, 'buildPrimaryShades(LIGHT_PRIMARY_COLORS["cream-forest"])');
  assert.equal(shades.length, 10);
  assert.equal(shades[6], "#286044");
  assert.match(mantine, /primaryShade: 6/u);
});
