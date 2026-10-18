import type { StoreApi } from "zustand";
import type { TerminalSession } from "../../../shared/types/index";
import type { TerminalStore } from "../types/terminalStoreTypes";
import { useSessionStore } from "../api/sessionStore";
import { buildWorkspanMirror, persistWorkspanState } from "../lib/terminalStoreLayout";
import { isHideableTerminalSession } from "../lib/terminalTabVisibility";
import { orderTerminalWorkspans } from "../api/terminalWorkspan";

/** Presentation close never tears down listeners, buffers, backing trees or PTYs. */
export function createTerminalTabLifecycle(
  set: StoreApi<TerminalStore>["setState"], get: StoreApi<TerminalStore>["getState"],
  saveSessions: (sessions: TerminalSession[]) => Promise<void>,
) {
  return {
    setFullscreenPaneId: (fullscreenPaneId: string | null): void => {
      set({ fullscreenPaneId });
    },
    hideSession: async (id: string): Promise<void> => {
      const state = get();
      const session = state.sessions.find((item) => item.id === id);
      if (!session) return;
      if (!isHideableTerminalSession(session)) {
        await state.closeSession(id);
        return;
      }
      if (session.tabHidden) return;
      const sessions = state.sessions.map((item) => item.id === id ? { ...item, tabHidden: true } : item);
      const mirror = buildWorkspanMirror(state.workspans, state.activeWorkspanId, sessions);
      set({ sessions, ...mirror });
      const persistence = useSessionStore.getState();
      await saveSessions(sessions);
      // Reopen or another batch may have advanced focus while persistence awaited.
      const current = get();
      await persistence.saveActiveSessionId(current.activeSessionId);
      await persistence.saveWorkspans(current.workspans, current.activeWorkspanId, current.sessions);
    },
    showSessions: async (ids: readonly string[]): Promise<void> => {
      const visibleIds = new Set(ids);
      const state = get();
      const sessions = state.sessions.map((item) => visibleIds.has(item.id) && item.tabHidden ? { ...item, tabHidden: false } : item);
      if (sessions.every((session, index) => session === state.sessions[index])) return;
      set({ sessions });
      await saveSessions(sessions);
    },
    inheritSessionTitle: (id: string, title: string): void => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const sessions = get().sessions.map((session) => {
        if (session.id !== id || session.titleNaming?.source === "custom" || session.titleNaming?.source === "task") return session;
        return session.title === trimmed ? session : { ...session, title: trimmed, titleNaming: { source: "task" as const } };
      });
      set({ sessions });
      void saveSessions(sessions);
    },
    reopenSession: (id: string): void => {
      // Explicit navigation is the only path that clears tabHidden. No create/attach.
      get().setActive(id);
    },
    orderWorkspans: (orderedIds: readonly string[]): void => {
      // Project-row drags reorder whole project blocks; reuse the Workspan
      // persistence channel so the order survives restarts.
      const state = get();
      const workspans = orderTerminalWorkspans(state.workspans, orderedIds);
      if (workspans === state.workspans) return;
      set({ workspans });
      persistWorkspanState(workspans, state.activeWorkspanId, state.sessions);
    },
  };
}
