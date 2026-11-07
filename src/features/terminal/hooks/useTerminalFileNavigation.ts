import { useEffect } from "react";
import { showProjectSpace } from "../../workspace/api/primarySpaceState";
import { toast } from "sonner";
import type { Project, SshHost, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { logError } from "../../../shared/platform/logger";
import { isSameProjectFileContext, resolveProjectForSessionFileContext } from "../api/terminalProject";
import { useFileExplorerStore } from "../../files/api/fileExplorerStore";
import type { TerminalFileNavigationRequest } from "../lib/terminalFileNavigation";
import { TERMINAL_FILE_NAVIGATION_REQUEST_EVENT } from "../lib/terminalFileNavigation";

interface Options {
  openFileEditorPane: (project: Project, mode?: "beside" | "current") => void;
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
  openFileEditorPane, openFilesPanelForProject, projectById, projects,
  revealFilePath, sessions, sshHosts, t, worktrees,
}: Options): void {
  useEffect(() => {
    let revision = 0;
    let stopWatching: (() => void) | undefined;
    const handleNavigation = (event: Event) => {
      const request = (event as CustomEvent<TerminalFileNavigationRequest>).detail;
      const sourceSession = sessions.find((session) => session.id === request.sessionId) ?? null;
      const project = resolveProjectForSessionFileContext(sourceSession, sessions, projects, projectById, worktrees, sshHosts);
      if (!project) return;
      const id = ++revision;
      stopWatching?.();
      // The panel may intentionally switch to this project; once reached, any departure
      // invalidates the request, including an eventual return to the same root.
      let reachedContext = isSameProjectFileContext(useFileExplorerStore.getState().project, project);
      stopWatching = useFileExplorerStore.subscribe((state) => {
        const matches = isSameProjectFileContext(state.project, project);
        if (reachedContext && !matches) revision += 1;
        if (matches) reachedContext = true;
      });
      const isCurrent = () => id === revision
        && isSameProjectFileContext(useFileExplorerStore.getState().project, project);
      showProjectSpace();
      void (async () => {
        try {
          const opened = await openFilesPanelForProject(project);
          if (!opened || !isCurrent()) return;
          const revealed = await revealFilePath(request.path, {
            ...(request.lineNumber ? { lineNumber: request.lineNumber } : {}),
            ...(request.columnNumber ? { columnNumber: request.columnNumber } : {}),
          });
          if (revealed && isCurrent() && request.kind === "file"
            && useFileExplorerStore.getState().activeFilePath === request.path) openFileEditorPane(project, "beside");
        } catch (error) {
          if (!isCurrent()) return;
          logError("Failed to reveal terminal relative path", { request, error });
          toast.error(t("files.toast.openFileFailed"), { description: String(error) });
        }
      })();
    };
    window.addEventListener(TERMINAL_FILE_NAVIGATION_REQUEST_EVENT, handleNavigation);
    return () => {
      revision += 1;
      stopWatching?.();
      window.removeEventListener(TERMINAL_FILE_NAVIGATION_REQUEST_EVENT, handleNavigation);
    };
  }, [openFileEditorPane, openFilesPanelForProject, projectById, projects, revealFilePath, sessions, sshHosts, t, worktrees]);
}
