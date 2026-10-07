import type { TerminalSession } from "../../../shared/types/index";
import { getSidebarTerminalPartition, isOrdinarySidebarTerminal, sameSidebarTerminalPartition } from "../../../shared/lib/sidebarTerminalOrder";
import type { TerminalStore } from "../types/terminalStoreTypes";

type Actions = Pick<TerminalStore, "setSidebarPinned" | "reorderSidebarSessions" | "moveSidebarSession">;

export function createTerminalSidebarMetadata(
  set: (state: Partial<TerminalStore>) => void,
  get: () => TerminalStore,
  persist: (sessions: TerminalSession[]) => Promise<void>,
): Actions {
  const apply = (ordered: TerminalSession[], pinned?: boolean) => {
    const changes = new Map(ordered.map((session, sidebarOrder) => [session.id, { sidebarOrder,
      ...(pinned === undefined ? {} : { sidebarPinned: pinned }) }]));
    const current = get().sessions;
    const next = current.map((session) => {
      const metadata = changes.get(session.id);
      return metadata && (session.sidebarOrder !== metadata.sidebarOrder
        || (pinned !== undefined && session.sidebarPinned !== pinned)) ? { ...session, ...metadata } : session;
    });
    if (next.every((session, index) => session === current[index])) return;
    set({ sessions: next });
    void persist(next).catch(() => {});
  };
  const reorderSidebarSessions = (fromId: string, toId: string): boolean => {
    const sessions = get().sessions;
    const from = sessions.find((session) => session.id === fromId);
    const to = sessions.find((session) => session.id === toId);
    if (!from || !to || from === to || !sameSidebarTerminalPartition(from, to)) return false;
    const ordered = getSidebarTerminalPartition(sessions, from);
    const fromIndex = ordered.indexOf(from);
    const toIndex = ordered.indexOf(to);
    ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, from);
    apply(ordered);
    return true;
  };
  return {
    setSidebarPinned: (id, pinned) => {
      const sessions = get().sessions;
      const target = sessions.find((session) => session.id === id);
      if (!target || !isOrdinarySidebarTerminal(target) || (target.sidebarPinned === true) === pinned) return false;
      const partition = getSidebarTerminalPartition(sessions, { ...target, sidebarPinned: pinned });
      apply([...partition, target], pinned);
      return true;
    },
    reorderSidebarSessions,
    moveSidebarSession: (id, delta) => {
      if (delta !== 1 && delta !== -1) return false;
      const sessions = get().sessions;
      const target = sessions.find((session) => session.id === id);
      if (!target || !isOrdinarySidebarTerminal(target)) return false;
      const partition = getSidebarTerminalPartition(sessions, target);
      const neighbor = partition[partition.indexOf(target) + delta];
      return neighbor ? reorderSidebarSessions(id, neighbor.id) : false;
    },
  };
}
