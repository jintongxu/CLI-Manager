import { invoke } from "@tauri-apps/api/core";
import { logError } from "../../../shared/platform/logger";
import type { WindowWithPtyOrphanTimer } from "../types/terminalStoreTypes";
import { PTY_ORPHAN_RECONCILE_INTERVAL_MS, TERMINAL_STORE_IN_TAURI } from "./terminalStatus";

export function startPtyOrphanReconcileHeartbeat(getActiveSessionIds: () => string[]): void {
  if (!TERMINAL_STORE_IN_TAURI || typeof window === "undefined") return;
  const host = window as WindowWithPtyOrphanTimer;
  if (host.__CLI_MANAGER_PTY_ORPHAN_RECONCILE_TIMER__) return;
  host.__CLI_MANAGER_PTY_ORPHAN_RECONCILE_TIMER__ = setInterval(() => {
    const activeSessionIds = getActiveSessionIds();
    if (activeSessionIds.length === 0) return;
    void invoke("pty_reconcile_active_sessions", { activeSessionIds }).catch((err) => {
      logError("pty_reconcile_active_sessions invoke failed", { activeSessionIds: activeSessionIds.length, err });
    });
  }, PTY_ORPHAN_RECONCILE_INTERVAL_MS);
}
