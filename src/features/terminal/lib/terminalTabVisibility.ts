import type { TerminalSession } from "../../../shared/types/index";
import { collectPaneLeaves, filterPaneTreeBySessionIds } from "../api/terminalPaneTree";
import type { TerminalWorkspan } from "../api/terminalWorkspan";

/** Only ordinary PTY tabs have a durable hide/reopen lifecycle. */
export function isHideableTerminalSession(session: TerminalSession): boolean {
  return (session.kind ?? "pty") === "pty";
}

export function visibleTerminalSessionIds(sessions: TerminalSession[], scope?: Set<string> | null): Set<string> {
  return new Set(sessions.filter((session) => !session.tabHidden && (!scope || scope.has(session.id))).map((session) => session.id));
}

/** Select presentation focus without modifying any backing pane, session or Workspan. */
export function resolveVisibleTerminalFocus(workspans: TerminalWorkspan[], requestedId: string | null, sessions: TerminalSession[]) {
  const visibleIds = visibleTerminalSessionIds(sessions);
  const candidates = workspans.map((workspan) => {
    const panes = collectPaneLeaves(filterPaneTreeBySessionIds(workspan.paneTree, visibleIds));
    const pane = panes.find((item) => item.sessionIds.includes(workspan.activeSessionId ?? ""))
      ?? panes.find((item) => item.id === workspan.activePaneId) ?? panes[0];
    return { workspan, pane };
  });
  const requestedIndex = candidates.findIndex((item) => item.workspan.id === requestedId);
  const adjacentCandidates = requestedIndex >= 0
    ? [...candidates.slice(requestedIndex), ...candidates.slice(0, requestedIndex).reverse()]
    : candidates;
  const selected = adjacentCandidates.find((item) => item.pane);
  return {
    activeWorkspanId: selected?.workspan.id ?? null,
    activePaneId: selected?.pane?.id ?? null,
    activeSessionId: selected?.pane?.activeSessionId ?? null,
  };
}
