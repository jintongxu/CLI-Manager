import { showProjectSpace } from "../../workspace/api/primarySpaceState";
import { useEffect } from "react";
import { useHistoryStore } from "../../history/index";
import { useTerminalStore } from "../state";
import { navigateTerminalResource, TERMINAL_RESOURCE_TARGET_EVENT } from "../lib/terminalResourceNavigation";

import { TERMINAL_SESSION_TARGET_EVENT } from "../api/terminalNavigationEvents";

interface NavigationListeners {
  setActive: (sessionId: string) => void;
  setActiveWorkspaceTab: (tab: "terminal") => void;
}

/** All external entries select canonical owners; no membership or mode authority. */
export function useTerminalNavigationListeners({ setActive, setActiveWorkspaceTab }: NavigationListeners) {
  useEffect(() => {
    const target = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
      if (typeof sessionId !== "string") return;
      navigateTerminalResource(sessionId, {
        exists: (id) => useTerminalStore.getState().sessions.some((session) => session.id === id),
        setActive,
        showTerminal: () => {
          showProjectSpace();
          useHistoryStore.getState().closeHistory();
          setActiveWorkspaceTab("terminal");
        },
      });
    };
    window.addEventListener(TERMINAL_SESSION_TARGET_EVENT, target);
    window.addEventListener(TERMINAL_RESOURCE_TARGET_EVENT, target);
    return () => {
      window.removeEventListener(TERMINAL_SESSION_TARGET_EVENT, target);
      window.removeEventListener(TERMINAL_RESOURCE_TARGET_EVENT, target);
    };
  }, [setActive, setActiveWorkspaceTab]);
}
