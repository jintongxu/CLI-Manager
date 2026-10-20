import { useCallback } from "react";
import type { Project, TerminalSession } from "../../../shared/types/index";
import type { TerminalSidePanelTab } from "../components/TerminalSidePanel";

interface Options {
  ensureStatsPanelAllowed: () => Promise<boolean>;
  filePanelProject: Project | null;
  panelSession: TerminalSession | null;
  projectById: Map<string, Project>;
  rejectUnsupportedCapability: (project: Project | null, capability: "files" | "history" | "statistics" | "git") => boolean;
  setSidePanelTab: (tab: TerminalSidePanelTab) => void;
  syncFilePanelProject: (project: Project) => Promise<boolean>;
}

export function useTerminalSidePanelTabChange({
  ensureStatsPanelAllowed,
  filePanelProject,
  panelSession,
  projectById,
  rejectUnsupportedCapability,
  setSidePanelTab,
  syncFilePanelProject,
}: Options) {
  return useCallback((tab: TerminalSidePanelTab) => {
    const project = panelSession?.projectId ? projectById.get(panelSession.projectId) ?? null : null;
    if (tab === "stats") {
      if (rejectUnsupportedCapability(project, "statistics")) return;
      void ensureStatsPanelAllowed().then((allowed) => {
        if (allowed) setSidePanelTab("stats");
      });
      return;
    }
    if (tab === "files") {
      if (!filePanelProject) return;
      if (rejectUnsupportedCapability(filePanelProject, "files")) return;
      void syncFilePanelProject(filePanelProject).then((allowed) => {
        if (allowed) setSidePanelTab("files");
      });
      return;
    }
    if (tab === "git" && project?.environment_type !== "ssh" && rejectUnsupportedCapability(project, "git")) return;
    if (tab === "replay" && rejectUnsupportedCapability(project, "history")) return;
    setSidePanelTab(tab);
  }, [ensureStatsPanelAllowed, filePanelProject, panelSession, projectById, rejectUnsupportedCapability, setSidePanelTab, syncFilePanelProject]);
}
