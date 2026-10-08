import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { getWorktreeShortLabel } from "../../projects/api/worktreeLabels";
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
  /** Persistent alias/Wn, or explicit ID when metadata is unavailable; empty for root. */
  worktreeLabel: string;
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
  const retainedWorktree = worktree?.project_id === projectId ? worktree : null;
  const validWorktree = retainedWorktree?.status === "active" ? retainedWorktree : null;
  return {
    sessionId: session.id,
    projectId,
    projectKey: getTerminalProjectKey(projectId),
    project: project?.name.trim() || labels.unboundProject,
    worktreeId,
    worktreeKind: worktreeId ? validWorktree ? "worktree" : "missing-worktree" : "root",
    worktreeLabel: worktreeId ? getWorktreeShortLabel(retainedWorktree) || worktreeId : "",
    worktreeName: retainedWorktree ? retainedWorktree.display_name?.trim() || retainedWorktree.name : worktreeId,
    worktreePath: retainedWorktree?.path ?? (worktreeId ? null : project?.environment_type === "ssh" ? project.remote_path || null : project?.path || null),
    branch: retainedWorktree?.branch ?? null,
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

/** Display-only contexts: never expand the supplied visible members to backing panes. */
export type WorkspanTabGroupContext = Pick<TerminalProjectMembership,
  "projectKey" | "project" | "worktreeKind" | "worktreeId" | "worktreeName">
  & Partial<Pick<TerminalProjectMembership, "projectId" | "worktreeLabel">>;
export interface WorkspanTabGroupDescriptor extends WorkspanProjectGroup {
  contexts: WorkspanTabGroupContext[];
}

export function workspanContextIdentity(context: WorkspanTabGroupContext): string {
  return JSON.stringify([context.projectKey, context.worktreeKind, context.worktreeId]);
}

export function describeWorkspanTabGroup(members: readonly TerminalProjectMembership[]): WorkspanTabGroupDescriptor {
  const contexts = [...new Map(members.map((member) => [workspanContextIdentity(member), {
    projectKey: member.projectKey, projectId: member.projectId, project: member.project, worktreeLabel: member.worktreeLabel, worktreeKind: member.worktreeKind,
    worktreeId: member.worktreeId, worktreeName: member.worktreeName,
  }])).values()].sort((a, b) => workspanContextIdentity(a).localeCompare(workspanContextIdentity(b)));
  const first = contexts[0];
  const kind = new Set(contexts.map((item) => item.projectKey)).size > 1 ? "mixed-project"
    : contexts.length > 1 ? "cross-worktree" : first?.worktreeKind ?? "root";
  return { key: JSON.stringify(contexts.map(workspanContextIdentity)), kind, contexts,
    worktreeId: contexts.length === 1 ? first.worktreeId : null,
    worktreeName: contexts.length === 1 ? first.worktreeName : null };
}

/** Use the unfiltered context universe so status/overflow cannot change disambiguation. */
export function formatWorkspanGroupTitle(
  group: WorkspanTabGroupDescriptor, universe: readonly WorkspanTabGroupContext[],
  labels: { root: string; missing: string; cross: string; mixed: string }, showProject: boolean,
): string {
  const name = (context: WorkspanTabGroupContext) => context.worktreeKind === "root" ? labels.root
    : context.worktreeKind === "missing-worktree" ? `${labels.missing} · ${context.worktreeLabel || context.worktreeId}`
    : context.worktreeName ?? labels.missing;
  const contexts = [...new Map([...universe, ...group.contexts].map((context) =>
    [workspanContextIdentity(context), context])).values()]
    .sort((a, b) => workspanContextIdentity(a).localeCompare(workspanContextIdentity(b)));
  const baseLine = (context: WorkspanTabGroupContext, withProject: boolean) => {
    const duplicateName = universe.some((other) => other.projectKey === context.projectKey
      && workspanContextIdentity(other) !== workspanContextIdentity(context)
      && name(other).toLocaleLowerCase() === name(context).toLocaleLowerCase());
    const duplicateProject = universe.some((other) => other.projectKey !== context.projectKey
      && other.project.toLocaleLowerCase() === context.project.toLocaleLowerCase());
    const project = context.project + (duplicateProject ? ` · ${context.projectId ?? context.projectKey}` : "");
    const worktree = name(context) + (duplicateName ? ` · ${context.worktreeId ?? workspanContextIdentity(context)}` : "");
    return withProject ? `${project} / ${worktree}` : worktree;
  };
  const resolveLines = (withProject: boolean) => {
    const bases = contexts.map((context) => baseLine(context, withProject));
    // Reserve every composed label before assigning fallbacks, including literals
    // which look like an identity suffix. Sort identities, not visible row order.
    const reserved = new Set(bases.map((line) => line.toLocaleLowerCase()));
    const used = new Set<string>();
    return new Map(contexts.map((context, index) => {
      const base = bases[index];
      let line = base;
      if (bases.some((other, otherIndex) => otherIndex !== index
        && other.toLocaleLowerCase() === base.toLocaleLowerCase())) {
        const fallback = `${base} · ${workspanContextIdentity(context)}`;
        line = fallback;
        let ordinal = 2;
        while (reserved.has(line.toLocaleLowerCase()) || used.has(line.toLocaleLowerCase())) {
          line = `${fallback} · ${ordinal++}`;
        }
      }
      used.add(line.toLocaleLowerCase());
      return [workspanContextIdentity(context), line];
    }));
  };
  const localLines = resolveLines(showProject);
  const projectLines = showProject ? localLines : resolveLines(true);
  const render = (items: readonly WorkspanTabGroupContext[], kind: WorkspanProjectGroup["kind"]) => {
    const prefix = kind === "mixed-project" ? labels.mixed : kind === "cross-worktree" ? labels.cross : null;
    const lines = kind === "mixed-project" ? projectLines : localLines;
    return [prefix, ...items.map((context) => lines.get(workspanContextIdentity(context))!)]
      .filter(Boolean).join("\n");
  };
  const identity = JSON.stringify(group.contexts.map(workspanContextIdentity));
  const title = render(group.contexts, group.kind);
  // A literal multiline name can equal an entire cross/mixed header. Match only
  // subsets capable of spelling this title; do not enumerate the context powerset.
  const collides = (candidate: string): boolean => {
    if (contexts.some((context) => render([context], context.worktreeKind) === candidate
      && JSON.stringify([workspanContextIdentity(context)]) !== identity)) return true;
    for (const kind of ["cross-worktree", "mixed-project"] as const) {
      const prefix = kind === "mixed-project" ? labels.mixed : labels.cross;
      const start = prefix ? `${prefix}\n` : "";
      if (!candidate.startsWith(start)) continue;
      const lines = kind === "mixed-project" ? projectLines : localLines;
      const match = (offset: number, next: number, selected: WorkspanTabGroupContext[]): boolean => {
        for (let index = next; index < contexts.length; index++) {
          const context = contexts[index];
          if (kind === "cross-worktree" && selected.length && selected[0].projectKey !== context.projectKey) continue;
          const line = lines.get(workspanContextIdentity(context))!;
          if (!candidate.startsWith(line, offset)) continue;
          const items = [...selected, context];
          const end = offset + line.length;
          if (end === candidate.length && items.length > 1
            && (kind === "cross-worktree" || items.some((item) => item.projectKey !== items[0].projectKey))
            && JSON.stringify(items.map(workspanContextIdentity)) !== identity) return true;
          if (candidate[end] === "\n" && match(end + 1, index + 1, items)) return true;
        }
        return false;
      };
      if (match(start.length, 0, [])) return true;
    }
    return false;
  };
  if (!collides(title)) return title;
  // JSON identity has no literal newlines: generated group suffixes cannot alias
  // each other. Still reserve raw group text, including literal suffix blockers.
  const fallback = `${title}\n · ${identity}`;
  let resolved = fallback;
  let ordinal = 2;
  while (collides(resolved)) resolved = `${fallback} · ${ordinal++}`;
  return resolved;
}

export function groupProjectWorkspanModels<T extends {
  workspan: { id: string }; members: TerminalProjectMembership[]; projectMemberships: WorkspanProjectMembership[];
}>(models: readonly T[], projectKey: string): Array<{ group: WorkspanTabGroupDescriptor; models: T[] }> {
  const groups = new Map<string, { group: WorkspanTabGroupDescriptor; models: T[] }>();
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.workspan.id)) continue;
    seen.add(model.workspan.id);
    if (!model.projectMemberships.some((item) => item.projectKey === projectKey)) continue;
    const group = describeWorkspanTabGroup(model.members);
    const existing = groups.get(group.key) ?? { group, models: [] };
    existing.models.push(model);
    groups.set(group.key, existing);
  }
  return [...groups.values()];
}
