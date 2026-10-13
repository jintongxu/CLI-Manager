import { useCallback, useMemo, useState } from "react";
import { collectPaneLeaves, type TerminalPaneNode } from "../api/terminalPaneTree";

export function useCurrentWorkPortalTargets(paneTree: TerminalPaneNode | null) {
  const [paneTargets, setPaneTargets] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const registerPaneTarget = useCallback((paneId: string, element: HTMLElement | null) => {
    setPaneTargets((current) => {
      const existing = current.get(paneId);
      if (element ? existing === element : !existing) return current;
      const next = new Map(current);
      if (element) next.set(paneId, element); else next.delete(paneId);
      return next;
    });
  }, []);
  const sessionPortalTargets = useMemo(() => {
    const targets = new Map<string, HTMLElement>();
    for (const pane of collectPaneLeaves(paneTree)) {
      const target = paneTargets.get(pane.id);
      if (target) pane.sessionIds.forEach((sessionId) => targets.set(sessionId, target));
    }
    return targets;
  }, [paneTargets, paneTree]);
  const visibleSessionIds = useMemo(() => new Set(
    collectPaneLeaves(paneTree)
      .map((pane) => pane.activeSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  ), [paneTree]);
  return { registerPaneTarget, sessionPortalTargets, visibleSessionIds };
}
