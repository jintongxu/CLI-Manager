import { showProjectSpace } from "../../workspace/api/primarySpaceState";
import { useEffect } from "react";
import { CURRENT_WORK_ACTION_EVENT, CURRENT_WORK_TARGET_EVENT, type CurrentWorkAction, type CurrentWorkTarget } from "../api/currentWorkEvents";
import { useHistoryStore } from "../../history/index";
import { useTerminalStore } from "../state";
import { findPaneLeafBySession, type TerminalPaneNode } from "../api/terminalPaneTree";
import { navigateTerminalResource, TERMINAL_RESOURCE_TARGET_EVENT } from "../lib/terminalResourceNavigation";

interface NavigationListeners {
  currentWorkMode: boolean;
  currentWorkSessionIds: string[];
  currentWorkActiveSessionId: string | null;
  currentWorkPaneTree: TerminalPaneNode | null;
  currentWorkFullscreenPaneId: string | null;
  toggleCurrentWorkPaneFullscreen: (paneId: string) => void;
  activeSessionId: string | null;
  activateCurrentWork: (sessionId?: string) => void;
  activateCurrentWorkSession: (sessionId: string) => boolean;
  leaveCurrentWork: () => void;
  clearCurrentWork: () => void;
  toggleCurrentWork: (sessionId: string) => void;
  removeCurrentWorkSessions: (sessionIds: string[]) => void;
  setActive: (sessionId: string) => void;
  setActiveWorkspaceTab: (tab: "terminal") => void;
}

/** Window navigation listeners live together; keep add-to-work and inspection semantics separate. */
export function useTerminalNavigationListeners({
  currentWorkMode, currentWorkSessionIds, currentWorkActiveSessionId, activeSessionId,
  currentWorkPaneTree, currentWorkFullscreenPaneId, toggleCurrentWorkPaneFullscreen,
  activateCurrentWork, activateCurrentWorkSession, leaveCurrentWork, clearCurrentWork,
  toggleCurrentWork, removeCurrentWorkSessions, setActive, setActiveWorkspaceTab,
}: NavigationListeners) {
  useEffect(() => {
    const handleCurrentWorkTarget = (event: Event) => {
      showProjectSpace();
      const { sessionId } = (event as CustomEvent<CurrentWorkTarget>).detail;
      if (currentWorkMode) {
        if (!activateCurrentWorkSession(sessionId)) return;
        useHistoryStore.getState().closeHistory();
        setActiveWorkspaceTab("terminal");
        setActive(sessionId);
        return;
      }
      if (currentWorkSessionIds.includes(sessionId)) {
        activateCurrentWork(sessionId);
        return;
      }
      useHistoryStore.getState().closeHistory();
      setActiveWorkspaceTab("terminal");
      setActive(sessionId);
    };
    window.addEventListener(CURRENT_WORK_TARGET_EVENT, handleCurrentWorkTarget);
    return () => window.removeEventListener(CURRENT_WORK_TARGET_EVENT, handleCurrentWorkTarget);
  }, [activateCurrentWork, activateCurrentWorkSession, currentWorkMode, currentWorkSessionIds, setActive, setActiveWorkspaceTab]);
  useEffect(() => {
    const handleCurrentWorkAction = (event: Event) => {
      showProjectSpace();
      const action = (event as CustomEvent<CurrentWorkAction>).detail;
      if (action === "toggle-view") {
        if (currentWorkMode) leaveCurrentWork(); else activateCurrentWork();
      } else if (action === "next" || action === "previous") {
        if (!currentWorkSessionIds.length) return;
        const index = currentWorkSessionIds.indexOf(currentWorkActiveSessionId ?? "");
        const delta = action === "next" ? 1 : -1;
        activateCurrentWork(currentWorkSessionIds[(index + delta + currentWorkSessionIds.length) % currentWorkSessionIds.length]);
      } else if (action === "clear") clearCurrentWork();
      else if (action === "add-active" && activeSessionId) toggleCurrentWork(activeSessionId);
      else if (action === "remove-active" && currentWorkActiveSessionId) removeCurrentWorkSessions([currentWorkActiveSessionId]);
    };
    window.addEventListener(CURRENT_WORK_ACTION_EVENT, handleCurrentWorkAction);
    return () => window.removeEventListener(CURRENT_WORK_ACTION_EVENT, handleCurrentWorkAction);
  }, [activateCurrentWork, activeSessionId, clearCurrentWork, currentWorkActiveSessionId, currentWorkMode, currentWorkSessionIds, leaveCurrentWork, removeCurrentWorkSessions, toggleCurrentWork]);
  useEffect(() => {
    const target = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
      if (typeof sessionId !== "string") return;
      navigateTerminalResource(sessionId, {
        exists: (id) => useTerminalStore.getState().sessions.some((session) => session.id === id),
        currentWorkMode, currentWorkSessionIds, leaveCurrentWork, setActive,
        activateCurrentWork: (id) => {
          const pane = findPaneLeafBySession(currentWorkPaneTree, id);
          if (currentWorkFullscreenPaneId && pane?.id !== currentWorkFullscreenPaneId) {
            toggleCurrentWorkPaneFullscreen(currentWorkFullscreenPaneId);
          }
          activateCurrentWork(id);
        },
        showTerminal: () => {
          showProjectSpace();
          useHistoryStore.getState().closeHistory();
          setActiveWorkspaceTab("terminal");
        },
      });
    };
    window.addEventListener(TERMINAL_RESOURCE_TARGET_EVENT, target);
    return () => window.removeEventListener(TERMINAL_RESOURCE_TARGET_EVENT, target);
  }, [currentWorkMode, currentWorkSessionIds, currentWorkPaneTree, currentWorkFullscreenPaneId,
    toggleCurrentWorkPaneFullscreen, activateCurrentWork, leaveCurrentWork, setActive, setActiveWorkspaceTab]);
}
