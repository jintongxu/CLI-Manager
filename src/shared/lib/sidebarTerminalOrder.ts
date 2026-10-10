import type { TerminalSession } from "../types/index";

export function isOrdinarySidebarTerminal(session: TerminalSession): boolean {
  return (session.kind ?? "pty") === "pty" && session.transientBackground !== true;
}

/** Presentation only: hidden terminals participate; input and layout order are untouched. */
export function getSidebarTerminals(sessions: readonly TerminalSession[], projectId: string, worktreeId?: string): TerminalSession[] {
  return sessions.filter((session) => isOrdinarySidebarTerminal(session)
    && session.projectId === projectId && session.worktreeId === worktreeId)
    .sort((a, b) => Number(b.sidebarPinned === true) - Number(a.sidebarPinned === true)
      || rank(a) - rank(b));
}

function rank(session: TerminalSession): number {
  return typeof session.sidebarOrder === "number" && Number.isFinite(session.sidebarOrder)
    && session.sidebarOrder >= 0 ? session.sidebarOrder : Infinity;
}

export function sameSidebarTerminalPartition(a: TerminalSession, b: TerminalSession): boolean {
  return isOrdinarySidebarTerminal(a) && isOrdinarySidebarTerminal(b)
    && a.projectId === b.projectId && a.worktreeId === b.worktreeId
    && (a.sidebarPinned === true) === (b.sidebarPinned === true);
}

export function getSidebarTerminalPartition(sessions: readonly TerminalSession[], target: TerminalSession): TerminalSession[] {
  return sessions.filter((session) => sameSidebarTerminalPartition(session, target)).sort((a, b) => rank(a) - rank(b));
}
