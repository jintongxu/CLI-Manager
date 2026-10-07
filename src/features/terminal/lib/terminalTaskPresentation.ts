import type { TerminalSession } from "../../../shared/types/index";
import type { TabNotificationState, TabStatusSources } from "../types/terminalStoreTypes";

/** Runtime identity wins over launch intent; project CLI defaults are not evidence. */
export function isTaskQualifiedAgent(session: TerminalSession, sources?: TabStatusSources): boolean {
  if ((session.kind ?? "pty") !== "pty" || sources?.agentExited) return false;
  return Boolean(sources?.agentIdentity || session.isAgentSession === true
    || (session.isAgentSession === undefined && session.cliTool?.trim()));
}

/** Task consumers must never use the shell/hook priority merge. */
export function getAgentTaskNotification(session: TerminalSession, sources?: TabStatusSources): TabNotificationState {
  return isTaskQualifiedAgent(session, sources) ? sources?.hook ?? "none" : "none";
}

export function buildAgentTaskNotifications(sessions: TerminalSession[], sources: Record<string, TabStatusSources>): Record<string, TabNotificationState> {
  return Object.fromEntries(sessions.map(session => [session.id, getAgentTaskNotification(session, sources[session.id])]));
}
