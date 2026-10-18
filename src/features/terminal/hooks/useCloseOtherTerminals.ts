import { useCallback } from "react";
import { useAppConfirm } from "../../../shared/ui/useAppConfirm";
import { useI18n } from "../../../shared/i18n";
import { useTerminalStore } from "../store/terminalStore";
import { collectOtherSessionIds } from "../lib/currentWorkModel";

interface UseCloseOtherTerminalsOptions {
  currentWorkSessionIdsRef: { current: string[] };
  confirm: ReturnType<typeof useAppConfirm>["confirm"];
  showSessions: (sessionIds: string[]) => Promise<void>;
  closeSessions: (sessionIds: string[], protectedSessionIds: readonly string[], destroy: boolean) => void;
}

export function useCloseOtherTerminals({
  currentWorkSessionIdsRef,
  confirm,
  showSessions,
  closeSessions,
}: UseCloseOtherTerminalsOptions) {
  const { t } = useI18n();

  return useCallback(() => {
    const protectedIds = [...currentWorkSessionIdsRef.current];
    const targetIds = collectOtherSessionIds(useTerminalStore.getState().sessions, protectedIds);
    if (targetIds.length === 0) return;

    void confirm({
      title: t("terminal.currentWork.closeOtherConfirmTitle", { count: targetIds.length }),
      message: t("terminal.currentWork.closeOtherConfirmMessage"),
      confirmText: t("terminal.currentWork.closeOtherConfirm"),
      danger: true,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      await showSessions(protectedIds);
      const latestTargetIds = collectOtherSessionIds(useTerminalStore.getState().sessions, protectedIds);
      if (latestTargetIds.length > 0) closeSessions(latestTargetIds, protectedIds, true);
    });
  }, [closeSessions, confirm, currentWorkSessionIdsRef, showSessions, t]);
}
