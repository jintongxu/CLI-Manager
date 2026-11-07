import type { TerminalPaneNode } from "../api/terminalPaneTree";

/** Legacy snapshot decoding only. Runtime ownership lives in canonical workspans. */
export function sanitizeCurrentWorkPaneTree(
  value: unknown,
  validSessionIds: ReadonlySet<string>,
): TerminalPaneNode | null {
  const seen = new Set<string>();
  const seenNodeIds = new Set<string>();
  const visit = (node: unknown): TerminalPaneNode | null => {
    if (!node || typeof node !== "object") return null;
    const record = node as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id ? record.id : null;
    if (!id || seenNodeIds.has(id)) return null;
    seenNodeIds.add(id);
    if (record.type === "leaf") {
      const sessionIds = Array.isArray(record.sessionIds)
        ? record.sessionIds.filter((sessionId): sessionId is string => {
          if (typeof sessionId !== "string" || !validSessionIds.has(sessionId) || seen.has(sessionId)) return false;
          seen.add(sessionId);
          return true;
        })
        : [];
      if (!sessionIds.length) {
        seenNodeIds.delete(id);
        return null;
      }
      const activeSessionId = typeof record.activeSessionId === "string" && sessionIds.includes(record.activeSessionId)
        ? record.activeSessionId
        : sessionIds[0];
      return { type: "leaf", id, sessionIds, activeSessionId };
    }
    if (record.type !== "split") {
      seenNodeIds.delete(id);
      return null;
    }
    const first = visit(record.first);
    const second = visit(record.second);
    if (!first || !second) {
      seenNodeIds.delete(id);
      return first ?? second;
    }
    const direction = record.direction === "vertical" ? "vertical" : "horizontal";
    const ratio = typeof record.ratio === "number" && Number.isFinite(record.ratio)
      ? Math.max(0.2, Math.min(0.8, record.ratio))
      : 0.5;
    return { type: "split", id, direction, ratio, first, second };
  };
  return visit(value);
}
