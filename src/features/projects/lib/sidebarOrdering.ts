import type { DragEndEvent } from "@dnd-kit/core";
import type { TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { sameSidebarTerminalPartition } from "../../../shared/lib/sidebarTerminalOrder";
import { orderProjectWorktrees, type WorktreeOrderByProject } from "../api/worktreeOrder";

export function terminalDragCandidate(sessions: readonly TerminalSession[], from: string, to: string): boolean {
  const source = sessions.find((item) => item.id === from);
  const target = sessions.find((item) => item.id === to);
  return !!source && !!target && sameSidebarTerminalPartition(source, target);
}

/** Self remains a spatial no-op landing target, never a mutation target. */
export function terminalDropAllowed(sessions: readonly TerminalSession[], from: string, to: string): boolean {
  return from !== to && terminalDragCandidate(sessions, from, to);
}

/** Filter containers BEFORE closestCenter, not its already-selected result. */
export function treeDragCandidate(activeId: string, active: Record<string, unknown> | undefined,
  id: string, candidate: Record<string, unknown> | undefined): boolean {
  if (active?.type === "worktree" || activeId.startsWith("wt:")) {
    return active?.type === "worktree" && candidate?.type === "worktree"
      && candidate.projectId === active.projectId && candidate.sortableEnabled === true
      && active.sortableEnabled === true && id.startsWith("wt:");
  }
  return candidate?.type !== "worktree" && !id.startsWith("wt:");
}

export function worktreeMoveIds(worktrees: readonly WorktreeRecord[], order: WorktreeOrderByProject,
  projectId: string, from: string, to: string): string[] | null {
  const ids = orderProjectWorktrees(worktrees, projectId, order).map((item) => item.id);
  const a = ids.indexOf(from), b = ids.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  ids.splice(a, 1);
  ids.splice(b, 0, from);
  return ids;
}

/** true means consumed, including rejected WT drops; false permits legacy tree dispatch. */
export function dispatchWorktreeDrag(event: DragEndEvent, worktrees: readonly WorktreeRecord[],
  order: WorktreeOrderByProject, reorder: (projectId: string, ids: string[]) => Promise<boolean>): boolean {
  const { active, over } = event;
  const from = String(active.id);
  if (active.data.current?.type !== "worktree" && !from.startsWith("wt:")) {
    return !!over && (over.data.current?.type === "worktree" || String(over.id).startsWith("wt:"));
  }
  if (!over || !treeDragCandidate(from, active.data.current, String(over.id), over.data.current)) return true;
  const projectId = active.data.current?.projectId;
  if (typeof projectId !== "string") return true;
  const ids = worktreeMoveIds(worktrees, order, projectId, from.slice(3), String(over.id).slice(3));
  if (ids) void reorder(projectId, ids);
  return true;
}
