import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../src/shared/preferences/settingsStore.ts", import.meta.url),
  "utf8",
);
const terminalThemesSource = readFileSync(
  new URL("../src/shared/lib/terminalThemes.ts", import.meta.url),
  "utf8",
);
const defaultsSource = settingsSource.match(/const DEFAULTS: Settings = \{([\s\S]*?)\n\};/u)?.[1];

test("fresh installs use the product default theme combination", () => {
  assert.ok(defaultsSource);
  assert.match(defaultsSource, /theme: "dark"/u);
  assert.match(defaultsSource, /lightThemePalette: "sea-salt"/u);
  assert.match(defaultsSource, /darkThemePalette: "tokyo-night-storm"/u);
  assert.match(defaultsSource, /fontSize: TERMINAL_FONT_SIZE_DEFAULT/u);
  assert.match(settingsSource, /TERMINAL_FONT_SIZE_DEFAULT = 16/u);
  assert.match(defaultsSource, /fontFamily: "\\"JetBrainsMono Nerd Font\\", \\"JetBrains Mono\\", \\"Cascadia Code\\", Consolas, monospace"/u);
  assert.match(defaultsSource, /terminalThemeMode: "independent"/u);
  assert.match(defaultsSource, /terminalThemeName: "tokyoNightStormOfficial"/u);
  assert.match(terminalThemesSource, /const midnightAuroraTerminal: ITheme = \{[\s\S]*?background: "#0B1220"/u);
  assert.match(terminalThemesSource, /id: "midnightAuroraTerminal"/u);
  assert.match(defaultsSource, /terminalSidePanelSkin: "terminal"/u);
  assert.match(defaultsSource, /terminalBackground: \{[\s\S]*?enabled: false/u);
});
