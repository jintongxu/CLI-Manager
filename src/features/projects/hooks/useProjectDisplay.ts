import { useMemo } from "react";
import type { Project } from "../../../shared/types/index";
import { useProjectStore } from "../api/projectStore";
import { projectDisplayLabels, projectDisplayTooltip } from "../lib/sidebarDisplay";
import type { SidebarTerminalState } from "../lib/sidebarTerminals";
import { useI18n } from "../../../shared/i18n/index";

/** Use the canonical full project collection, not a filtered/pinned copy of the tree. */
export function useProjectDisplay(project: Project | undefined, status: SidebarTerminalState | null) {
  const projects = useProjectStore((store) => store.projects);
  const groups = useProjectStore((store) => store.groups);
  const { t } = useI18n();
  const labels = useMemo(() => projectDisplayLabels(projects, groups), [projects, groups]);
  const label = project ? labels.get(project.id) ?? project.name : "";
  const state = t(`sidebar.terminals.${status || "idle"}`);
  return { label, tooltip: project ? projectDisplayTooltip(project, label, state, groups) : "" };
}
