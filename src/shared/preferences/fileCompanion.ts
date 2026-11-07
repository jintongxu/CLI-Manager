/** Persist the logical primary-pane share, never viewport clamps or maximized geometry. */
export const FILE_COMPANION_PRIMARY_RATIO_DEFAULT = 0.55;

export function clampFileCompanionRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(0.85, Math.max(0.15, value))
    : FILE_COMPANION_PRIMARY_RATIO_DEFAULT;
}
