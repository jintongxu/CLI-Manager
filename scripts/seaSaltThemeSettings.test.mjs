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
  context.exports = {};
  context.result = undefined;
  vm.runInNewContext(js, context);
  return context.result;
}

const themes = read("src/shared/lib/terminalThemes.ts");
const theme = evaluate(declaration(themes, "seaSaltLight"), "seaSaltLight");
const frozen = read("design-previews/app-theme/color-directions.css").split('body[data-theme="iris"]')[0];

test("actual xterm palette keeps sea/light roles with approved soft-blue background", () => {
  assert.equal(theme.background, "#E3EDFA");
  assert.equal(theme.cursorAccent, theme.background);
  for (const [key, token] of [["foreground", "terminal-text"],
    ["selectionBackground", "selected"], ["blue", "ansi-path"], ["magenta", "ansi-branch"],
    ["green", "ansi-ok"], ["brightBlue", "ansi-command"], ["yellow", "ansi-option"]]) {
    assert.equal(theme[key].toLowerCase(), frozen.match(new RegExp(`--${token}: (#[a-f0-9]+)`))[1]);
  }
  const color = read("src/shared/lib/terminalColor.ts");
  const luminance = (hex) => evaluate([declaration(color, "SHORT_OR_LONG_HEX_PATTERN"), declaration(color, "hexToRgb"), declaration(color, "getRelativeLuminance")].join("\n"),
    `getRelativeLuminance(hexToRgb("${hex}"))`);
  for (const key of ["foreground", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"]) {
    const ratio = (luminance(theme.background) + .05) / (luminance(theme[key]) + .05);
    assert.ok(ratio >= 4.5, `${key}: ${ratio}`);
  }
  const selectedRatio = (luminance(theme.selectionBackground) + .05) / (luminance(theme.foreground) + .05);
  assert.ok(selectedRatio >= 4.5, `selected foreground: ${selectedRatio}`);
  assert.match(themes, /id: "seaSaltLight".*theme: seaSaltLight/u);
  const auto = declaration(themes, "resolveAutoLightThemeId");
  assert.equal(evaluate(auto, 'resolveAutoLightThemeId("sea-salt")'), "seaSaltLight");
  assert.equal(evaluate(auto, 'resolveAutoLightThemeId("cream-forest")'), "warmPaperLight");
  const resolver = declaration(themes, "resolveTerminalThemeId");
  assert.equal(evaluate(resolver, 'resolveTerminalThemeId("dracula", "light", "sea-salt")', {
    themePresetMap: new Map([["dracula", { id: "dracula" }]]),
  }), "dracula");
});

test("native xterm selection keeps the preset pair; search and legacy behavior survive", () => {
  const diagnostics = read("src/features/terminal/lib/xTermDiagnostics.ts");
  const fn = declaration(diagnostics, "withVisibleSelectionTheme");
  const run = (input, search = false) => evaluate(fn, "withVisibleSelectionTheme(input, search)", {
    input, search, isLightTerminalTheme: () => true,
  });
  assert.equal(run(theme).selectionBackground, "#CCDEFC");
  assert.equal(run(theme).selectionInactiveBackground, "#CCDEFC");
  assert.equal(run(theme, true).selectionBackground, "rgba(0, 0, 0, 0)");
  assert.equal(run({ background: "#fff", selectionBackground: "#abc" }).selectionBackground, "rgba(37, 99, 235, 0.28)");
  const controller = read("src/features/terminal/hooks/useXTermController.ts");
  assert.match(controller, /terminal.options.theme = withVisibleSelectionTheme\(nextTheme, searchOpen\)/u);
  assert.match(controller, /getTerminalTheme\(terminalThemeName, resolvedTheme, lightThemePalette, darkThemePalette\)/u);
});

test("explicit whole apply uses existing setters and preserves customization from system or independent mode", async () => {
  const source = read("src/features/settings/lib/appearanceSchemes.ts");
  const fn = evaluate(declaration(source, "applySeaSaltScheme"), "applySeaSaltScheme");
  for (const mode of ["system", "independent"]) {
    const state = { theme: "dark", lightThemePalette: "cream-forest", terminalThemeMode: mode,
      terminalThemeName: mode === "system" ? "auto" : "dracula", fontFamily: "Custom Font",
      terminalTextColor: "#123456", uiTextColor: "#abcdef", terminalPreviewThemeName: "githubLight",
      terminalBackground: { enabled: true }, terminalTuiUserColor: "#abcdef" };
    const before = { ...state };
    const calls = [];
    await fn({ setTheme: async (v) => { calls.push(["theme", v]); state.theme = v; },
      update: async (k, v) => { calls.push([k, v]); state[k] = v; },
      setTerminalThemeMode: async (v) => { calls.push(["terminalThemeMode", v]); state.terminalThemeMode = v; } });
    assert.deepEqual(calls, [["theme", "light"], ["lightThemePalette", "sea-salt"],
      ["terminalThemeMode", "independent"], ["terminalThemeName", "tokyoNightStorm"]]);
    for (const key of Object.keys(before).filter(k => !["theme", "lightThemePalette", "terminalThemeMode", "terminalThemeName"].includes(k))) {
      assert.equal(state[key], before[key]);
    }
  }
  assert.match(general, /<Button[^>]*onClick=\{\(\) => void applyWholeSeaSaltScheme\(\)\}/u);
  assert.match(general, /await applySeaSaltScheme\(useSettingsStore.getState\(\)\)/u);
});

test("settings, contrast, Mantine, bilingual labels and BTW all recognize sea-salt", () => {
  const options = evaluate(declaration(general, "LIGHT_PALETTE_OPTIONS"), "LIGHT_PALETTE_OPTIONS");
  assert.equal(options.filter(o => o.value === "sea-salt").length, 1);
  for (const [name, expected] of [["LIGHT_TEXT_COLORS", "#183656"], ["LIGHT_BG_COLORS", "#DFEDFF"]]) {
    assert.equal(evaluate(declaration(general, name), `${name}["sea-salt"]`), expected);
  }
  assert.equal(evaluate(declaration(mantine, "LIGHT_PRIMARY_COLORS"), 'LIGHT_PRIMARY_COLORS["sea-salt"]'), "#2359C4");
  for (const locale of ["en-US", "zh-CN"]) {
    const messages = read(`src/shared/i18n/messages/settings.${locale}.ts`);
    for (const key of ["settings.palette.light.seaSalt.label", "settings.palette.light.seaSalt.description",
      "settings.general.applySeaSaltScheme", "settings.general.seaSaltSchemeDescription", "settings.general.seaSaltApplied",
      "settings.general.seaSaltApplyFailed"]) assert.ok(messages.includes(`"${key}": "`));
  }
  const btw = read("src/features/terminal/lib/btwWindowProtocol.ts");
  const incoming = { ownerEpoch: "epoch", revision: 1, dark: false, lightThemePalette: "sea-salt", darkThemePalette: "graphite" };
  const result = evaluate([declaration(btw, "LIGHT_PALETTES"), declaration(btw, "DARK_PALETTES"),
    declaration(btw, "newerBtwSnapshot")].join("\n"), 'newerBtwSnapshot(null, incoming, "epoch")', { incoming });
  assert.equal(result, incoming);
});

test("fresh terminal defaults do not migrate stored independent presets or explicit auto", () => {
  const start = settings.indexOf("    const storedTerminalThemeName = entries.terminalThemeName;");
  const end = settings.indexOf("    entries.terminalThemeMode = terminalThemeMode;", start);
  const defaults = { terminalThemeName: "seaSaltLight" };
  const source = [declaration(settings, "LEGACY_TERMINAL_THEME_MAP"), declaration(settings, "migrateTerminalThemeName"),
    settings.slice(start, end + "    entries.terminalThemeMode = terminalThemeMode;".length)].join("\n");
  for (const [name, mode, expectedName, expectedMode] of [
    [undefined, undefined, "seaSaltLight", "independent"],
    ["midnightAuroraTerminal", "independent", "midnightAuroraTerminal", "independent"],
    ["dracula", "independent", "dracula", "independent"],
    ["seaSaltLight", "independent", "seaSaltLight", "independent"],
    ["auto", "system", "auto", "system"],
  ]) {
    const entries = name === undefined ? {} : { terminalThemeName: name };
    const writes = [];
    const value = evaluate(source, "entries", { entries, storedTerminalThemeMode: mode, DEFAULTS: defaults,
      persistSetting: (...args) => writes.push(args) });
    assert.equal(value.terminalThemeName, expectedName);
    assert.equal(value.terminalThemeMode, expectedMode);
    if (name !== undefined) assert.deepEqual(writes, []);
  }
});
