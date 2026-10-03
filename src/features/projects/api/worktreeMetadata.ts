import type { WorktreeRecord } from "../../../shared/types/index";

/** Return the persisted user-facing name, with legacy ASCII rows as a safe fallback. */
export function getWorktreeDisplayName(
  worktree: Pick<WorktreeRecord, "name" | "display_name">
): string {
  return worktree.display_name?.trim() || worktree.name;
}
