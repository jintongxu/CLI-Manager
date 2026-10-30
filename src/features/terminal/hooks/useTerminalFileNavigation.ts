import { useEffect } from "react";
import { showProjectSpace } from "../../workspace/api/primarySpaceState";
import { toast } from "sonner";
import type { Project, SshHost, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { logError } from "../../../shared/platform/logger";
import { resolveProjectForSessionFileContext } from "../api/terminalProject";
import type { TerminalFileNavigationRequest } from "../lib/terminalFileNavigation";
import { TERMINAL_FILE_NAVIGATION_REQUEST_EVENT } from "../lib/terminalFileNavigation";

interface Options {
  openFileEditorPane: (project: Project) => void;
  openFilesPanelForProject: (project: Project) => Promise<boolean>;
  projectById: Map<string, Project>;
  projects: Project[];
  revealFilePath: (path: string, options?: { lineNumber?: number; columnNumber?: number }) => Promise<boolean>;
  sessions: TerminalSession[];
  sshHosts: SshHost[];
  t: (key: "files.toast.openFileFailed") => string;
  worktrees: WorktreeRecord[];
}

export function useTerminalFileNavigation({
  openFileEditorPane,
  openFilesPanelForProject,
  projectById,
  projects,
  revealFilePath,
  sessions,
  sshHosts,
  t,
  worktrees,
}: Options): void {
  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const request = (event as CustomEvent<TerminalFileNavigationRequest>).detail;
      const sourceSession = sessions.find((session) => session.id === request.sessionId) ?? null;
      const project = resolveProjectForSessionFileContext(sourceSession, sessions, projects, projectById, worktrees, sshHosts);
      if (!project) return;
      showProjectSpace();
      void openFilesPanelForProject(project).then(async (opened) => {
        if (!opened) return;
        try {
          const revealed = await revealFilePath(request.path, {
            ...(request.lineNumber ? { lineNumber: request.lineNumber } : {}),
            ...(request.columnNumber ? { columnNumber: request.columnNumber } : {}),
          });
          if (revealed && request.kind === "file") openFileEditorPane(project);
        } catch (error) {
          logError("Failed to reveal terminal relative path", { request, error });
          toast.error(t("files.toast.openFileFailed"), { description: String(error) });
        }
      });
    };
    window.addEventListener(TERMINAL_FILE_NAVIGATION_REQUEST_EVENT, handleNavigation);
    return () => window.removeEventListener(TERMINAL_FILE_NAVIGATION_REQUEST_EVENT, handleNavigation);
  }, [openFileEditorPane, openFilesPanelForProject, projectById, projects, revealFilePath, sessions, sshHosts, t, worktrees]);
}
