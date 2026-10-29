import type { TreeNode } from "../../../shared/types/index";
import { worktreeListCollapseId } from "../components/TreeContext";

export interface SidebarLocateTarget {
  projectId: string;
  projectName: string;
  worktreeId?: string;
  ancestorIds: string[];
}

/** Resolve rendered ownership by IDs, including flat Worktree rows (not a synthetic hierarchy). */
export function resolveSidebarLocateTarget(
  tree: TreeNode[], projectId: string | null | undefined, worktreeId?: string | null
): SidebarLocateTarget | null {
  if (!projectId) return null;
  const walk = (nodes: TreeNode[], ancestors: string[]): SidebarLocateTarget | null => {
    for (const node of nodes) {
      if (node.type === "group") {
        const found = walk(node.children, [...ancestors, node.group.id]);
        if (found) return found;
      } else if (node.project.id === projectId) {
        const base = { projectId, projectName: node.project.name };
        if (node.type === "project") {
          if (!worktreeId) return { ...base, ancestorIds: ancestors };
          if (node.worktrees?.some((item) => item.id === worktreeId)) {
            return { ...base, worktreeId, ancestorIds: [...ancestors, worktreeListCollapseId(projectId)] };
          }
        } else if (worktreeId && node.worktree.id === worktreeId) {
          return { ...base, worktreeId, ancestorIds: ancestors };
        }
      }
    }
    return null;
  };
  return walk(tree, []);
}

/** Same persisted keys as the existing per-row toggles; never invent terminal/flyout keys. */
export function collectSidebarCollapseIds(tree: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "group") {
        ids.add(node.group.id);
        walk(node.children);
      } else if (node.type === "project") {
        ids.add(worktreeListCollapseId(node.project.id));
      }
    }
  };
  walk(tree);
  return ids;
}
