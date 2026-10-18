import { toast } from "sonner";
import type { TerminalSession } from "../../../shared/types/index";
import { translateCurrent } from "../../../shared/i18n/index";
import { useProjectStore } from "../../projects/api/projectStore";
import { useSessionStore } from "../api/sessionStore";
import { terminalProcessManager, type TerminalAttachResult } from "../api/TerminalProcessManager";
import { buildWorkspanMirror } from "../lib/terminalStoreLayout";
import {
  removeSessionFromTerminalWorkspans,
  restoreTerminalWorkspans,
} from "../api/terminalWorkspan";
import type { TerminalStore } from "../types/terminalStoreTypes";

type StoreGet = () => TerminalStore;
type StoreSet = (partial: Partial<TerminalStore>) => void;

type RecoveryActions = Pick<
  TerminalStore,
  "probeSession" | "interruptSession" | "hardKillSession" | "openEmergencyTerminal" | "rebuildSession"
>;

function assertLocalPty(session: TerminalSession | undefined): TerminalSession {
  if (!session || (session.kind ?? "pty") !== "pty") {
    throw new Error("terminal_recovery_session_missing");
  }
  if (session.environmentType === "ssh" || session.sshHostId) {
    throw new Error("terminal_recovery_unsupported_remote");
  }
  return session;
}

function resolveRecoveryCwd(session: TerminalSession): string {
  const worktree = session.worktreeId
    ? useProjectStore.getState().worktrees.find((item) => item.id === session.worktreeId && item.status === "active")
    : undefined;
  if (session.worktreeId && !worktree) throw new Error("terminal_recovery_worktree_missing");
  const project = session.projectId
    ? useProjectStore.getState().projects.find((item) => item.id === session.projectId)
    : undefined;
  const cwd = session.cwd?.trim() || worktree?.path || project?.path;
  if (!cwd) throw new Error("terminal_recovery_cwd_missing");
  return cwd;
}

export function createTerminalRecoveryActions(
  get: StoreGet,
  set: StoreSet,
  queueSshSessionPersistence: (sessions: TerminalSession[]) => Promise<void>,
): RecoveryActions {
  return {
    probeSession: async (id): Promise<TerminalAttachResult> => {
      assertLocalPty(get().sessions.find((item) => item.id === id));
      return terminalProcessManager.probe(id);
    },
    interruptSession: async (id) => {
      assertLocalPty(get().sessions.find((item) => item.id === id));
      await terminalProcessManager.interrupt(id);
    },
    hardKillSession: async (id) => {
      assertLocalPty(get().sessions.find((item) => item.id === id));
      await get().closeSession(id, true);
    },
    openEmergencyTerminal: async (id) => {
      const session = assertLocalPty(get().sessions.find((item) => item.id === id));
      const cwd = resolveRecoveryCwd(session);
      return get().createSession(
        session.projectId,
        cwd,
        translateCurrent("terminal.recovery.emergencyTitle"),
        "",
        session.envVars ? { ...session.envVars } : undefined,
        session.shell ?? undefined,
        undefined,
        session.worktreeId,
        undefined,
        undefined,
        undefined,
        undefined,
        { allowDuplicateWorktree: true },
      );
    },
    rebuildSession: async (id) => {
      const initialState = get();
      const session = assertLocalPty(initialState.sessions.find((item) => item.id === id));
      const cwd = resolveRecoveryCwd(session);
      if (!get().sessions.some((item) => item.id === id && item.createdAtMs === session.createdAtMs)) {
        throw new Error("terminal_recovery_session_changed");
      }
      await get().closeSession(id, true);
      const newSessionId = await get().createSession(
        session.projectId,
        cwd,
        session.title,
        "",
        session.envVars ? { ...session.envVars } : undefined,
        session.shell ?? undefined,
        undefined,
        session.worktreeId,
        undefined,
        undefined,
        undefined,
        undefined,
        { allowDuplicateWorktree: true },
      );
      const current = get();
      const fallbackWorkspans = removeSessionFromTerminalWorkspans(current.workspans, newSessionId);
      const restoredWorkspans = restoreTerminalWorkspans(initialState.workspans, { [id]: newSessionId });
      const workspans = restoredWorkspans.length > 0 ? restoredWorkspans : fallbackWorkspans;
      const mirror = buildWorkspanMirror(workspans, initialState.activeWorkspanId, current.sessions);
      set({ ...mirror });
      await queueSshSessionPersistence(current.sessions);
      await useSessionStore.getState().saveActiveSessionId(mirror.activeSessionId);
      await useSessionStore.getState().saveWorkspans(workspans, mirror.activeWorkspanId, current.sessions);
      return newSessionId;
    },
  };
}

export function recoveryToastMessage(error: unknown): string {
  const code = String(error).match(/terminal_recovery_[a-z_]+/)?.[0];
  if (code === "terminal_recovery_unsupported_remote") return translateCurrent("terminal.recovery.unsupported");
  if (code === "terminal_recovery_session_missing") return translateCurrent("terminal.recovery.sessionMissing");
  return translateCurrent("terminal.recovery.failed");
}

export function showRecoveryFailure(error: unknown): void {
  toast.error(recoveryToastMessage(error));
}
