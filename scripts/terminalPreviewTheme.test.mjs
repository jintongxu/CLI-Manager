import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "cli-manager-terminal-preview-theme-"));
process.on("exit", () => rmSync(tempDir, { recursive: true, force: true }));

function transpile(relativePath, fileName, replacements = []) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  let output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
  for (const [from, to] of replacements) output = output.replace(from, to);
  const modulePath = join(tempDir, fileName.replace(/\.ts$/u, ".mjs"));
  writeFileSync(modulePath, output, "utf8");
  return modulePath;
}

transpile("../src/shared/lib/terminalColor.ts", "terminalColor.ts");
const themesPath = transpile("../src/shared/lib/terminalThemes.ts", "terminalThemes.ts", [
  ['from "./terminalColor"', 'from "./terminalColor.mjs"'],
]);
const previewPath = transpile("../src/shared/lib/terminalPreviewTheme.ts", "terminalPreviewTheme.ts", [
  ['from "./terminalThemes"', 'from "./terminalThemes.mjs"'],
]);

const {
  getTerminalTheme,
  isKnownTerminalThemePreset,
  isLightTerminalTheme,
  resolveTerminalThemeId,
} = await import(pathToFileURL(themesPath).href);
const {
  FOLLOW_TERMINAL_PREVIEW_THEME,
  buildTerminalPreviewPanelStyle,
  isIndependentTerminalPreviewTheme,
  resolveTerminalPreviewTheme,
} = await import(pathToFileURL(previewPath).href);

const DARK_TERMINAL_THEME = "midnightAuroraTerminal";
const LIGHT_PREVIEW_THEME = "windowsTerminalOneHalfLight";

function baseInput(overrides = {}) {
  return {
    previewThemeName: FOLLOW_TERMINAL_PREVIEW_THEME,
    terminalThemeName: DARK_TERMINAL_THEME,
    resolvedTheme: "dark",
    lightThemePalette: "warm-paper",
    darkThemePalette: "night-indigo",
    ...overrides,
  };
}

test("the Midnight Aurora default resolves to its registered dark palette", () => {
  const themeName = "midnightAuroraTerminal";
  const theme = getTerminalTheme(themeName, "dark", "warm-paper", "night-indigo");

  assert.equal(isKnownTerminalThemePreset(themeName), true);
  assert.equal(resolveTerminalThemeId(themeName, "dark", "warm-paper", "night-indigo"), themeName);
  assert.equal(theme.background, "#0B1220");
  assert.equal(theme.foreground, "#E7F0FF");
  assert.equal(theme.blue, "#66B8FF");
  assert.equal(theme.brightBlack, "#9CB0C8");
});

test("following the terminal resolves the terminal theme itself", () => {
  const resolution = resolveTerminalPreviewTheme(baseInput());
  const terminalTheme = getTerminalTheme(DARK_TERMINAL_THEME, "dark", "warm-paper", "night-indigo");

  assert.equal(resolution.isIndependent, false);
  assert.equal(resolution.theme.background, terminalTheme.background);
  assert.equal(resolution.tone, isLightTerminalTheme(terminalTheme) ? "light" : "dark");
  assert.equal(resolution.tone, "dark");
});

test("an independent preset overrides the terminal theme and its brightness", () => {
  const resolution = resolveTerminalPreviewTheme(baseInput({ previewThemeName: LIGHT_PREVIEW_THEME }));
  const previewTheme = getTerminalTheme(LIGHT_PREVIEW_THEME, "dark", "warm-paper", "night-indigo");

  assert.equal(resolution.isIndependent, true);
  assert.equal(resolution.theme.background, previewTheme.background);
  assert.equal(resolution.tone, "light");
});

test("unknown, empty, and renamed preset ids fall back to following the terminal", () => {
  const terminalTheme = getTerminalTheme(DARK_TERMINAL_THEME, "dark", "warm-paper", "night-indigo");
  for (const previewThemeName of ["", "auto", "renamedAwayLight", "follow-terminal"]) {
    const resolution = resolveTerminalPreviewTheme(baseInput({ previewThemeName }));
    assert.equal(resolution.isIndependent, false, previewThemeName);
    assert.equal(resolution.theme.background, terminalTheme.background, previewThemeName);
  }
  assert.equal(isIndependentTerminalPreviewTheme(LIGHT_PREVIEW_THEME), true);
  assert.equal(isIndependentTerminalPreviewTheme(FOLLOW_TERMINAL_PREVIEW_THEME), false);
});

test("the terminal text-color override only applies while following the terminal", () => {
  const following = resolveTerminalPreviewTheme(baseInput({ terminalTextColor: "#123456" }));
  assert.equal(following.theme.foreground, "#123456");
  assert.equal(following.panelStyle["--terminal-theme-foreground"], "#123456");

  const independent = resolveTerminalPreviewTheme(baseInput({
    previewThemeName: LIGHT_PREVIEW_THEME,
    terminalTextColor: "#123456",
  }));
  const previewTheme = getTerminalTheme(LIGHT_PREVIEW_THEME, "dark", "warm-paper", "night-indigo");
  assert.equal(independent.theme.foreground, previewTheme.foreground);
});

test("panel style scopes the terminal panel variables the preview panels read", () => {
  const style = buildTerminalPreviewPanelStyle({ background: "#ffffff", foreground: "#101010" });

  assert.equal(style["--term-panel-bg"], "#ffffff");
  assert.equal(style["--term-panel-fg"], "#101010");
  assert.equal(style["--terminal-theme-background"], "#ffffff");
  for (const variable of ["--term-panel-card", "--term-panel-border", "--ui-scrollbar-thumb"]) {
    assert.ok(typeof style[variable] === "string" && style[variable].length > 0, variable);
  }
});

test("preview panels resolve their theme through the shared hook only", () => {
  const panels = [
    "../src/features/terminal/components/TerminalMarkdownPreview.tsx",
    "../src/features/terminal/components/SubagentTranscriptView.tsx",
    "../src/features/terminal/components/SessionReplayPanel.tsx",
    "../src/features/git/components/diff/GitDiffViewer.tsx",
  ];
  for (const panel of panels) {
    const source = readFileSync(new URL(panel, import.meta.url), "utf8");
    assert.match(source, /useTerminalPreviewTheme/u, panel);
    assert.doesNotMatch(source, /isLightTerminalTheme/u, panel);
  }

  const replaySource = readFileSync(new URL(panels[2], import.meta.url), "utf8");
  const linkBehaviorPins = replaySource.match(/linkBehavior="preview"/gu) ?? [];
  const terminalVariants = replaySource.match(/variant="terminal"/gu) ?? [];
  assert.equal(linkBehaviorPins.length, terminalVariants.length);
  assert.ok(terminalVariants.length >= 2);
});

test("the preview theme setting is persisted, defaulted, and synced like the terminal theme", () => {
  const settingsSource = readFileSync(new URL("../src/shared/preferences/settingsStore.ts", import.meta.url), "utf8");
  const syncSource = readFileSync(new URL("../src/features/sync/lib/syncSettings.ts", import.meta.url), "utf8");

  assert.match(settingsSource, /terminalPreviewThemeName: string;/u);
  assert.match(settingsSource, /terminalPreviewThemeName: FOLLOW_TERMINAL_PREVIEW_THEME/u);
  assert.match(settingsSource, /isKnownTerminalThemePreset\(storedTerminalPreviewThemeName\)/u);
  assert.match(syncSource, /terminalPreviewThemeName: "preferences"/u);
});

test("Graphite auto reuses codexDark and leaves explicit presets and independent previews unchanged", () => {
  assert.equal(resolveTerminalThemeId("auto", "dark", "clear-focus", "graphite"), "codexDark");
  assert.deepEqual(getTerminalTheme("auto", "dark", "clear-focus", "graphite"),
    getTerminalTheme("codexDark", "dark", "clear-focus", "night-indigo"));
  for (const preset of [DARK_TERMINAL_THEME, LIGHT_PREVIEW_THEME, "graphiteRedDark", "codexDark"]) {
    assert.equal(resolveTerminalThemeId(preset, "dark", "clear-focus", "graphite"), preset);
    assert.deepEqual(getTerminalTheme(preset, "dark", "clear-focus", "graphite"),
      getTerminalTheme(preset, "dark", "clear-focus", "midnight-aurora"));
  }
  assert.equal(resolveTerminalThemeId("auto", "light", "clear-focus", "graphite"), "windowsTerminalOneHalfLightClear");
  const preview = resolveTerminalPreviewTheme(baseInput({ darkThemePalette: "graphite", previewThemeName: LIGHT_PREVIEW_THEME }));
  assert.equal(preview.isIndependent, true);
  assert.deepEqual(preview.theme, getTerminalTheme(LIGHT_PREVIEW_THEME, "dark", "warm-paper", "night-indigo"));
});

test("Cream Forest auto explicitly reuses Warm Paper while explicit terminal and preview presets stay isolated", () => {
  const source = readFileSync(new URL("../src/shared/lib/terminalThemes.ts", import.meta.url), "utf8");
  assert.match(source, /if \(lightPalette === "cream-forest"\) return "warmPaperLight";/u);
  assert.equal(resolveTerminalThemeId("auto", "light", "cream-forest", "graphite"), "warmPaperLight");
  assert.deepEqual(getTerminalTheme("auto", "light", "cream-forest", "graphite"),
    getTerminalTheme("auto", "light", "warm-paper", "graphite"));
  assert.equal(resolveTerminalThemeId("auto", "light", "cream-green", "graphite"), "creamGreenLight");
  assert.equal(resolveTerminalThemeId("auto", "dark", "cream-forest", "graphite"), "codexDark");
  for (const preset of [DARK_TERMINAL_THEME, LIGHT_PREVIEW_THEME, "creamGreenLight", "codexDark"]) {
    assert.equal(resolveTerminalThemeId(preset, "light", "cream-forest", "graphite"), preset);
    assert.deepEqual(getTerminalTheme(preset, "light", "cream-forest", "graphite"),
      getTerminalTheme(preset, "dark", "clear-focus", "night-indigo"));
  }
  const preview = resolveTerminalPreviewTheme(baseInput({ resolvedTheme: "light", lightThemePalette: "cream-forest",
    previewThemeName: LIGHT_PREVIEW_THEME }));
  assert.equal(preview.isIndependent, true);
  assert.deepEqual(preview.theme, getTerminalTheme(LIGHT_PREVIEW_THEME, "dark", "warm-paper", "night-indigo"));
});

test("Storm auto uses only official Storm while explicit terminals and independent previews stay isolated", () => {
  assert.equal(resolveTerminalThemeId("auto", "dark", "sea-salt", "tokyo-night-storm"), "tokyoNightStormOfficial");
  assert.deepEqual(getTerminalTheme("auto", "dark", "sea-salt", "tokyo-night-storm"),
    getTerminalTheme("tokyoNightStormOfficial", "light", "warm-paper", "night-indigo"));
  for (const preset of ["tokyoNightStorm", "tokyoNightStormOfficial", "codexDark", LIGHT_PREVIEW_THEME]) {
    assert.equal(resolveTerminalThemeId(preset, "dark", "sea-salt", "tokyo-night-storm"), preset);
    assert.deepEqual(getTerminalTheme(preset, "dark", "sea-salt", "tokyo-night-storm"),
      getTerminalTheme(preset, "light", "clear-focus", "graphite"));
  }
  assert.equal(resolveTerminalThemeId("auto", "light", "sea-salt", "tokyo-night-storm"), "seaSaltLight");
  for (const previewThemeName of [LIGHT_PREVIEW_THEME, "tokyoNightStorm"]) {
    const preview = resolveTerminalPreviewTheme(baseInput({ darkThemePalette: "tokyo-night-storm", previewThemeName }));
    assert.equal(preview.isIndependent, true);
    assert.deepEqual(preview.theme, getTerminalTheme(previewThemeName, "dark", "warm-paper", "night-indigo"));
  }
});
