import type { TerminalSession, Project, Group, WorktreeRecord } from "../../../shared/types/index";
import { resolveProjectPath } from "../../projects/api/groupPath";
import { parseProjectEnvVars } from "../../providers/api/providerSwitching";

export function assertRecoverySource(session: TerminalSession | undefined): TerminalSession {
  if (!session || (session.kind ?? "pty") !== "pty" || session.remoteHandoff) throw new Error("terminal_recovery_session_missing");
  if (session.environmentType === "ssh" || session.sshHostId) throw new Error("terminal_recovery_unsupported_remote");
  return session;
}

export function resolveRecoveryEnvironment(session: TerminalSession, state: { projects: Project[]; groups: Group[]; worktrees: WorktreeRecord[] }) {
  assertRecoverySource(session);
  const project = state.projects.find(item => item.id === session.projectId);
  if (project?.environment_type === "ssh" || project?.ssh_host_id) throw new Error("terminal_recovery_unsupported_remote");
  const worktree = state.worktrees.find(item => item.id === session.worktreeId && item.project_id === session.projectId && item.status === "active");
  if (session.worktreeId && !worktree) throw new Error("terminal_recovery_worktree_missing");
  let cwd = session.cwd?.trim() || worktree?.path || (project ? resolveProjectPath(project, state.groups) : undefined);
  if (!cwd) throw new Error("terminal_recovery_cwd_missing");
  const wsl = session.environmentType === "wsl" || session.shell === "wsl" || project?.environment_type === "wsl";
  // UNC is the existing native launch protocol for selecting a distro + POSIX cwd.
  if (wsl && !/^\\\\(?:wsl\$|wsl\.localhost)\\/i.test(cwd)) {
    const inherited = worktree?.path || (project ? resolveProjectPath(project, state.groups) : "");
    const distro = session.wslDistroName || /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\/]+)/i.exec(inherited)?.[1];
    if (!distro || !cwd.startsWith("/")) throw new Error("terminal_recovery_wsl_environment_missing");
    cwd = `\\\\wsl.localhost\\${distro}${cwd.replace(/\//g, "\\")}`;
  }
  return {
    projectId: session.projectId, worktreeId: session.worktreeId, cwd,
    shell: wsl ? "wsl" : session.shell ?? project?.shell ?? undefined,
    envVars: session.envVars ? { ...session.envVars } : project ? parseProjectEnvVars(project) : undefined,
  };
}
