import { useMemo } from "react";
import type { TerminalSession } from "../../../shared/types/index";
import { collectPaneLeaves, filterPaneTreeBySessionIds, findFirstSessionId } from "../api/terminalPaneTree";
import { collectWorkspanSessionIds, type TerminalWorkspan } from "../api/terminalWorkspan";
import { visibleTerminalSessionIds } from "../lib/terminalTabVisibility";

/** Only geometry/focus are filtered. Render the backing layouts under stable keys. */
export function useTerminalVisibleLayouts(
  workspans: TerminalWorkspan[], sessions: TerminalSession[], scopedSessionIds: Set<string> | null,
  activeWorkspanId: string | null, activeSessionId: string | null, fullscreenPaneId: string | null,
) {
  return useMemo(() => {
    const visibleSessionIds = visibleTerminalSessionIds(sessions, scopedSessionIds);
    const needsFilter = Boolean(scopedSessionIds) || sessions.some((session) => session.tabHidden);
    const mountedWorkspanLayouts = workspans.flatMap((workspan) => {
      if (!workspan.paneTree) return [];
      const visiblePaneTree = needsFilter ? filterPaneTreeBySessionIds(workspan.paneTree, visibleSessionIds) : workspan.paneTree;
      const visiblePanes = collectPaneLeaves(visiblePaneTree);
      return [{
        workspan, paneTree: workspan.paneTree, visiblePaneTree, visiblePanes,
        visiblePaneIds: new Set(visiblePanes.map((pane) => pane.id)),
        sessionIds: collectWorkspanSessionIds(workspan),
        closeSessionIds: visiblePanes.flatMap((pane) => pane.sessionIds),
      }];
    });
    const visibleWorkspanLayouts = mountedWorkspanLayouts.flatMap((layout) => layout.visiblePaneTree ? [{
      workspan: layout.workspan, paneTree: layout.visiblePaneTree, panes: layout.visiblePanes,
      sessionIds: layout.closeSessionIds, closeSessionIds: layout.closeSessionIds,
    }] : []);
    const effectiveActiveWorkspanId = visibleWorkspanLayouts.some(({ workspan }) => workspan.id === activeWorkspanId)
      ? activeWorkspanId : visibleWorkspanLayouts[0]?.workspan.id ?? null;
    const activeWorkspanLayout = visibleWorkspanLayouts.find(({ workspan }) => workspan.id === effectiveActiveWorkspanId) ?? null;
    const renderPaneTree = activeWorkspanLayout?.paneTree ?? null;
    const allPanes = activeWorkspanLayout?.panes ?? [];
    const activeFullscreenPaneId = allPanes.some((pane) => pane.id === fullscreenPaneId) ? fullscreenPaneId : null;
    const preferredScopedSessionId = activeSessionId && visibleSessionIds.has(activeSessionId)
      ? activeSessionId : findFirstSessionId(renderPaneTree);
    const effectiveActiveSessionId = preferredScopedSessionId;
    const activeSession = sessions.find((session) => session.id === effectiveActiveSessionId) ?? null;
    return {
      visibleSessionIds, mountedWorkspanLayouts, visibleWorkspanLayouts, effectiveActiveWorkspanId,
      activeWorkspanLayout, renderPaneTree, allPanes, activeFullscreenPaneId, preferredScopedSessionId,
      effectiveActiveSessionId, activeSession, visibleSessions: sessions.filter((session) => visibleSessionIds.has(session.id)),
    };
  }, [workspans, sessions, scopedSessionIds, activeWorkspanId, activeSessionId, fullscreenPaneId]);
}
