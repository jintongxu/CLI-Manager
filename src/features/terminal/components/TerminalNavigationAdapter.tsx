import { useRef, type ReactNode } from "react";
import type { Group, Project, TerminalScope, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { useI18n } from "../../../shared/i18n";
import { useTerminalStore } from "../state";
import { useTerminalNavigation } from "../hooks/useTerminalNavigation";
import { buildTerminalNavigationModel } from "../lib/terminalNavigationModel";
import type { useTerminalTabsController } from "../hooks/useTerminalTabsController";
import { collectPaneLeaves } from "../api/terminalPaneTree";
import { PaneTabBar } from "./PaneTabBar";
import { TerminalNavigationBar } from "./TerminalNavigationBar";

type Controller = ReturnType<typeof useTerminalTabsController>;
interface Props {
  sessions: TerminalSession[]; projects: Project[]; worktrees: WorktreeRecord[]; groups: Group[]; scope: TerminalScope;
  currentSessionId: string | null; currentWorkMode: boolean; currentWorkSessionIds: readonly string[];
  position: "top" | "bottom"; tabBarVisible?: boolean; activateCurrentWork: (id?: string) => void; leaveCurrentWork: () => void;
  onActivate: (id: string) => void; onAdd: (id: string) => void; onNewTab: () => void; onRemove: (id: string) => void;
  onCloseSession?: (id: string) => void;
  selectedIds: string[]; onToggleSelection: (id: string) => void; onRemoveSelected: (ids: string[]) => void; onCloseOthers: () => void;
  legacyOrdering: ReactNode; paneProps: Controller["paneNavigationProps"]; layouts: Controller["mountedWorkspanLayouts"];
  onToggleCurrentWork: (id: string) => void;
  onRename: (session: TerminalSession) => void;
}

/** Single collection adapter: outer scope + current-work membership are the only filters. */
export function TerminalNavigationAdapter(props: Props) {
  const { t } = useI18n();
  const sessionStatuses = useTerminalStore((state) => state.sessionStatuses);
  const baseInput = { ...props, sessionStatuses };
  const rawNavigation = useTerminalNavigation(baseInput);
  const visibleEntries = rawNavigation.entries.filter((entry) => !entry.session.tabHidden && (props.currentWorkMode ? entry.inCurrentWork : !entry.inCurrentWork));
  const visibleIds = new Set(visibleEntries.map((entry) => entry.id));
  const navigation = {
    ...rawNavigation,
    entries: visibleEntries,
    totalCount: visibleEntries.length,
    projectGroups: rawNavigation.projectGroups.map((group) => ({ ...group, entries: group.entries.filter((entry) => visibleIds.has(entry.id)) })).filter((group) => group.entries.length > 0),
    groups: {
      recent: rawNavigation.groups.recent.filter((entry) => visibleIds.has(entry.id)),
      currentWork: rawNavigation.groups.currentWork.filter((entry) => visibleIds.has(entry.id)),
      other: rawNavigation.groups.other.filter((entry) => visibleIds.has(entry.id)),
    },
  };
  const allModel = buildTerminalNavigationModel({ ...baseInput, currentWorkMode: false }, rawNavigation.memory);
  const addEntries = allModel.entries.filter((entry) => !entry.session.tabHidden && !entry.inCurrentWork);
  const activationRequestRef = useRef(0);
  const activate = (id: string) => {
    const target = navigation.resolveActivation(id);
    if (!target) return;
    const request = ++activationRequestRef.current;
    if (target.target === "current-work") {
      if (!props.currentWorkSessionIds.includes(id)) return;
      if (target.unhide) void useTerminalStore.getState().showSessions([id]);
      if (request !== activationRequestRef.current) return;
      props.activateCurrentWork(id);
      navigation.recordVisit(id);
      return;
    }
    if (target.exitCurrentWork) props.leaveCurrentWork();
    if (target.unhide) void useTerminalStore.getState().showSessions([id]);
    if (request !== activationRequestRef.current) return;
    props.onActivate(id);
    navigation.recordVisit(id);
  };
  const panes = props.layouts.flatMap((layout) => collectPaneLeaves(layout.paneTree));
  const paneBar = (pane: typeof panes[number], actionSessionId?: string) => <PaneTabBar {...props.paneProps}
    key={actionSessionId ?? pane.id} pane={pane} allPanes={props.layouts.find((layout) => collectPaneLeaves(layout.paneTree).some((leaf) => leaf.id === pane.id))?.visiblePanes ?? [pane]} activeSessionId={props.currentSessionId}
    visibleSessionIds={new Set(navigation.entries.map((entry) => entry.id))} isPaneFullscreen={false} actionSessionId={actionSessionId}
    currentWorkSessionIds={props.currentWorkSessionIds} onToggleCurrentWork={props.onToggleCurrentWork}
    onToggleNavigationPin={navigation.togglePin} navigationPinnedIds={navigation.memory.pinnedIds}
    onActivateSession={(id) => void activate(id)}
    onStartEdit={(id) => { const session = props.sessions.find((item) => item.id === id); if (session) props.onRename(session); }} />;
  return <TerminalNavigationBar
    navigation={navigation}
    position={props.position}
    tabBarVisible={props.tabBarVisible}
    currentWorkMode={props.currentWorkMode}
    onToggleCurrentWork={() => props.currentWorkMode ? props.leaveCurrentWork() : props.activateCurrentWork()}
    onClose={(id) => props.onCloseSession?.(id)}
    onRemoveSelected={props.onRemoveSelected}
    addEntries={addEntries}
    onActivate={(id) => void activate(id)}
    onNewTab={props.onNewTab}
    onReorder={navigation.reorderNavigation}
    onTogglePin={navigation.togglePin}
    onAddToCurrentWork={(id) => { if (allModel.entries.some((entry) => entry.id === id && !entry.inCurrentWork)) props.onAdd(id); }}
    renderStatus={(entry) => <span role="status" aria-label={entry.session.connectionState ?? sessionStatuses[entry.id] ?? "unknown"}>
      {entry.session.connectionState === "disconnected" || entry.session.connectionState === "failed" ? "○" : "●"}
      {entry.session.worktreeId && (!entry.worktree || entry.worktree.status === "missing") ? " !" : ""}
    </span>}
    renderSessionActions={(entry) => { const pane = panes.find((item) => item.sessionIds.includes(entry.id));
      return pane ? paneBar(pane, entry.id) : null; }}
    contextLabels={{ unboundProject: t("terminal.context.unboundProject"), anonymousPi: t("terminal.context.anonymousPi"), missingWorktree: t("terminal.context.worktreeMissing"), defaultShell: t("terminal.context.defaultShell") }}
    management={{ entries: navigation.entries, selectedIds: props.selectedIds, onToggleSelection: props.onToggleSelection,
      onRemoveFromCurrentWork: props.onRemove, onRemoveSelected: props.onRemoveSelected, onCloseOthers: props.onCloseOthers,
      renderOrderingSurface: () => <>{props.legacyOrdering}
        {!props.currentWorkMode && props.layouts.filter((layout) => layout.visiblePanes.length <= 1)
          .flatMap((layout) => collectPaneLeaves(layout.paneTree)).map((pane) => paneBar(pane))}</> }}
  />;
}
