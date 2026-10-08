import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import type { TabNotificationState } from "../state";
import { findWorktreeForSession, resolveProjectForSession } from "./terminalProject";

export interface ProjectTabLabels {
  unboundProject: string;
  missingWorktree: string;
}

export interface TerminalProjectMembership {
  sessionId: string;
  projectId: string | null;
  projectKey: string;
  project: string;
  worktreeId: string | null;
  worktreeKind: "root" | "worktree" | "missing-worktree";
  worktreeName: string | null;
  worktreePath: string | null;
  branch: string | null;
  environmentType: TerminalSession["environmentType"];
  sshHostId: string | undefined;
}

export interface TerminalProjectOption {
  key: string;
  projectId: string | null;
  project: string;
  sessionIds: string[];
  count: number;
  running: number;
  done: number;
  failed: number;
  attention: number;
  members: TerminalProjectMembership[];
}

export interface WorkspanProjectGroup {
  key: string;
  kind: "root" | "worktree" | "missing-worktree" | "cross-worktree" | "mixed-project";
  worktreeId: string | null;
  worktreeName: string | null;
}

export interface WorkspanProjectMembership {
  projectKey: string;
  projectId: string | null;
  project: string;
  sessionIds: string[];
  activationSessionId: string;
  members: TerminalProjectMembership[];
  group: WorkspanProjectGroup;
}

export function getTerminalProjectKey(projectId: string | null | undefined): string {
  return projectId ? `project:${JSON.stringify(projectId)}` : "unbound";
}

// Identity belongs to terminalProject; presentation must not infer it from titles.
export function resolveTerminalProjectMembership(
  session: TerminalSession,
  sessions: TerminalSession[],
  projects: Map<string, Project>,
  worktrees: WorktreeRecord[],
  labels: ProjectTabLabels,
): TerminalProjectMembership {
  const project = resolveProjectForSession(session, sessions, [...projects.values()], projects);
  let source = session;
  const seen = new Set<string>();
  while (source.kind === "subagent-transcript" && source.subagent?.parentSessionId && !seen.has(source.id)) {
    seen.add(source.id);
    const parent = sessions.find((item) => item.id === source.subagent?.parentSessionId);
    if (!parent || seen.has(parent.id)) break;
    source = parent;
  }
  const projectId = project?.id ?? (source.kind === "file-editor" ? source.fileEditor?.projectId : source.projectId) ?? null;
  const worktree = findWorktreeForSession(session, sessions, worktrees);
  const worktreeId = source.worktreeId ?? worktree?.id ?? null;
  const validWorktree = worktree?.status === "active" && worktree.project_id === projectId ? worktree : null;
  return {
    sessionId: session.id,
    projectId,
    projectKey: getTerminalProjectKey(projectId),
    project: project?.name.trim() || labels.unboundProject,
    worktreeId,
    worktreeKind: worktreeId ? validWorktree ? "worktree" : "missing-worktree" : "root",
    worktreeName: validWorktree ? validWorktree.display_name?.trim() || validWorktree.name : worktreeId ? labels.missingWorktree : null,
    worktreePath: validWorktree?.path ?? null,
    branch: validWorktree?.branch ?? null,
    environmentType: session.environmentType,
    sshHostId: session.sshHostId,
  };
}

export function buildTerminalProjectOptions(
  sessionGroups: ReadonlyArray<{ sessionIds: string[] }>,
  sessions: TerminalSession[],
  projects: Map<string, Project>,
  worktrees: WorktreeRecord[],
  labels: ProjectTabLabels,
  notifications: Record<string, TabNotificationState> = {},
): TerminalProjectOption[] {
  const options = new Map<string, TerminalProjectOption>();
  const seen = new Set<string>();
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const group of sessionGroups) for (const id of group.sessionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const session = byId.get(id);
    if (!session) continue;
    const member = resolveTerminalProjectMembership(session, sessions, projects, worktrees, labels);
    let option = options.get(member.projectKey);
    if (!option) {
      option = {
        key: member.projectKey, projectId: member.projectId, project: member.project,
        sessionIds: [], members: [], count: 0, running: 0, done: 0, failed: 0, attention: 0,
      };
      options.set(option.key, option);
    }
    option.sessionIds.push(id);
    option.members.push(member);
    option.count += 1;
    const status = notifications[id] ?? "none";
    if (status !== "none") option[status] += 1;
  }
  return [...options.values()];
}

export function buildWorkspanProjectMemberships(
  members: TerminalProjectMembership[],
  activeSessionId: string | null,
): WorkspanProjectMembership[] {
  const projects = new Map<string, TerminalProjectMembership[]>();
  for (const member of members) {
    const existing = projects.get(member.projectKey) ?? [];
    if (!existing.some((item) => item.sessionId === member.sessionId)) existing.push(member);
    projects.set(member.projectKey, existing);
  }
  return [...projects.entries()].map(([projectKey, projectMembers]) => {
    const first = projectMembers[0];
    const worktreeKeys = new Set(projectMembers.map((member) => JSON.stringify([member.worktreeKind, member.worktreeId])));
    const kind = projects.size > 1 ? "mixed-project" : worktreeKeys.size > 1 ? "cross-worktree" : first.worktreeKind;
    return {
      projectKey, projectId: first.projectId, project: first.project,
      sessionIds: projectMembers.map((member) => member.sessionId), members: projectMembers,
      activationSessionId: projectMembers.find((member) => member.sessionId === activeSessionId)?.sessionId ?? first.sessionId,
      group: {
        key: JSON.stringify([projectKey, kind, kind === "worktree" || kind === "missing-worktree" ? first.worktreeId : null]),
        kind,
        worktreeId: kind === "worktree" || kind === "missing-worktree" ? first.worktreeId : null,
        worktreeName: kind === "worktree" || kind === "missing-worktree" ? first.worktreeName : null,
      },
    };
  });
}

export interface ProjectWorkspanTarget {
  workspanId: string;
  sessionId: string;
}

// Runtime-only memory is owned by the UI lane; validate it against scoped members.
export function resolveProjectWorkspanTarget(
  models: ReadonlyArray<{ workspan: { id: string }; projectMemberships: WorkspanProjectMembership[] }>,
  projectKey: string,
  recent?: ProjectWorkspanTarget | null,
): ProjectWorkspanTarget | null {
  if (recent) {
    const membership = models.find((model) => model.workspan.id === recent.workspanId)
      ?.projectMemberships.find((item) => item.projectKey === projectKey);
    if (membership?.sessionIds.includes(recent.sessionId)) return recent;
  }
  for (const model of models) {
    const membership = model.projectMemberships.find((item) => item.projectKey === projectKey);
    if (membership) return { workspanId: model.workspan.id, sessionId: membership.activationSessionId };
  }
  return null;
}

export function groupProjectWorkspanModels<T extends { projectMemberships: WorkspanProjectMembership[] }>(
  models: readonly T[], projectKey: string,
): Array<{ group: WorkspanProjectGroup; models: T[] }> {
  const groups = new Map<string, { group: WorkspanProjectGroup; models: T[] }>();
  for (const model of models) {
    const membership = model.projectMemberships.find((item) => item.projectKey === projectKey);
    if (!membership) continue;
    const existing = groups.get(membership.group.key) ?? { group: membership.group, models: [] };
    existing.models.push(model);
    groups.set(membership.group.key, existing);
  }
  return [...groups.values()];
}
