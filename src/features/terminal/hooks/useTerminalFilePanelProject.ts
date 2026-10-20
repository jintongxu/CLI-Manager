import { useMemo } from "react";
import type { Project, SshHost, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { resolveProjectForSessionFileContext } from "../api/terminalProject";

export function useTerminalFilePanelProject(
  session: TerminalSession | null,
  sessions: TerminalSession[],
  projects: Project[],
  projectById: Map<string, Project>,
  worktrees: WorktreeRecord[],
  sshHosts: SshHost[],
): Project | null {
  return useMemo(
    () => resolveProjectForSessionFileContext(session, sessions, projects, projectById, worktrees, sshHosts),
    [projectById, projects, session, sessions, sshHosts, worktrees],
  );
}
