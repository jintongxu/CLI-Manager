import { MemoPaneLeafView, type PaneLeafViewProps } from "../components/PaneLeafView";
import type { TerminalPaneLeaf } from "../api/terminalPaneTree";
import type { PaneDropPreview } from "../lib/terminalTabsModel";

type Base = Omit<PaneLeafViewProps, "pane" | "allPanes" | "activeSessionId" | "isPaneFullscreen" | "isLayoutVisible">;

/** Shared lifecycle/menu props; canonical pane owners remain mounted under stable keys. */
export function useTerminalPaneAdapter(base: Base, state: {
  visibleSessionIds: Set<string>; activeFullscreenPaneId: string | null; activeDropPreview: PaneDropPreview;
}) {
  const renderWorkspanLeaf = (pane: TerminalPaneLeaf, allPanes: TerminalPaneLeaf[], activeSessionId: string | null,
    visible: boolean) => <MemoPaneLeafView {...base} key={pane.id} pane={pane} allPanes={allPanes}
      activeSessionId={activeSessionId}
      visibleSessionIds={state.visibleSessionIds}
      isPaneFullscreen={visible && state.activeFullscreenPaneId === pane.id}
      isLayoutVisible={base.workspaceVisible !== false && visible && (!state.activeFullscreenPaneId || state.activeFullscreenPaneId === pane.id)}
      activeDropPreview={visible ? state.activeDropPreview : null}
      hideTabBar={allPanes.length <= 1
        && allPanes[0]?.sessionIds.filter((id) => state.visibleSessionIds.has(id)).length <= 1} />;
  return { renderWorkspanLeaf, paneNavigationProps: base };
}
