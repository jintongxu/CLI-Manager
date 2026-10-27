import type { TerminalNavigationEntry } from "../lib/terminalNavigationModel";

export type TerminalNavigationGroups = Record<"recent" | "currentWork" | "other", readonly TerminalNavigationEntry[]>;

/** Search is popup-local; never changes quick entries or the window's MRU. */
export function filterNavigationGroups(groups: TerminalNavigationGroups, query: string): TerminalNavigationGroups {
  const terms = query.trim().toLowerCase().replace(/\\/g, "/").split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const filter = (entries: readonly TerminalNavigationEntry[]) => entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    const text = [entry.session.title, entry.session.cwd, entry.session.remotePath, entry.project?.name,
      entry.project?.path, entry.worktree?.name, entry.worktree?.display_name, entry.worktree?.short_label,
      entry.worktree?.branch, entry.worktree?.path].filter(Boolean).join(" ").toLowerCase().replace(/\\/g, "/");
    return terms.every((term) => text.includes(term));
  });
  return { recent: filter(groups.recent), currentWork: filter(groups.currentWork), other: filter(groups.other) };
}

export function navigationResultIndex(index: number, key: string, length: number): number {
  if (!length) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return (Math.max(-1, Math.min(index, length - 1)) + (key === "ArrowUp" ? -1 : 1) + length) % length;
}

/** Only visible members may participate; stale/outside selection never becomes clear-all. */
export function selectedNavigationMembers(entries: readonly TerminalNavigationEntry[], selectedIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  return entries.filter((entry) => entry.inCurrentWork && selected.has(entry.id)).map((entry) => entry.id);
}
