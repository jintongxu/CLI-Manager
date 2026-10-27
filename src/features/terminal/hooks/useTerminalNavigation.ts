import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildTerminalNavigationModel, isOperableNavigationSession, pruneTerminalNavigationMemory,
  resolveTerminalNavigationActivation, toggleTerminalNavigationPin, visitTerminalNavigation,
  type TerminalNavigationInput, type TerminalNavigationMemory,
} from "../lib/terminalNavigationModel";

/** Mount once at the window's terminal root, not inside a conditional toolbar/popup.
 * State is window-local and intentionally neither persisted nor shared through a store.
 */
function readNavigationOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem("terminal-navigation-order");
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch (error) {
    console.warn("Failed to read terminal navigation order", error);
    return [];
  }
}

export function useTerminalNavigation(input: TerminalNavigationInput) {
  const [memory, setMemory] = useState<TerminalNavigationMemory>({ pinnedIds: [], recentIds: [] });
  const [navigationOrder, setNavigationOrder] = useState<string[]>(readNavigationOrder());
  const lastCurrentId = useRef<string | null>(null);
  // Prune against ALL runtime IDs, not scope/search/visibility: changing scope is not closing.
  const liveIds = new Set(input.sessions.map((session) => session.id));
  const liveKey = JSON.stringify([...liveIds].sort());
  useEffect(() => {
    setMemory((previous) => pruneTerminalNavigationMemory(previous, new Set<string>(JSON.parse(liveKey))));
  }, [liveKey]);
  useEffect(() => {
    if (lastCurrentId.current === input.currentSessionId) return;
    lastCurrentId.current = input.currentSessionId;
    const current = input.sessions.find((session) => session.id === input.currentSessionId);
    if (current && isOperableNavigationSession(current, input.sessionStatuses[current.id])) {
      setMemory((previous) => visitTerminalNavigation(previous, current.id));
    }
  }, [input.currentSessionId, input.sessions, input.sessionStatuses]);
  const togglePin = useCallback((sessionId: string) => {
    if (!resolveTerminalNavigationActivation(input, sessionId)) return;
    setMemory((previous) => toggleTerminalNavigationPin(previous, sessionId));
  }, [input]);
  /** Call only after the integration adapter successfully focuses a terminal. */
  const recordVisit = useCallback((sessionId: string) => {
    if (!resolveTerminalNavigationActivation(input, sessionId)) return;
    setMemory((previous) => visitTerminalNavigation(previous, sessionId));
  }, [input]);
  const resolveActivation = useCallback((sessionId: string) => resolveTerminalNavigationActivation(input, sessionId), [input]);
  const reorderNavigation = useCallback((fromId: string, toId: string) => {
    setNavigationOrder((previous) => {
      const known = [...new Set([...previous, ...input.sessions.map((session) => session.id)])];
      const fromIndex = known.indexOf(fromId);
      const toIndex = known.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return previous;
      const next = [...known];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      window.localStorage.setItem("terminal-navigation-order", JSON.stringify(next));
      return next;
    });
  }, [input.sessions]);
  const pruned = pruneTerminalNavigationMemory(memory, liveIds);
  return { ...buildTerminalNavigationModel({ ...input, navigationOrder }, pruned), memory: pruned, togglePin, recordVisit, resolveActivation, reorderNavigation };
}
