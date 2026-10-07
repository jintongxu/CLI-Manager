import { isTaskQualifiedAgent, getAgentTaskNotification, type TabStatusSources } from "../../terminal/state";
import type { SessionStatus, TabNotificationState } from "../../terminal/state";
import type { TerminalScope, TerminalSession } from "../../../shared/types/index";

import { getSidebarTerminals } from "../../../shared/lib/sidebarTerminalOrder";
export { getSidebarTerminals };

export function isSidebarTerminalLocked(session: TerminalSession): boolean {
  return Boolean(session.remoteHandoff && session.remoteHandoff.phase !== "recovery_failed");
}

export function openSidebarTerminal(session: TerminalSession, actions: {
  selectScope: (scope: TerminalScope) => void;
  closeHistory: () => void;
  closeGitWorkspace: () => void;
  reopenSession: (id: string) => void;
}): void {
  if ((session.kind ?? "pty") !== "pty" || !session.projectId) return;
  actions.selectScope(session.worktreeId
    ? { kind: "worktree", projectId: session.projectId, worktreeId: session.worktreeId }
    : { kind: "project", projectId: session.projectId });
  actions.closeGitWorkspace();
  actions.closeHistory(); // Existing workspace controller switches back to terminal when history closes.
  actions.reopenSession(session.id);
}

export async function deleteSidebarTerminal(id: string, actions: {
  getSession: (id: string) => TerminalSession | undefined;
  confirm: (session: TerminalSession) => Promise<boolean>;
  closeSession: (id: string) => Promise<void>;
  onLocked: () => void;
}): Promise<void> {
  const session = actions.getSession(id);
  if (!session || (session.kind ?? "pty") !== "pty") return;
  if (isSidebarTerminalLocked(session)) { actions.onLocked(); return; }
  if (!await actions.confirm(session)) return;
  const current = actions.getSession(id);
  if (!current || (current.kind ?? "pty") !== "pty") return;
  if (isSidebarTerminalLocked(current)) { actions.onLocked(); return; }
  await actions.closeSession(id);
}

/** Metadata-only rename: deliberately independent of visibility and remote handoff locks. */
export function getSidebarTerminalRenameTarget(id: string, getSession: (id: string) => TerminalSession | undefined): { id: string; title: string } | null {
  const session = getSession(id);
  return session && (session.kind ?? "pty") === "pty" ? { id: session.id, title: session.title } : null;
}

export function renameSidebarTerminal(id: string, title: string, actions: {
  getSession: (id: string) => TerminalSession | undefined;
  renameSession: (id: string, title: string) => void;
}): void {
  const trimmed = title.trim();
  if (!trimmed || !getSidebarTerminalRenameTarget(id, actions.getSession)) return;
  actions.renameSession(id, trimmed);
}

export const sidebarTerminalStates = ["running", "wait", "completed", "failed", "remote", "idle"] as const;
export type SidebarTerminalState = typeof sidebarTerminalStates[number];
export const sidebarTerminalGlyphs: Record<SidebarTerminalState, string> = {
  running: "▶", wait: "Ⅱ", completed: "✓", failed: "!", remote: "↗", idle: "○",
};

/** One mutually exclusive presentation state, shared by rows and Worktree summaries. */
export function resolveSidebarTerminalState(session: TerminalSession, lifecycle?: SessionStatus,
  notification?: TabNotificationState, sources?: TabStatusSources): SidebarTerminalState | null {
  if (!isTaskQualifiedAgent(session, sources)) return null;
  notification = getAgentTaskNotification(session, sources);
  return isSidebarTerminalLocked(session) ? "remote" : lifecycle === "error" ? "failed"
    : lifecycle === "exited" ? "completed" : notification === "attention" ? "wait"
    : notification === "done" ? "completed" : notification === "failed" ? "failed"
    : notification === "running" ? "running" : "idle";
}

export function summarizeWorktreeTerminals(sessions: TerminalSession[], projectId: string, worktreeId: string,
  statuses: Record<string, SessionStatus>, notifications: Record<string, TabNotificationState>, sources: Record<string, TabStatusSources> = {}) {
  const counts: Record<SidebarTerminalState, number> = { running: 0, wait: 0, completed: 0, failed: 0, remote: 0, idle: 0 };
  const terminals = getSidebarTerminals(sessions, projectId, worktreeId);
  for (const session of terminals) {
    const state = resolveSidebarTerminalState(session, statuses[session.id], notifications[session.id], sources[session.id]);
    if (state) counts[state]++;
  }
  return { total: terminals.length, counts };
}

/** Project badges describe tasks, not whether a shell process is alive. */
export function summarizeProjectTerminalStates(sessions: TerminalSession[],
  statuses: Record<string, SessionStatus>, notifications: Record<string, TabNotificationState>, sources: Record<string, TabStatusSources> = {}) {
  const map = new Map<string, SidebarTerminalState>();
  const priority: Record<SidebarTerminalState, number> = {
    idle: 0, completed: 1, running: 2, failed: 3, wait: 4, remote: 5,
  };
  for (const session of sessions) {
    if (!session.projectId || (session.kind ?? "pty") !== "pty") continue;
    const status = resolveSidebarTerminalState(session, statuses[session.id], notifications[session.id], sources[session.id]);
    if (!status) continue;
    const current = map.get(session.projectId);
    if (!current || priority[status] > priority[current]) map.set(session.projectId, status);
  }
  return map;
}
