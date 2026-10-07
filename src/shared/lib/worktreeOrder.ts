import type { WorktreeRecord } from "../types/index";

export type WorktreeOrderByProject = Record<string, string[]>;

/** Validate storage shape without assuming projects/worktrees have loaded yet. */
export function sanitizeWorktreeOrder(value: unknown): WorktreeOrderByProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([projectId, ids]) => projectId.trim()
    && Array.isArray(ids) && ids.every((id) => typeof id === "string" && id.trim())
    && new Set(ids).size === ids.length));
}

/** Ignore deleted/foreign IDs; append newly discovered records in the existing name order. */
export function orderProjectWorktrees(worktrees: readonly WorktreeRecord[], projectId: string,
  order: WorktreeOrderByProject): WorktreeRecord[] {
  const siblings = worktrees.filter((worktree) => worktree.project_id === projectId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const ranks = new Map((order[projectId] ?? []).map((id, index) => [id, index]));
  return siblings.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}

export function validateWorktreeOrder(projectId: string, ids: readonly string[], worktrees: readonly WorktreeRecord[]): boolean {
  const siblings = worktrees.filter((worktree) => worktree.project_id === projectId);
  return Boolean(projectId) && ids.length === siblings.length && new Set(ids).size === ids.length
    && ids.every((id) => siblings.some((worktree) => worktree.id === id));
}
