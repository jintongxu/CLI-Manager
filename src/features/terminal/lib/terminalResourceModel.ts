import type { TerminalSession } from "../../../shared/types/index";
import type { TerminalResourceRow } from "../api/terminalResources";
import { TERMINAL_RESOURCE_PAGE_SIZE } from "../api/terminalResources";

/** Runtime originals only; current-work references and persisted/history rows are not another PTY. */
export function terminalResourceSessions(sessions: readonly TerminalSession[]): TerminalSession[] {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    if (seen.has(session.id) || session.remoteHandoff
      || (session.kind !== undefined && session.kind !== "pty" && session.kind !== "ephemeral-pi")) return false;
    seen.add(session.id);
    return true;
  }).sort((a, b) => stableId(a.id, b.id));
}
function stableId(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
export function terminalResourcePage(sessions: readonly TerminalSession[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(sessions.length / TERMINAL_RESOURCE_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  return { page, pages, sessions: sessions.slice(page * TERMINAL_RESOURCE_PAGE_SIZE, (page + 1) * TERMINAL_RESOURCE_PAGE_SIZE) };
}
export function sortTerminalResourcePage(sessions: readonly TerminalSession[], rows: readonly TerminalResourceRow[]) {
  const byId = new Map(rows.map((row) => [row.sessionId, row]));
  const memory = (id: string) => {
    const row = byId.get(id);
    const bytes = row?.workingSetSumBytes;
    return row && row.status !== "unavailable" && row.observedCount > 0
      && typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  };
  return [...sessions].sort((a, b) => {
    const left = memory(a.id);
    const right = memory(b.id);
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    return (right ?? 0) - (left ?? 0) || stableId(a.id, b.id);
  });
}

/** Identity changes invalidate pending samples even when the original ID is reused. No secrets in key. */
export function terminalResourceIdentity(sessions: readonly TerminalSession[]): string {
  return JSON.stringify(sessions.map((s) => [s.id, s.createdAtMs, s.kind, s.environmentType, s.connectionState]));
}
