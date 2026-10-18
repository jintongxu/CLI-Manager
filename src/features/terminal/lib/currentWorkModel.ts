import type { TerminalPaneNode } from "../api/terminalPaneTree";

export function createCurrentWorkLayoutIdFactory(): () => string {
  const instanceId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  return () => `current-work-layout:${instanceId}:${++sequence}`;
}

export interface CurrentWorkSessionState {
  sessionIds: string[];
  activeSessionId: string | null;
}

export function collectOtherSessionIds(
  sessions: readonly { id: string; tabHidden?: boolean }[],
  currentWorkSessionIds: readonly string[],
): string[] {
  const currentWorkIds = new Set(currentWorkSessionIds);
  return sessions
    .filter((session) => !session.tabHidden && !currentWorkIds.has(session.id))
    .map((session) => session.id);
}

export function appendCurrentWorkSession(
  sessionIds: readonly string[],
  activeSessionId: string | null,
  sessionId: string,
): CurrentWorkSessionState {
  if (sessionIds.includes(sessionId)) {
    return { sessionIds: [...sessionIds], activeSessionId };
  }
  return {
    sessionIds: [...sessionIds, sessionId],
    activeSessionId: activeSessionId ?? sessionId,
  };
}

export function activateCurrentWorkSession(
  sessionIds: readonly string[],
  sessionId: string,
): CurrentWorkSessionState {
  return {
    sessionIds: sessionIds.includes(sessionId) ? [...sessionIds] : [...sessionIds, sessionId],
    activeSessionId: sessionId,
  };
}

export function remapCurrentWorkPaneTreeSessionIds(
  tree: TerminalPaneNode | null,
  sessionIdMap: Record<string, string>,
): TerminalPaneNode | null {
  if (!tree) return null;
  if (tree.type === "leaf") {
    const sessionIds = tree.sessionIds.map((sessionId) => sessionIdMap[sessionId]).filter((sessionId): sessionId is string => Boolean(sessionId));
    if (!sessionIds.length) return null;
    const activeSessionId = tree.activeSessionId ? sessionIdMap[tree.activeSessionId] ?? sessionIds[0] : sessionIds[0];
    return { ...tree, sessionIds, activeSessionId };
  }
  const first = remapCurrentWorkPaneTreeSessionIds(tree.first, sessionIdMap);
  const second = remapCurrentWorkPaneTreeSessionIds(tree.second, sessionIdMap);
  if (!first) return second;
  if (!second) return first;
  return { ...tree, first, second };
}

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
