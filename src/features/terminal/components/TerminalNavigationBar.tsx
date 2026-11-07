import type { useTerminalNavigation } from "../hooks/useTerminalNavigation";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { TerminalTabRow } from "./TerminalTabRow";
import { TerminalNavigationDrawer } from "./TerminalNavigationDrawer";
import { useTerminalDrawerIntent } from "../hooks/useTerminalDrawerIntent";
import type { TerminalNavigationActions } from "./TerminalNavigationPanels";
import "./terminalNavigation.css";

export interface TerminalNavigationBarProps extends TerminalNavigationActions {
  navigation: Pick<ReturnType<typeof useTerminalNavigation>, "entries" | "groups" | "projectGroups" | "totalCount">;
  position: "top" | "bottom";
  tabBarVisible?: boolean;
  onNewTab: () => void;
  onReorder?: (fromId: string, toId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: () => void;
  contextLabels: Parameters<typeof import("../lib/terminalTabsModel").buildTerminalTabContext>[3];
}

export function TerminalNavigationBar({
  navigation, position, tabBarVisible = true, onReorder, onClose, onCloseOthers,
  contextLabels, ...actions
}: TerminalNavigationBarProps) {
  const { t } = useI18n();
  const drawer = useTerminalDrawerIntent({ enabled: tabBarVisible });
  const activeId = navigation.entries.find((entry) => entry.current)?.id ?? null;
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
      {navigation.entries.length > 0 ? <TerminalTabRow
        entries={navigation.entries}
        activeId={activeId}
        contextLabels={contextLabels}
        sortable
        onReorder={onReorder}
        onActivate={actions.onActivate}
        onClose={onClose}
        closeLabel={(title) => t("terminal.tab.close", { title })}
      /> : <div className="ui-terminal-navigation-empty" role="status">
        {t("terminal.navigation.empty")}
      </div>}
      <TerminalNavigationDrawer
        open={drawer.open}
        pinned={drawer.pinned}
        anchor={anchor}
        anchorProps={drawer.anchorProps}
        contentProps={drawer.contentProps}
        projectGroups={navigation.projectGroups}
        totalCount={navigation.totalCount}
        onActivate={actions.onActivate}
        onClose={onClose}
        onCloseOthers={onCloseOthers}
        onTogglePin={actions.onTogglePin}
        renderStatus={actions.renderStatus}
        renderSessionActions={actions.renderSessionActions}
        onOpenChange={(nextOpen) => nextOpen ? drawer.setOpen(true) : drawer.close()}
      />
    </div>
  </nav>;
}
