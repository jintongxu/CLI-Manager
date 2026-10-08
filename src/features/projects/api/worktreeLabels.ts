import type { WorktreeRecord } from "../../../shared/types/index";

export const MAX_WORKTREE_LABEL_ORDINAL = 2147483647;
export const MAX_WORKTREE_SHORT_LABEL_LENGTH = 12;

/** NFC/trim is canonical; reject invisible controls before trimming them away. */
export function normalizeWorktreeShortLabel(value: string): string {
  if (typeof value !== "string" || /[\p{Cc}\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error("worktree_short_label_invalid");
  }
  const normalized = value.normalize("NFC").trim();
  if (Array.from(normalized).length > MAX_WORKTREE_SHORT_LABEL_LENGTH) throw new Error("worktree_short_label_too_long");
  if (/^[Ww][0-9]+$/.test(normalized)) throw new Error("worktree_short_label_reserved");
  return normalized;
}

/** Full persistent token. Missing legacy metadata never invents a default number. */
export function getWorktreeShortLabel(
  worktree: Partial<Pick<WorktreeRecord, "short_label" | "label_ordinal">> | null | undefined,
): string {
  if (!worktree) return "";
  if (worktree.short_label) return worktree.short_label;
  const ordinal = worktree.label_ordinal;
  return typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal > 0 && ordinal <= MAX_WORKTREE_LABEL_ORDINAL
    ? `W${ordinal}` : "";
}

/** Match SQLite NOCASE exactly, rather than Unicode-wide case folding. */
export function worktreeShortLabelComparisonKey(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}
