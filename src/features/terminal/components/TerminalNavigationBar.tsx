import type { TerminalNavigationEntry } from "../lib/terminalNavigationModel";
import type { useTerminalNavigation } from "../hooks/useTerminalNavigation";
import { useI18n } from "../../../shared/i18n/index";
import { useDroppable } from "@dnd-kit/core";
import { CURRENT_WORK_DROP_TARGET_ID } from "../../workspace/api/dragInteraction";
import { Button } from "../../../shared/ui/button";
import { TerminalTabRow } from "./TerminalTabRow";
import { TerminalNavigationDrawer } from "./TerminalNavigationDrawer";
import { useTerminalDrawerIntent } from "../hooks/useTerminalDrawerIntent";
import type { TerminalNavigationActions, TerminalNavigationManagementProps } from "./TerminalNavigationPanels";
import "./terminalNavigation.css";

export interface TerminalNavigationBarProps extends TerminalNavigationActions {
  navigation: Pick<ReturnType<typeof useTerminalNavigation>, "entries" | "groups" | "projectGroups" | "totalCount">;
  position: "top" | "bottom";
  tabBarVisible?: boolean;
  currentWorkMode: boolean;
  onToggleCurrentWork: () => void;
  onNewTab: () => void;
  onReorder?: (fromId: string, toId: string) => void;
  onClose: (sessionId: string) => void;
  onRemoveSelected: (ids: string[]) => void;
  addEntries?: readonly TerminalNavigationEntry[];
  contextLabels: Parameters<typeof import("../lib/terminalTabsModel").buildTerminalTabContext>[3];
  management: Pick<TerminalNavigationManagementProps, "entries" | "selectedIds" | "onToggleSelection" |
    "onRemoveFromCurrentWork" | "onRemoveSelected" | "onCloseOthers" | "renderOrderingSurface">;
}

export function TerminalNavigationBar({
  navigation, position, tabBarVisible = true, currentWorkMode, onToggleCurrentWork, onNewTab, onReorder, onClose, onRemoveSelected,
  addEntries = [], management, contextLabels, ...actions
}: TerminalNavigationBarProps) {
  const { t } = useI18n();
  const drawer = useTerminalDrawerIntent({ enabled: tabBarVisible });
  const { setNodeRef: setCurrentWorkDropRef, isOver: isCurrentWorkDropOver } = useDroppable({
    id: CURRENT_WORK_DROP_TARGET_ID,
    disabled: currentWorkMode,
  });
  const activeId = navigation.entries.find((entry) => entry.current)?.id ?? null;
  const mode = currentWorkMode ? "current-work" : "ordinary";
  const addGroup = currentWorkMode && addEntries.length > 0
    ? [{ key: "add", label: t("terminal.navigation.addTerminal"), subtitle: null, entries: addEntries as TerminalNavigationEntry[] }]
    : [];
  const groups = [...(navigation.projectGroups ?? []), ...addGroup];
  const anchor = <Button
    ref={drawer.anchorRef}
    size="sm"
    variant="ghost"
    className="ui-terminal-navigation-drawer-trigger"
    aria-haspopup="dialog"
    aria-expanded={drawer.open}
    title={t("terminal.navigation.drawerTitle")}
    onPointerEnter={drawer.anchorProps.onPointerEnter}
    onPointerLeave={drawer.anchorProps.onPointerLeave}
    onClick={drawer.anchorProps.onClick}
    onKeyDown={drawer.anchorProps.onKeyDown}
  >
    {t("terminal.navigation.drawerTitle")} · {navigation.totalCount}
    <span aria-hidden="true">⌄</span>
  </Button>;
  return <nav className="ui-terminal-navigation" aria-label={t("terminal.navigation.label")} data-position={position}>
    <div className="ui-terminal-navigation-row ui-terminal-navigation-row--tabs">
      <Button ref={setCurrentWorkDropRef} size="sm" variant="ghost" className={`ui-terminal-navigation-work-toggle${isCurrentWorkDropOver ? " is-drop-target" : ""}`} onClick={onToggleCurrentWork}>
        {currentWorkMode ? `${t("terminal.currentWork.title")} · ${navigation.totalCount}` : `${t("terminal.navigation.available")} · ${navigation.totalCount}`}
      </Button>
      <TerminalTabRow
        entries={navigation.entries}
        activeId={activeId}
        contextLabels={contextLabels}
        mode={mode}
        sortable
        onReorder={onReorder}
        onActivate={actions.onActivate}
      />
      <TerminalNavigationDrawer
        open={drawer.open}
        pinned={drawer.pinned}
        anchor={anchor}
        anchorProps={drawer.anchorProps}
        contentProps={drawer.contentProps}
        projectGroups={groups}
        totalCount={navigation.totalCount}
        currentWorkMode={currentWorkMode}
        selectedIds={management.selectedIds}
        onActivate={actions.onActivate}
        onAddToCurrentWork={actions.onAddToCurrentWork}
        onRemoveFromCurrentWork={management.onRemoveFromCurrentWork}
        onRemoveSelected={onRemoveSelected}
        onClose={onClose}
        onCloseOthers={management.onCloseOthers}
        onToggleSelection={management.onToggleSelection}
        onTogglePin={actions.onTogglePin}
        renderStatus={actions.renderStatus}
        renderSessionActions={actions.renderSessionActions}
        onOpenChange={(nextOpen) => nextOpen ? drawer.setOpen(true) : drawer.close()}
      />
    </div>
  </nav>;
}
