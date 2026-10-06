import { useCallback } from "react";
import { toast } from "sonner";
import { useTerminalStore } from "../../terminal/state";
import { useHistoryStore } from "../../history/index";
import { useGitWorkspaceStore } from "../../git/api/gitWorkspaceStore";
import { useI18n } from "../../../shared/i18n/index";
import type { TerminalScope } from "../../../shared/types/index";
import { deleteSidebarTerminal, getSidebarTerminals, openSidebarTerminal, getSidebarTerminalRenameTarget, renameSidebarTerminal } from "../lib/sidebarTerminals";
import { useAppConfirm } from "../../../shared/ui/useAppConfirm";

type Confirm = ReturnType<typeof useAppConfirm>["confirm"];
export function useSidebarTerminals(selectScope: (scope: TerminalScope) => void, confirm: Confirm) {
  const { t } = useI18n();
  const sessions = useTerminalStore((s) => s.sessions);
  const statuses = useTerminalStore((s) => s.sessionStatuses);
  const activeTerminalId = useTerminalStore((s) => s.activeSessionId);
  const getTerminals = useCallback((projectId: string, worktreeId?: string) => getSidebarTerminals(sessions, projectId, worktreeId), [sessions]);
  const onOpenTerminal = useCallback((id: string) => {
    const store = useTerminalStore.getState();
    const session = store.sessions.find((item) => item.id === id);
    if (session) openSidebarTerminal(session, {
      selectScope,
      closeHistory: useHistoryStore.getState().closeHistory,
      closeGitWorkspace: useGitWorkspaceStore.getState().close,
      reopenSession: store.reopenSession,
    });
  }, [selectScope]);
  const onDeleteTerminal = useCallback((id: string) => {
    void deleteSidebarTerminal(id, {
      getSession: (sessionId) => useTerminalStore.getState().sessions.find((item) => item.id === sessionId),
      confirm: (session) => confirm({
        title: t("sidebar.terminals.deleteTitle"),
        message: t("sidebar.terminals.deleteMessage", { title: session.title }),
        confirmText: t("sidebar.menu.delete"),
        danger: true,
      }),
      closeSession: (sessionId) => useTerminalStore.getState().closeSession(sessionId),
      onLocked: () => toast.warning(t("remoteHandoff.toast.lockedSession")),
    }).catch((err) => toast.error(t("sidebar.terminals.deleteFailed"), { description: String(err) }));
  }, [confirm, t]);
  const getTerminalRenameTarget = useCallback((id: string) => getSidebarTerminalRenameTarget(id,
    (sessionId) => useTerminalStore.getState().sessions.find((item) => item.id === sessionId)), []);
  const onRenameTerminal = useCallback((id: string, title: string) => renameSidebarTerminal(id, title, {
    getSession: (sessionId) => useTerminalStore.getState().sessions.find((item) => item.id === sessionId),
    renameSession: (sessionId, nextTitle) => useTerminalStore.getState().renameSession(sessionId, nextTitle),
  }), []);
  return {
    onPinTerminal: (id: string, pinned: boolean) => useTerminalStore.getState().setSidebarPinned(id, pinned),
    onMoveTerminal: (id: string, delta: 1 | -1) => useTerminalStore.getState().moveSidebarSession(id, delta),
    onReorderTerminal: (from: string, to: string) => useTerminalStore.getState().reorderSidebarSessions(from, to),
    getTerminalRenameTarget, onRenameTerminal, getTerminals, terminalStatuses: statuses, activeTerminalId, onOpenTerminal, onDeleteTerminal };
}
