import type { WorktreeRecord } from "../../../shared/types/index";

/** Return the persisted user-facing name, with legacy ASCII rows as a safe fallback. */
export function getWorktreeDisplayName(
  worktree: Pick<WorktreeRecord, "name" | "display_name">
): string {
  return worktree.display_name?.trim() || worktree.name;
}

/** Shortest distinguishing name suffix; identical display names use stable record IDs.
 * Never truncate the fallback: two long names may have exactly the same tail.
 */
export function getCompactWorktreeLabel(
  worktree: Pick<WorktreeRecord, "id" | "name"> & Partial<Pick<WorktreeRecord, "display_name">>,
  siblings: (Pick<WorktreeRecord, "id" | "name"> & Partial<Pick<WorktreeRecord, "display_name">>)[] = [],
): string {
  const name = (row: typeof worktree) => getWorktreeDisplayName({ ...row, display_name: row.display_name ?? "" }).trim() || "Worktree";
  const full = name(worktree);
  const others = siblings.filter((row) => row.id !== worktree.id);
  if (others.some((row) => name(row).toLowerCase() === full.toLowerCase())) return `${full} · ${worktree.id}`;
  // Start at token boundaries; avoid arbitrary character fragments such as "48".
  const starts = [0, ...Array.from(full.matchAll(/[\/_.-]+/g), (match) => match.index! + match[0].length)];
  for (const start of starts.reverse()) {
    const suffix = full.slice(start);
    if (suffix && !others.some((row) => name(row).toLowerCase().endsWith(suffix.toLowerCase()))) return suffix;
  }
  return full;
}
