import { resolveAutoTerminalThemeId } from "../lib/terminalThemes";
import { createAppearanceTransaction, type AppearanceValues } from "./appearanceTransaction";
import type { Settings, ThemeMode, TerminalThemeMode } from "./settingsStore";

export function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  return mode === "system" ? getSystemTheme() : mode;
}
/** Owns appearance persistence/derivation; no terminal lifecycle or protocol changes. */
export function createSettingsAppearance(
  read: () => Settings & { loaded: boolean },
  apply: (values: AppearanceValues & { resolvedTheme: "dark" | "light" }) => void,
  persist: (key: keyof AppearanceValues, value: AppearanceValues[keyof AppearanceValues]) => Promise<void>,
) {
  const transaction = createAppearanceTransaction({
    read,
    apply: values => apply({ ...values, resolvedTheme: resolveTheme(values.theme) }),
    persist,
    ready: () => read().loaded,
  });
  return {
    transaction,
    setTheme: (theme: ThemeMode) => transaction.write(() => ({ theme })),
    setTerminalThemeMode: (terminalThemeMode: TerminalThemeMode) => transaction.write(current => ({
      terminalThemeMode,
      terminalThemeName: terminalThemeMode === "system" ? "auto"
        : current.terminalThemeName === "auto"
          ? resolveAutoTerminalThemeId(resolveTheme(current.theme), current.lightThemePalette, current.darkThemePalette)
          : current.terminalThemeName,
    })),
  };
}
