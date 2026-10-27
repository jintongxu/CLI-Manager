import type { Group, Project, TerminalScope, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import type { SessionStatus } from "../types/terminalStoreTypes";
import { collectProjectIdsForGroup, sessionMatchesTerminalScope } from "../api/terminalScope";
import { findWorktreeForSession, resolveProjectForSession } from "../api/terminalProject";

export interface TerminalNavigationMemory {
  /** Oldest pin first; independent of persisted sidebarPinned. */
  pinnedIds: readonly string[];
  recentIds: readonly string[];
}

export interface TerminalNavigationInput {
  /** Complete THIS window's runtime sessions, never persisted/daemon/history rows. */
  sessions: TerminalSession[];
  sessionStatuses: Readonly<Record<string, SessionStatus>>;
  projects: Project[];
  worktrees: WorktreeRecord[];
  groups: Group[];
  scope: TerminalScope;
  currentSessionId: string | null;
  currentWorkSessionIds: readonly string[];
  currentWorkMode: boolean;
  query?: string;
  navigationOrder?: readonly string[];
}

export interface TerminalNavigationEntry {
  id: string;
  session: TerminalSession;
  project: Project | null;
  worktree: WorktreeRecord | null;
  pinned: boolean;
  current: boolean;
  inCurrentWork: boolean;
}

export interface TerminalNavigationGroup {
  key: string;
  /** Project name, disambiguated with the project id when several projects share a name. */
  label: string;
  /** Path or environment hint shown under the group heading. */
  subtitle: string | null;
  entries: TerminalNavigationEntry[];
}

/** Synthetic group key for sessions without a resolvable project. */
export const TERMINAL_NAVIGATION_INDEPENDENT_KEY = "independent";

/** A runtime terminal remains selectable after exit/disconnect (output and recovery remain useful).
 * Metadata-only/history/editor rows and remote-owned sessions are not selectable terminals. */
export function isOperableNavigationSession(session: TerminalSession, _status: SessionStatus | undefined): boolean {
  return (session.kind === undefined || session.kind === "pty" || session.kind === "ephemeral-pi")
    && !session.transientBackground && !session.remoteHandoff;
}

export function pruneTerminalNavigationMemory(memory: TerminalNavigationMemory, liveIds: ReadonlySet<string>): TerminalNavigationMemory {
  const prune = (ids: readonly string[]) => [...new Set(ids)].filter((id) => liveIds.has(id));
  const pinnedIds = prune(memory.pinnedIds);
  const recentIds = prune(memory.recentIds);
  if (pinnedIds.join("\0") === memory.pinnedIds.join("\0") && recentIds.join("\0") === memory.recentIds.join("\0")) return memory;
  return { pinnedIds, recentIds };
}

export function visitTerminalNavigation(memory: TerminalNavigationMemory, id: string): TerminalNavigationMemory {
  if (memory.recentIds[0] === id) return memory;
  return { ...memory, recentIds: [id, ...memory.recentIds.filter((other) => other !== id)] };
}

export function toggleTerminalNavigationPin(memory: TerminalNavigationMemory, id: string): TerminalNavigationMemory {
  return { ...memory, pinnedIds: memory.pinnedIds.includes(id)
    ? memory.pinnedIds.filter((other) => other !== id) : [...memory.pinnedIds, id] };
}

export function buildTerminalNavigationModel(input: TerminalNavigationInput, memory: TerminalNavigationMemory, range = "all") {
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const groupIds = input.scope.kind === "group"
    ? collectProjectIdsForGroup(input.groups, input.projects, input.scope.groupId) : null;
  const seen = new Set<string>();
  const scopeEntries: TerminalNavigationEntry[] = [];
  for (const session of input.sessions) {
    if (seen.has(session.id) || !isOperableNavigationSession(session, input.sessionStatuses[session.id])) continue;
    if (!sessionMatchesTerminalScope(session, input.scope, input.sessions, input.projects, projectById, input.worktrees, groupIds)) continue;
    seen.add(session.id);
    const worktree = findWorktreeForSession(session, input.sessions, input.worktrees);
    scopeEntries.push({
      id: session.id, session, worktree,
      project: resolveProjectForSession(session, input.sessions, input.projects, projectById)
        ?? projectById.get(worktree?.project_id ?? "") ?? null,
      current: session.id === input.currentSessionId,
      pinned: memory.pinnedIds.includes(session.id),
      inCurrentWork: input.currentWorkSessionIds.includes(session.id),
    });
  }
  // Reconcile stale project selections against the outer sidebar scope before selection/capping.
  const effectiveRange = range === "all" || range === "independent" || scopeEntries.some((entry) => entry.project?.id === range)
    ? range : "all";
  const filteredEntries = scopeEntries.filter((entry) => (!input.currentWorkMode || entry.inCurrentWork) &&
    (effectiveRange === "all" || (effectiveRange === "independent" ? !entry.project : entry.project?.id === effectiveRange)));
  const currentWorkOrder = new Map(input.currentWorkSessionIds.map((id, index) => [id, index]));
  const navigationOrder = new Map((input.navigationOrder ?? []).map((id, index) => [id, index]));
  const entries = input.currentWorkMode
    ? [...filteredEntries].sort((left, right) => (currentWorkOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (currentWorkOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER))
    : [...filteredEntries].sort((left, right) => (navigationOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (navigationOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const select = (ids: readonly string[]) => [...new Set(ids)].flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  // Head of the scoped list: current, then stable pins, then MRU, then the remaining
  // scoped order. Deterministic fill keeps the row a true subset of entries.
  const quickEntries = select([
    ...(input.currentSessionId ? [input.currentSessionId] : []), ...memory.pinnedIds, ...memory.recentIds,
    ...entries.map((entry) => entry.id),
  ]).slice(0, 5);
  const terms = (input.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (entry: TerminalNavigationEntry) => {
    const text = [entry.session.title, entry.session.cwd, entry.session.remotePath, entry.project?.name,
      entry.project?.path, entry.worktree?.name, entry.worktree?.display_name, entry.worktree?.short_label,
      entry.worktree?.branch, entry.worktree?.path].filter(Boolean).join(" ").toLowerCase().replace(/\\/g, "/");
    return terms.every((term) => text.includes(term.replace(/\\/g, "/")));
  };
  const recent = select(memory.recentIds).filter(matches);
  const grouped = new Set(recent.map((entry) => entry.id));
  const currentWork = entries.filter((entry) => entry.inCurrentWork && !grouped.has(entry.id) && matches(entry));
  currentWork.forEach((entry) => grouped.add(entry.id));
  const other = entries.filter((entry) => !grouped.has(entry.id) && matches(entry));
  // Single source of truth for the drawer tree: group the same entries the tab row renders.
  const ambiguousNames = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const entry of entries) {
    const name = entry.project?.name;
    if (!name) continue;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    if ((nameCounts.get(name) ?? 0) > 1) ambiguousNames.add(name);
  }
  const groupMap = new Map<string, TerminalNavigationGroup>();
  for (const entry of entries) {
    const key = entry.project ? `project:${entry.project.id}` : TERMINAL_NAVIGATION_INDEPENDENT_KEY;
    let group = groupMap.get(key);
    if (!group) {
      const name = entry.project?.name ?? null;
      group = {
        key,
        label: name ? (ambiguousNames.has(name) ? `${name} · ${entry.project!.id}` : name) : "",
        subtitle: entry.project?.path || null,
        entries: [],
      };
      groupMap.set(key, group);
    }
    group.entries.push(entry);
  }
  const projectGroups: TerminalNavigationGroup[] = [...groupMap.values()].map((group) => group.key === TERMINAL_NAVIGATION_INDEPENDENT_KEY
    ? { ...group, label: "", subtitle: null }
    : group);
  return {
    range: effectiveRange, entries, quickEntries, projectGroups,
    totalCount: entries.length,
    groups: { recent, currentWork, other },
    matchingCount: recent.length + currentWork.length + other.length,
  };
}

export type TerminalNavigationActivation = {
  sessionId: string;
  target: "current-work" | "ordinary";
  /** Unhide before focusing; outsiders are rejected while current-work mode is active. */
  unhide: boolean;
  exitCurrentWork: boolean;
};

/** Recompute against current input at click time; null means stale/closed/out-of-scope. */
export function resolveTerminalNavigationActivation(input: TerminalNavigationInput, sessionId: string): TerminalNavigationActivation | null {
  const entry = buildTerminalNavigationModel(input, { pinnedIds: [], recentIds: [] }).entries.find((item) => item.id === sessionId);
  if (!entry) return null;
  const member = input.currentWorkMode && entry.inCurrentWork;
  return { sessionId, target: member ? "current-work" : "ordinary", unhide: Boolean(entry.session.tabHidden),
    exitCurrentWork: input.currentWorkMode && !member };
}
