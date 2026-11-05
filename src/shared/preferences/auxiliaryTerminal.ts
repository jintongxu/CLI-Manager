/** Persist the restored height, never the maximized or viewport-clamped height. */
export const AUXILIARY_TERMINAL_DEFAULT_HEIGHT = 240;
export function normalizeAuxiliaryTerminalHeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(2000, Math.max(80, Math.round(value))) : AUXILIARY_TERMINAL_DEFAULT_HEIGHT;
}
export function clampAuxiliaryTerminalHeight(height: number, available: number, maximized = false): number {
  const limit = Math.max(0, available - (maximized ? 0 : 80));
  return maximized ? limit : Math.min(normalizeAuxiliaryTerminalHeight(height), limit);
}
