import type { Group, Project, TerminalScope, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { useI18n } from "../../../shared/i18n";
import { useTerminalStore } from "../state";
import { useTerminalNavigation } from "../hooks/useTerminalNavigation";
import type { useTerminalTabsController } from "../hooks/useTerminalTabsController";
import { collectPaneLeaves } from "../api/terminalPaneTree";
import { PaneTabBar } from "./PaneTabBar";
import { TerminalNavigationBar } from "./TerminalNavigationBar";

type Controller = ReturnType<typeof useTerminalTabsController>;
interface Props {
  sessions: TerminalSession[]; projects: Project[]; worktrees: WorktreeRecord[]; groups: Group[]; scope: TerminalScope;
  currentSessionId: string | null;
  position: "top" | "bottom"; tabBarVisible?: boolean;
  /** Existing canonical activation owns reopening hidden tabs and focusing their pane. */
  onActivateSession: (id: string) => void;
  onNewTab: () => void;
  onCloseSession?: (id: string) => void;
  onCloseOthers: () => void;
  paneProps: Controller["paneNavigationProps"]; layouts: Controller["mountedWorkspanLayouts"];
  onRename: (session: TerminalSession) => void;
}

/** One scoped collection for tabs, drawer counts, and canonical activation. */
export function TerminalNavigationAdapter(props: Props) {
  const { t } = useI18n();
  const sessionStatuses = useTerminalStore((state) => state.sessionStatuses);
  const navigation = useTerminalNavigation({ ...props, sessionStatuses });
  const activate = (id: string) => {
    if (!navigation.resolveActivation(id)) return;
    props.onActivateSession(id);
    navigation.recordVisit(id);
  };
  const panes = props.layouts.flatMap((layout) => collectPaneLeaves(layout.paneTree));
  return <TerminalNavigationBar
    navigation={navigation}
    position={props.position}
    tabBarVisible={props.tabBarVisible}
    onClose={(id) => props.onCloseSession?.(id)}
    onCloseOthers={props.onCloseOthers}
    onActivate={activate}
    onNewTab={props.onNewTab}
    onReorder={navigation.reorderNavigation}
    onTogglePin={navigation.togglePin}
    renderStatus={(entry) => <span role="status" aria-label={entry.session.connectionState ?? sessionStatuses[entry.id] ?? "unknown"}>
      {entry.session.connectionState === "disconnected" || entry.session.connectionState === "failed" ? "○" : "●"}
      {entry.session.worktreeId && (!entry.worktree || entry.worktree.status === "missing") ? " !" : ""}
    </span>}
    renderSessionActions={(entry) => {
      const pane = panes.find((item) => item.sessionIds.includes(entry.id))
        ?? { type: "leaf" as const, id: `navigation-${entry.id}`, sessionIds: [entry.id], activeSessionId: entry.id };
      return <PaneTabBar {...props.paneProps} pane={pane} actionSessionId={entry.id}
        allPanes={props.layouts.find((layout) => collectPaneLeaves(layout.paneTree).some((leaf) => leaf.id === pane.id))?.visiblePanes ?? [pane]}
        activeSessionId={props.currentSessionId} visibleSessionIds={new Set(navigation.entries.map((item) => item.id))}
        isPaneFullscreen={false} onActivateSession={activate}
        onToggleNavigationPin={navigation.togglePin} navigationPinnedIds={navigation.memory.pinnedIds}
        onStartEdit={(id) => { const session = props.sessions.find((item) => item.id === id); if (session) props.onRename(session); }} />;
    }}
    contextLabels={{ unboundProject: t("terminal.context.unboundProject"), anonymousPi: t("terminal.context.anonymousPi"), missingWorktree: t("terminal.context.worktreeMissing"), defaultShell: t("terminal.context.defaultShell") }}
  />;
}
