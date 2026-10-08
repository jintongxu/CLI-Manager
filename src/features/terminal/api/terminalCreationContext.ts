import type { Group, Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { resolveProjectPath } from "../../projects/api/groupPath";
import { parseProjectEnvVars } from "../../providers/api/providerSwitching";
import { findWorktreeForSession, resolveProjectForSession } from "./terminalProject";

/** Creation copies launch environment only, never presentation or runtime identity. */
export function withoutTerminalTitle<T extends { title?: string }>(options: T): Omit<T, "title"> {
  const { title: _title, ...environment } = options;
  return environment;
}

export function resolveTerminalCreationContext(
  source: TerminalSession | null | undefined,
  sessions: TerminalSession[], projects: Project[], worktrees: WorktreeRecord[], groups: Group[],
) {
  const seen = new Set<string>();
  while (source?.kind === "subagent-transcript") {
    if (seen.has(source.id)) return null;
    seen.add(source.id);
    source = sessions.find((item) => item.id === source?.subagent?.parentSessionId);
  }
  const project = resolveProjectForSession(source ?? null, sessions, projects, new Map(projects.map((item) => [item.id, item])));
  const worktree = findWorktreeForSession(source ?? null, sessions, worktrees);
  if ((source?.worktreeId && !worktree) || (worktree && (worktree.status !== "active" || (project && worktree.project_id !== project.id)))) return null;
  const fileContext = source?.kind === "file-editor" ? source.fileEditor : undefined;
  return {
    projectId: project?.id,
    worktreeId: worktree?.id,
    cwd: worktree?.path || fileContext?.projectPath || source?.remotePath || source?.cwd || (project ? resolveProjectPath(project, groups) : undefined),
    shell: source?.shell ?? project?.shell ?? undefined,
    envVars: source?.envVars ? { ...source.envVars } : (project ? parseProjectEnvVars(project) : undefined),
    sshHostId: source?.sshHostId ?? project?.ssh_host_id ?? undefined,
    // Undefined delegates to the current project/default launch policy. Never
    // copy source.startupCmd: history terminals may carry a conversation resume.
    startupCmd: source?.isAgentSession === false && !source.startupCmd ? "" : undefined,
  };
}
