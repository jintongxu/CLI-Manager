import { useMemo } from "react";
import type { TerminalSession } from "../../../shared/types/index";
import type { TerminalWorkspan } from "../api/terminalWorkspan";
import { terminalPresentationAllowedIds } from "../lib/terminalPresentation";
import { useTerminalVisibleLayouts } from "./useTerminalVisibleLayouts";

/** Scope filters geometry/focus only; canonical backing owners remain mounted. */
export function useTerminalPresentation(
  workspans: TerminalWorkspan[], sessions: TerminalSession[], scope: Set<string> | null,
  activeWorkspanId: string | null, activeSessionId: string | null, fullscreenPaneId: string | null,
) {
  const allowedIds = useMemo(() => terminalPresentationAllowedIds(sessions, scope), [sessions, scope]);
  return useTerminalVisibleLayouts(workspans, sessions, allowedIds, activeWorkspanId, activeSessionId, fullscreenPaneId);
}
