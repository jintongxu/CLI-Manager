import type { TreeNode } from "../../../shared/types/index";

export function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.type === "group") {
      if (n.group.id === id) return n;
      const found = findNodeById(n.children, id);
      if (found) return found;
    } else if (n.type === "project") {
      if (n.project.id === id) return n;
      const worktree = n.worktrees?.find((item) => `wt:${item.id}` === id);
      if (worktree) return { type: "worktree", project: n.project, worktree };
    } else if (n.type === "worktree" && `wt:${n.worktree.id}` === id) {
      return n;
    }
  }
  return null;
}

