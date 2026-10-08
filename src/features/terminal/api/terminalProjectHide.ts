import type { TerminalSession } from "../../../shared/types/index";
import type { ProjectWorkspanTabModel } from "./terminalProjectSelection";
import type { TabNotificationState } from "../state";
import { isHideableTerminalSession } from "../lib/terminalTabVisibility";

/** Supplied unhidden members are sidebar-scoped, not selected-project-row scoped.
 * Select the clicked project and exact status; never expand to a backing tree. */
export function displayedProjectTerminalIds(
  models: readonly ProjectWorkspanTabModel[], projectKey: string | null,
  status: TabNotificationState | "all", notifications: Record<string, TabNotificationState>,
): string[] {
  const ids = new Set<string>();
  for (const model of models) {
    const sessions = new Map(model.memberSessions.map((session) => [session.id, session]));
    for (const member of model.members) {
      const session = sessions.get(member.sessionId);
      if (member.projectKey !== projectKey || !session || session.tabHidden || !isHideableTerminalSession(session)) continue;
      if (status !== "all" && (notifications[session.id] ?? "none") !== status) continue;
      ids.add(session.id);
    }
  }
  return [...ids];
}

/** Revalidate live kinds before hideSession: its pseudo-session fallback is destructive. */
export async function hideProjectTerminalSessions(
  ids: readonly string[], getSessions: () => TerminalSession[],
  hideSession: (id: string) => Promise<void>, onError: (id: string, error: unknown) => void,
): Promise<void> {
  for (const id of new Set(ids)) {
    const session = getSessions().find((item) => item.id === id);
    if (!session || session.tabHidden || !isHideableTerminalSession(session)) continue;
    try { await hideSession(id); } catch (error) { onError(id, error); }
  }
}
