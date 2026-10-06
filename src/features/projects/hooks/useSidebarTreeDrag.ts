import { useCallback } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Group, Project, TreeNode as TNode } from "../../../shared/types/index";
import { dispatchWorktreeDrag } from "../lib/sidebarOrdering";
import { useProjectStore } from "../api/projectStore";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";

/** Owns tree drag dispatch; Worktrees must never reach project/group movement. */
export function useSidebarTreeDrag(groups: Group[], projects: Project[], tree: TNode[],
  reorderItems: (parentId: string | null, ids: string[]) => Promise<unknown>,
  moveGroupToParent: (id: string, parentId: string | null) => Promise<unknown>,
  moveProjectToGroup: (id: string, parentId: string | null) => Promise<unknown>) {
  return useCallback((event: DragEndEvent) => {
    const store = useProjectStore.getState();
    if (dispatchWorktreeDrag(event, store.worktrees, useSettingsStore.getState().worktreeOrderByProject,
      store.reorderWorktrees)) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = active.id as string;
      const overId = over.id as string;
      const isGroup = (id: string) => groups.some((g) => g.id === id);
      const isProject = (id: string) => projects.some((p) => p.id === id);
      const isInheritedNode = (id: string) => {
        const group = groups.find((item) => item.id === id);
        if (group) return group.parent_id !== null && !(group.bound_path ?? "").trim();
        const project = projects.find((item) => item.id === id);
        return project?.path_mode === "inherit" && project.group_id !== null;
      };

      // 1) 拖入指定分组
      if (overId.startsWith("into:")) {
        const targetGroupId = overId.slice("into:".length);
        if (activeId === targetGroupId) return;
        if (isGroup(activeId)) void moveGroupToParent(activeId, targetGroupId);
        else if (isProject(activeId)) void moveProjectToGroup(activeId, targetGroupId);
        return;
      }

      // 3) 拖到 sibling 节点：先定位 over 所在父级与同级列表
      const findParentChildren = (
        nodes: TNode[],
        targetId: string,
        parentId: string | null
      ): { parentId: string | null; nodes: TNode[] } | null => {
        const here = nodes.some((n) =>
          n.type === "group" ? n.group.id === targetId : n.project.id === targetId
        );
        if (here) return { parentId, nodes };
        for (const n of nodes) {
          if (n.type === "group") {
            const r = findParentChildren(n.children, targetId, n.group.id);
            if (r) return r;
          }
        }
        return null;
      };

      const overContext = findParentChildren(tree, overId, null);
      if (!overContext) return;

      const ids = overContext.nodes.map((c) => (c.type === "group" ? c.group.id : c.project.id));
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (newIndex === -1) return;

      const preservesInheritedPrefix = (orderedIds: string[], movedId: string) => {
        // 只有被移动的节点本身是继承节点时才限制落点；自定义节点可以正常
        // 在继承节点前后排序，不应因为目标节点类型不同而失去拖拽能力。
        if (!isInheritedNode(movedId)) return true;
        let sawCustom = false;
        for (const id of orderedIds) {
          if (isInheritedNode(id)) {
            if (sawCustom) return false;
          } else {
            sawCustom = true;
          }
        }
        return true;
      };

      // active 不在同层 → 跨层移到 over 所在父级
      if (oldIndex === -1) {
        const targetParent = overContext.parentId;
        if (isGroup(activeId) && targetParent) {
          let current = groups.find((group) => group.id === targetParent);
          while (current) {
            if (current.id === activeId) return;
            current = current.parent_id
              ? groups.find((group) => group.id === current?.parent_id)
              : undefined;
          }
        }
        const reordered = [...ids];
        reordered.splice(newIndex, 0, activeId);
        if (!preservesInheritedPrefix(reordered, activeId)) return;
        void (async () => {
          if (isGroup(activeId)) await moveGroupToParent(activeId, targetParent);
          else if (isProject(activeId)) await moveProjectToGroup(activeId, targetParent);
          else return;
          await reorderItems(targetParent, reordered);
        })();
        return;
      }

      // 同层 reorder
      const reordered = [...ids];
      reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, activeId);
      if (!preservesInheritedPrefix(reordered, activeId)) return;
      void reorderItems(overContext.parentId, reordered);
  }, [groups, projects, tree, reorderItems, moveGroupToParent, moveProjectToGroup]);
}
