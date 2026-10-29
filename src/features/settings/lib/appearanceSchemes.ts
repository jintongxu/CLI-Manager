import type { useSettingsStore } from "../../../shared/preferences/settingsStore";

type AppearanceSetters = Pick<ReturnType<typeof useSettingsStore.getState>,
  "setTheme" | "update" | "setTerminalThemeMode">;

/** Explicit opt-in only. Never reset typography, custom colors, or backgrounds. */
export async function applySeaSaltScheme(settings: AppearanceSetters): Promise<void> {
  await settings.setTheme("light");
  await settings.update("lightThemePalette", "sea-salt");
  // Leave follow-app mode through its existing setter before selecting the preset.
  await settings.setTerminalThemeMode("independent");
  await settings.update("terminalThemeName", "tokyoNightStorm");
}

/** Full Storm application colors + official terminal; user overrides stay independent. */
export async function applyStormScheme(settings: AppearanceSetters): Promise<void> {
  await settings.setTheme("dark");
  await settings.update("darkThemePalette", "tokyo-night-storm");
  await settings.setTerminalThemeMode("independent");
  await settings.update("terminalThemeName", "tokyoNightStormOfficial");
}
