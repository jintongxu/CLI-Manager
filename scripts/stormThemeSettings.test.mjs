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
const official = evaluate(declaration(themes, "tokyoNightStormOfficial"), "tokyoNightStormOfficial");

test("official Storm is additive and matches all supplied Windows Terminal colors", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(official)), {
    background: "#24283b", foreground: "#c0caf5", cursor: "#c0caf5",
    selectionBackground: "#2e3c64", selectionForeground: "#c0caf5", selectionInactiveBackground: "#2e3c64",
    black: "#1d202f", brightBlack: "#414868", red: "#f7768e", brightRed: "#f7768e",
    green: "#9ece6a", brightGreen: "#9ece6a", yellow: "#e0af68", brightYellow: "#e0af68",
    blue: "#7aa2f7", brightBlue: "#7aa2f7", magenta: "#bb9af7", brightMagenta: "#9d7cd8",
    cyan: "#7dcfff", brightCyan: "#7dcfff", white: "#a9b1d6", brightWhite: "#c0caf5",
  });
  const legacy = evaluate(declaration(themes, "tokyoNightStorm"), "tokyoNightStorm");
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), {
    background: "#24283b", foreground: "#a9b1d6", cursor: "#a9b1d6", black: "#32344a",
    red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#ad8ee6",
    cyan: "#449dab", white: "#9699a8", brightBlack: "#444b6a", brightRed: "#ff7a93",
    brightGreen: "#b9f27c", brightYellow: "#ff9e64", brightBlue: "#7da6ff", brightMagenta: "#bb9af7",
    brightCyan: "#0db9d7", brightWhite: "#acb0d0",
  });
  assert.match(themes, /id: "tokyoNightStormOfficial".*theme: tokyoNightStormOfficial/u);
  assert.match(themes, /id: "tokyoNightStorm".*theme: tokyoNightStorm,/u);
  const fn = declaration(read("src/features/terminal/lib/xTermDiagnostics.ts"), "withVisibleSelectionTheme");
  const context = { theme: official, isLightTerminalTheme: () => false };
  const selected = evaluate(fn, "withVisibleSelectionTheme(theme)", context);
  assert.equal(selected.selectionBackground, "#2e3c64");
  assert.equal(selected.selectionForeground, "#c0caf5");
  assert.equal(selected.selectionInactiveBackground, "#2e3c64");
  assert.equal(evaluate(fn, "withVisibleSelectionTheme(theme, true)", { theme: official, isLightTerminalTheme: () => false }).selectionBackground, "rgba(0, 0, 0, 0)");
});

test("Storm option, contrast colors, Mantine, bilingual labels and BTW recognize the palette", () => {
  const options = evaluate(declaration(general, "DARK_PALETTE_OPTIONS"), "DARK_PALETTE_OPTIONS");
  assert.equal(options.filter(o => o.value === "tokyo-night-storm").length, 1);
  for (const [name, expected] of [["DARK_TEXT_COLORS", "#c0caf5"], ["DARK_BG_COLORS", "#24283b"]]) {
    assert.equal(evaluate(declaration(general, name), `${name}["tokyo-night-storm"]`), expected);
  }
  assert.equal(evaluate(declaration(mantine, "DARK_PRIMARY_COLORS"), 'DARK_PRIMARY_COLORS["tokyo-night-storm"]'), "#7aa2f7");
  assert.match(settings, /export type DarkThemePalette =[\s\S]*?"tokyo-night-storm"/u);
  for (const locale of ["en-US", "zh-CN"]) {
    const messages = read(`src/shared/i18n/messages/settings.${locale}.ts`);
    for (const key of ["settings.palette.dark.tokyoNightStorm.label", "settings.palette.dark.tokyoNightStorm.description",
      "settings.general.applyStormScheme", "settings.general.stormSchemeDescription", "settings.general.stormApplied",
      "settings.general.stormApplyFailed"]) assert.ok(messages.includes(`"${key}": "`));
  }
  const btw = read("src/features/terminal/lib/btwWindowProtocol.ts");
  const source = ["LIGHT_PALETTES", "DARK_PALETTES", "newerBtwSnapshot"].map(n => declaration(btw, n)).join("\n");
  const incoming = { ownerEpoch: "epoch", revision: 1, dark: true, lightThemePalette: "sea-salt", darkThemePalette: "tokyo-night-storm" };
  assert.equal(evaluate(source, 'newerBtwSnapshot(null, incoming, "epoch")', { incoming }), incoming);
  assert.equal(evaluate(source, 'newerBtwSnapshot(null, incoming, "epoch")', { incoming: { ...incoming, darkThemePalette: "invalid" } }), null);
});

test("Storm whole apply remains separate from sea and preserves unrelated customizations", async () => {
  const source = read("src/features/settings/lib/appearanceSchemes.ts");
  const fn = evaluate(declaration(source, "applyStormScheme"), "applyStormScheme");
  for (const mode of ["system", "independent"]) {
    const state = { theme: "light", lightThemePalette: "cream-forest", darkThemePalette: "graphite", terminalThemeMode: mode,
      terminalThemeName: mode === "system" ? "auto" : "tokyoNightStorm", fontFamily: "Custom Font", fontSize: 17,
      uiFontFamily: "Custom UI", uiFontSize: 15, terminalTextColor: "#123456", uiTextColor: "#abcdef",
      terminalPreviewThemeName: "githubLight", terminalBackground: { enabled: true }, terminalSidePanelSkin: "independent",
      terminalTuiUserColor: "#abcdef", terminalTuiAssistantColor: "#fedcba" };
    const before = { ...state };
    const calls = [];
    await fn({ setTheme: async v => { calls.push(["theme", v]); state.theme = v; },
      update: async (k, v) => { calls.push([k, v]); state[k] = v; },
      setTerminalThemeMode: async v => { calls.push(["terminalThemeMode", v]); state.terminalThemeMode = v; } });
    assert.deepEqual(calls, [["theme", "dark"], ["darkThemePalette", "tokyo-night-storm"],
      ["terminalThemeMode", "independent"], ["terminalThemeName", "tokyoNightStormOfficial"]]);
    for (const key of Object.keys(before).filter(k => !calls.some(([changed]) => changed === k))) assert.equal(state[key], before[key]);
  }
  assert.match(general, /onClick=\{\(\) => void applyWholeStormScheme\(\)\}/u);
  assert.match(general, /await applyStormScheme\(useSettingsStore.getState\(\)\)/u);
  assert.match(general, /onClick=\{\(\) => void applyWholeSeaSaltScheme\(\)\}/u);
  assert.match(declaration(source, "applySeaSaltScheme"), /"tokyoNightStorm"/u);
});

test("fresh defaults select Storm without migrating persisted app or terminal choices", () => {
  const defaults = { theme: "dark", lightThemePalette: "sea-salt", darkThemePalette: "tokyo-night-storm", terminalThemeName: "tokyoNightStormOfficial" };
  const defaultDeclaration = declaration(settings, "DEFAULTS");
  for (const [key, value] of Object.entries(defaults)) assert.ok(defaultDeclaration.includes(`${key}: "${value}"`));
  const start = settings.indexOf("    const storedLightThemePalette = entries.lightThemePalette;");
  const finish = "    entries.terminalThemeMode = terminalThemeMode;";
  const end = settings.indexOf(finish, start) + finish.length;
  const source = ["LEGACY_LIGHT_PALETTE_MAP", "LEGACY_DARK_PALETTE_MAP", "LEGACY_TERMINAL_THEME_MAP",
    "migrateLightThemePalette", "migrateDarkThemePalette", "migrateTerminalThemeName"].map(n => declaration(settings, n)).join("\n")
    + "\n" + settings.slice(start, end);
  for (const input of [{}, { lightThemePalette: "sea-salt", darkThemePalette: "graphite", terminalThemeName: "tokyoNightStorm" },
    { lightThemePalette: "clear-focus", darkThemePalette: "night-indigo", terminalThemeName: "midnightAuroraTerminal" },
    { lightThemePalette: "cream-forest", darkThemePalette: "forest-night", terminalThemeName: "seaSaltLight" },
    { darkThemePalette: "tokyo-night-storm", terminalThemeName: "tokyoNightStormOfficial" },
    { darkThemePalette: "graphite", terminalThemeName: "auto" }]) {
    const entries = { ...input };
    const mode = entries.terminalThemeName === "auto" ? "system" : "independent";
    const writes = [];
    const result = evaluate(source, "entries", { entries, storedTerminalThemeMode: mode, DEFAULTS: defaults,
      persistSetting: (...args) => writes.push(args) });
    for (const key of ["lightThemePalette", "darkThemePalette", "terminalThemeName"]) assert.equal(result[key], input[key] ?? defaults[key]);
    assert.equal(result.terminalThemeMode, mode);
    assert.deepEqual(writes, []);
  }
  assert.match(settings, /const theme = \(entries.theme as ThemeMode\) \?\? DEFAULTS.theme/u);
});
