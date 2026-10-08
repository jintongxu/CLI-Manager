import type { TerminalSession } from "../../../shared/types/index";
import type { ProjectWorkspanTabModel } from "../lib/workspanTabModel";
import type { TabNotificationState } from "../state";
import { groupProjectWorkspanModels } from "../api/terminalProjectTabsModel";

export function resolveActiveProjectTarget(models: readonly ProjectWorkspanTabModel[], sessionId: string | null) {
  for (const model of models) {
    const member = model.members.find((item) => item.sessionId === sessionId);
    if (member) return {
      projectKey: member.projectKey,
      target: { workspanId: model.workspan.id, sessionId: member.sessionId },
    };
  }
  return null;
}

export function selectProjectTabGroups(
  models: readonly ProjectWorkspanTabModel[], projectKey: string | null,
  status: TabNotificationState | "all", notifications: Record<string, TabNotificationState>,
) {
  if (status !== "all") {
    const seen = new Set<string>();
    const items = models.filter((model) => {
      if (seen.has(model.workspan.id)) return false;
      seen.add(model.workspan.id);
      return Boolean(resolveStatusWorkspanTarget(model, status, notifications));
    });
    // One global row in backing Workspan order; never duplicate mixed projects.
    return items.length ? [{ group: { key: "global-status", kind: "mixed-project" as const,
      worktreeId: null, worktreeName: null }, models: items }] : [];
  }
  if (!projectKey) return [];
  return groupProjectWorkspanModels(models, projectKey);
}

/** Matching visible members only; remembered project targets must not override status. */
export function resolveStatusWorkspanTarget(
  model: ProjectWorkspanTabModel, status: TabNotificationState,
  notifications: Record<string, TabNotificationState>,
) {
  const matching = model.members.filter((member) => (notifications[member.sessionId] ?? "none") === status);
  const member = matching.find((item) => item.sessionId === model.workspan.activeSessionId) ?? matching[0];
  return member ? { workspanId: model.workspan.id, sessionId: member.sessionId } : null;
}

export function countVisibleTabStatuses(models: readonly ProjectWorkspanTabModel[], notifications: Record<string, TabNotificationState>) {
  const totals = { running: 0, done: 0, failed: 0, attention: 0 };
  const seen = new Set<string>();
  for (const model of models) for (const member of model.members) {
    if (seen.has(member.sessionId)) continue;
    seen.add(member.sessionId);
    const status = notifications[member.sessionId] ?? "none";
    if (status !== "none") totals[status]++;
  }
  return totals;
}

export type { ProjectWorkspanTabModel } from "../lib/workspanTabModel";

// Use the actual active session, never the last status-filtered singleton.
export function resolveNewTabSource(sessions: TerminalSession[], activeId: string | null | undefined): TerminalSession | null {
  let source = sessions.find((session) => session.id === activeId) ?? null;
  const seen = new Set<string>();
  while (source?.kind === "subagent-transcript" && source.subagent?.parentSessionId && !seen.has(source.id)) {
    seen.add(source.id);
    source = sessions.find((session) => session.id === source?.subagent?.parentSessionId) ?? null;
  }
  return source;
}
