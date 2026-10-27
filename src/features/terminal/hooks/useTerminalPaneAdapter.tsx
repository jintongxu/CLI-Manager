import { MemoPaneLeafView, type PaneLeafViewProps } from "../components/PaneLeafView";
import type { TerminalPaneLeaf } from "../api/terminalPaneTree";
import type { PaneDropPreview } from "../lib/terminalTabsModel";

type Base = Omit<PaneLeafViewProps, "pane" | "allPanes" | "activeSessionId" | "isPaneFullscreen" | "isLayoutVisible">;
type Options = { visibleIds?: Set<string>; onActivate?: (id: string) => void; activeSessionId?: string | null;
  forceTabBar?: boolean; currentWorkSessionIds?: readonly string[]; onToggleCurrentWork?: (id: string) => void;
  currentWorkPortalTargets?: ReadonlyMap<string, HTMLElement>; currentWorkVisibleSessionIds?: ReadonlySet<string> };

/** Shared lifecycle/menu props, independent of mounted terminal bodies and portal ownership. */
export function useTerminalPaneAdapter(base: Base, state: {
  visibleSessionIds: Set<string>; activeFullscreenPaneId: string | null; activeDropPreview: PaneDropPreview; workspanEnabled: boolean;
}) {
  const renderWorkspanLeaf = (pane: TerminalPaneLeaf, allPanes: TerminalPaneLeaf[], activeSessionId: string | null,
    visible: boolean, options?: Options) => <MemoPaneLeafView {...base} key={pane.id} pane={pane} allPanes={allPanes}
      activeSessionId={options?.activeSessionId ?? activeSessionId}
      visibleSessionIds={options?.visibleIds ?? state.visibleSessionIds}
      isPaneFullscreen={visible && state.activeFullscreenPaneId === pane.id}
      isLayoutVisible={visible && (!state.activeFullscreenPaneId || state.activeFullscreenPaneId === pane.id)}
      activeDropPreview={visible ? state.activeDropPreview : null}
      onActivateSession={options?.onActivate ?? base.onActivateSession}
      currentWorkSessionIds={options?.currentWorkSessionIds} onToggleCurrentWork={options?.onToggleCurrentWork}
      currentWorkPortalTargets={options?.currentWorkPortalTargets}
      currentWorkVisibleSessionIds={options?.currentWorkVisibleSessionIds}
      currentWorkActiveSessionId={options?.activeSessionId}
      hideTabBar={!options?.forceTabBar && state.workspanEnabled && allPanes.length <= 1
        && allPanes[0]?.sessionIds.filter((id) => (options?.currentWorkVisibleSessionIds ?? state.visibleSessionIds).has(id)).length <= 1} />;
  return { renderWorkspanLeaf, paneNavigationProps: base };
}
