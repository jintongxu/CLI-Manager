import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { getWorktreeSidebarLabel } from "../../projects/api/worktreeMetadata";

export function formatTerminalTabContext(
  session: TerminalSession,
  project?: Project,
  worktree?: WorktreeRecord | null,
): string {
  const projectName = project?.name?.trim() || "Unbound project";
  const worktreeName = worktree?.status === "active"
    ? getWorktreeSidebarLabel(worktree) || "Worktree"
    : session.worktreeId ? "Worktree missing" : "Project root";
  const environment = session.environmentType === "ssh" ? "SSH" : session.environmentType === "wsl" ? "WSL" : "Local";
  const cli = session.cliTool?.trim() || project?.cli_tool?.trim() || session.shell?.trim() || "Shell";
  return [projectName, worktreeName, session.environmentType === "ssh" ? environment : cli].join(" · ");
}
