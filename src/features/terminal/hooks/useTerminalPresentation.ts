import { useMemo } from "react";
import type { TerminalSession } from "../../../shared/types/index";
import { collectPaneLeaves, filterPaneTreeBySessionIds, findFirstSessionId, type TerminalPaneNode } from "../api/terminalPaneTree";
import type { TerminalWorkspan } from "../api/terminalWorkspan";
import { terminalPresentationAllowedIds } from "../lib/terminalPresentation";
import { useTerminalVisibleLayouts } from "./useTerminalVisibleLayouts";
import { useCurrentWorkPortalTargets } from "./useCurrentWorkPortalTargets";

/** One scope/mode boundary shared by geometry, focus and portal placement. Backing trees stay intact. */
export function useTerminalPresentation(
  workspans: TerminalWorkspan[], sessions: TerminalSession[], scope: Set<string> | null,
  activeWorkspanId: string | null, activeSessionId: string | null, fullscreenPaneId: string | null,
  currentWorkIds: readonly string[], currentWorkMode: boolean, currentWorkPaneTree: TerminalPaneNode | null,
  currentWorkActiveSessionId: string | null, currentWorkFullscreenPaneId: string | null = null,
) {
  const allowedIds = useMemo(() => terminalPresentationAllowedIds(sessions, scope, currentWorkIds, currentWorkMode),
    [sessions, scope, currentWorkIds, currentWorkMode]);
  const layouts = useTerminalVisibleLayouts(workspans, sessions, allowedIds, activeWorkspanId, activeSessionId, fullscreenPaneId);
  const visibleCurrentWorkPaneTree = useMemo(() => filterPaneTreeBySessionIds(currentWorkPaneTree, allowedIds), [currentWorkPaneTree, allowedIds]);
  const effectiveCurrentWorkActiveSessionId = currentWorkActiveSessionId && allowedIds.has(currentWorkActiveSessionId)
    ? currentWorkActiveSessionId : findFirstSessionId(visibleCurrentWorkPaneTree);
  const portals = useCurrentWorkPortalTargets(currentWorkMode ? visibleCurrentWorkPaneTree : null);
  const effectiveActiveSessionId = currentWorkMode ? effectiveCurrentWorkActiveSessionId : layouts.effectiveActiveSessionId;
  return {
    ...layouts, effectiveActiveSessionId, preferredScopedSessionId: effectiveActiveSessionId,
    activeSession: sessions.find((session) => session.id === effectiveActiveSessionId) ?? null,
    currentWorkFullscreenPaneId: collectPaneLeaves(visibleCurrentWorkPaneTree).some((pane) => pane.id === currentWorkFullscreenPaneId) ? currentWorkFullscreenPaneId : null,
    currentWorkPaneTree: visibleCurrentWorkPaneTree, currentWorkActiveSessionId: effectiveCurrentWorkActiveSessionId,
    currentWorkSessionPortalTargets: portals.sessionPortalTargets, currentWorkVisibleSessionIds: portals.visibleSessionIds,
    registerCurrentWorkPaneTarget: portals.registerPaneTarget,
  };
}
