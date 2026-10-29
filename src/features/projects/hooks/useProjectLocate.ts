import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { Project, TreeNode } from "../../../shared/types/index";
import { useI18n } from "../../../shared/i18n/index";
import { resolveSidebarLocateTarget, type SidebarLocateTarget } from "../lib/sidebarTools";
import type { ProjectListFilter } from "../components/SidebarHeader";

export interface ProjectLocateRequest {
  worktreeId?: string;
  projectId: string;
  /** 随请求带上名称：滚动阶段可能才发现目标行不可达，此时已取不到 Project 对象。 */
  projectName: string;
  /** 单调递增：同一项目重复定位靠它触发重新滚动（选中态没变时不会重跑副作用）。 */
  nonce: number;
}

interface UseProjectLocateParams {
  tree: TreeNode[];
  projectFilter: ProjectListFilter;
  setProjectFilter: (filter: ProjectListFilter) => void;
  setCollapsedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedId: (projectId: string | null) => void;
  /** 定位动作开始前执行，用于关闭右键菜单。 */
  onBeforeLocate?: () => void;
}

/**
 * Reveal an existing project or active session owner in the normal tree.
 *
 * 置顶项是主列表节点的副本（data-tree-key 为 `pin:p:<id>`，主列表为 `p:<id>`），
 * 置顶区有独立滚动区，因此副本滚走后无从知道原项目在哪。定位分三步：
 * ① 筛选切回「全部」，否则项目可能不在树里；② 展开折叠的祖先分组，否则子节点不渲染；
 * ③ 选中目标并递增 nonce，ProjectTree 清除 local search 后滚动，不聚焦终端。
 */
export function useProjectLocate({
  tree,
  projectFilter,
  setProjectFilter,
  setCollapsedIds,
  setSelectedId,
  onBeforeLocate,
}: UseProjectLocateParams) {
  const { t } = useI18n();
  const [locateRequest, setLocateRequest] = useState<ProjectLocateRequest | null>(null);
  const nonceRef = useRef(0);

  const locateTarget = useCallback((target: SidebarLocateTarget | null) => {
    if (!target) return;
    onBeforeLocate?.();
    if (projectFilter !== "all") setProjectFilter("all");
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of target.ancestorIds) next.delete(id);
      return next.size === prev.size ? prev : next;
    });
    setSelectedId(target.worktreeId ?? target.projectId);
    nonceRef.current += 1;
    setLocateRequest({ projectId: target.projectId, projectName: target.projectName,
      worktreeId: target.worktreeId, nonce: nonceRef.current });
  }, [onBeforeLocate, projectFilter, setCollapsedIds, setProjectFilter, setSelectedId]);

  const locateProject = useCallback((project: Project) => {
    const target = resolveSidebarLocateTarget(tree, project.id);
    if (!target) {
      toast.info(t("sidebar.locate.notFound"), {
        description: t("sidebar.locate.notFoundDescription", { name: project.name }),
      });
      return;
    }
    locateTarget(target);
  }, [locateTarget, t, tree]);

  return { locateRequest, locateProject, locateTarget };
}
