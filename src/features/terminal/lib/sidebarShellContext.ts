import type { Group, Project, ProjectEnvironmentType, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { parseWslPath, toWslUnc, windowsPathToLinux } from "../../../shared/lib/wslPaths";
import { resolveProjectPath } from "../../projects/api/groupPath";
import { parseProjectEnvVars } from "../../providers/api/providerSwitching";
import { findWorktreeForSession, resolveProjectForSession } from "../api/terminalProject";

export interface SidebarShellContext {
  readonly key: string;
  readonly projectId: string;
  readonly worktreeId?: string;
  readonly cwd: string;
  readonly shell?: string;
  readonly envVars?: Readonly<Record<string, string>>;
  readonly environmentType: ProjectEnvironmentType;
  readonly sshHostId?: string;
  readonly wslDistroName?: string;
}

export interface SidebarShellContextInput {
  activeSession?: TerminalSession | null;
  sessions: TerminalSession[];
  projects: Project[];
  worktrees: WorktreeRecord[];
  groups: Group[];
  /** Explicit fallback only. An anonymous Pi must never imply a project. */
  scope?: { projectId: string; worktreeId?: string } | null;
}

/** Captures root launch environment, never cwd-after-cd, resume identity or CLI command.
 * Missing physical roots are finally rejected by the existing managed launch path.
 */
export function resolveSidebarShellContext(input: SidebarShellContextInput): SidebarShellContext | null {
  const { sessions, projects, worktrees, groups } = input;
  let source = input.activeSession;
  const seen = new Set<string>();
  while (source?.kind === "subagent-transcript") {
    if (seen.has(source.id)) throw new Error("sidebar_shell_context_cycle");
    seen.add(source.id);
    source = sessions.find(item => item.id === source?.subagent?.parentSessionId);
  }
  // Anonymous Pi intentionally has no cwd/project ownership, even if stale metadata exists.
  if (source?.kind === "ephemeral-pi") source = undefined;
  let project = resolveProjectForSession(source ?? null, sessions, projects, new Map(projects.map(item => [item.id, item])));
  // Project-bound PTYs keep launch ownership after mutable OSC/cd updates.
  let worktree = source?.projectId && !source.worktreeId && source.kind !== "file-editor"
    ? null : findWorktreeForSession(source ?? null, sessions, worktrees);
  if (source?.worktreeId && !worktree) throw new Error("sidebar_shell_worktree_missing");
  if (source?.projectId && !projects.some(item => item.id === source?.projectId)) throw new Error("sidebar_shell_project_missing");
  if (!project && worktree) project = projects.find(item => item.id === worktree!.project_id) ?? null;
  if (!project && input.scope) {
    source = undefined; // Explicit fallback does not inherit an unrelated terminal environment.
    project = projects.find(item => item.id === input.scope!.projectId) ?? null;
    if (!project) throw new Error("sidebar_shell_project_missing");
    worktree = input.scope.worktreeId ? worktrees.find(item => item.id === input.scope!.worktreeId) ?? null : null;
    if (input.scope.worktreeId && !worktree) throw new Error("sidebar_shell_worktree_missing");
  }
  if (!project) return null;
  if (worktree && (worktree.status !== "active" || worktree.creation_pending || worktree.project_id !== project.id)) {
    throw new Error("sidebar_shell_worktree_missing");
  }
  const environmentType = source?.environmentType ?? project.environment_type ?? "local";
  const sshHostId = source?.sshHostId || project.ssh_host_id || undefined;
  const ssh = environmentType === "ssh" || Boolean(sshHostId);
  // SSH project launch currently always uses remote_path, not options.cwd. Reject
  // unsupported remote worktrees instead of silently launching at a different root.
  if (ssh && worktree) throw new Error("sidebar_shell_ssh_worktree_unsupported");
  let cwd = (ssh ? project.remote_path : worktree?.path || resolveProjectPath(project, groups)).trim();
  if (!cwd || (ssh && !sshHostId)) throw new Error("sidebar_shell_root_missing");
  const wsl = !ssh && (environmentType === "wsl" || source?.shell === "wsl" || project.shell === "wsl");
  let wslDistroName: string | undefined;
  if (wsl) {
    const unc = parseWslPath(cwd);
    wslDistroName = unc?.distro || source?.wslDistroName;
    const linuxPath = unc?.linuxPath ?? windowsPathToLinux(cwd) ?? (cwd.startsWith("/") && !cwd.startsWith("//") ? cwd : null);
    if (!wslDistroName || !linuxPath) throw new Error("sidebar_shell_wsl_environment_missing");
    // createSession has no distro parameter. Carry it in cwd for the native
    // UNC decoder, which passes --distribution and --cd to wsl.exe.
    cwd = toWslUnc(wslDistroName, linuxPath);
  }
  const shell = wsl ? "wsl" : ssh ? source?.shell || project.shell || undefined : "pwsh";
  const envVars = source?.envVars ? { ...source.envVars } : parseProjectEnvVars(project);
  // POSIX and remote paths are case-sensitive; normalize Windows roots only.
  const rootKey = !ssh && !wsl && /^(?:[a-z]:|\\\\)/i.test(cwd)
    ? cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    : cwd.replace(/\/+$/, "") || "/";
  const key = JSON.stringify([project.id, worktree?.id ?? null, ssh ? "ssh" : wsl ? "wsl" : "local",
    rootKey, sshHostId ?? null, wslDistroName ?? null, shell ?? null,
    Object.entries(envVars ?? {}).sort(([left], [right]) => left.localeCompare(right))]);
  return Object.freeze({ key, projectId: project.id, worktreeId: worktree?.id, cwd, shell,
    envVars: envVars ? Object.freeze({ ...envVars }) : undefined,
    environmentType: ssh ? "ssh" : wsl ? "wsl" : "local", sshHostId, wslDistroName });
}
