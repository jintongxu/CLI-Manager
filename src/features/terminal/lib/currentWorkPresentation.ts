import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { getWorktreeSidebarLabel } from "../../projects/api/worktreeMetadata";

export function formatTerminalTabContext(
  session: TerminalSession,
  project?: Project,
  worktree?: WorktreeRecord | null,
  labels: { unboundProject?: string; anonymousPi?: string } = {},
): string {
  const projectName = project?.name?.trim()
    || (session.environmentType === "ssh" && session.title.trim() && session.title.trim() !== "Terminal"
      ? session.title.trim()
      : session.kind === "ephemeral-pi" ? labels.anonymousPi ?? labels.unboundProject ?? "Independent anonymous Pi" : labels.unboundProject ?? "Unbound project");
  const worktreeName = worktree?.status === "active"
    ? getWorktreeSidebarLabel(worktree) || "Worktree"
    : session.worktreeId ? "Worktree missing" : "Project root";
  const environment = session.environmentType === "ssh" ? "SSH" : session.environmentType === "wsl" ? "WSL" : "Local";
  const cli = session.cliTool?.trim() || project?.cli_tool?.trim() || session.shell?.trim() || "Shell";
  return [projectName, worktreeName, session.environmentType === "ssh" ? environment : cli].join(" · ");
}
