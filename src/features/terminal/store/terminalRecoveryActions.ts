import { assertRecoverySource as assertLocalPty, resolveRecoveryEnvironment } from "../lib/terminalRecoveryEnvironment";
import { cleanupPreparedTerminal, closeTerminalSource, releaseTerminalSource } from "./terminalSessionCandidate";
import type { TerminalRecoveryCoordination } from "./terminalRecoveryCoordination";
import { toast } from "sonner";
import type { TerminalSession } from "../../../shared/types/index";
import { translateCurrent } from "../../../shared/i18n/index";
import { useProjectStore } from "../../projects/api/projectStore";
import { saveRecoverySnapshot } from "../api/sessionStore";
import { terminalProcessManager, type TerminalAttachResult } from "../api/TerminalProcessManager";
import { buildWorkspanMirror } from "../lib/terminalStoreLayout";
import { replaceRecoveryLayoutSession } from "../lib/terminalRecoveryLayout";
import type { PreparedTerminalSession, TerminalStore } from "../types/terminalStoreTypes";

type StoreGet = () => TerminalStore;
type StoreSet = (partial: Partial<TerminalStore>) => void;

type RecoveryActions = Pick<
  TerminalStore,
  "probeSession" | "interruptSession" | "hardKillSession" | "openEmergencyTerminal" | "rebuildSession"
>;

export function createTerminalRecoveryActions(
  get: StoreGet,
  set: StoreSet,
  queueSshSessionPersistence: (sessions: TerminalSession[]) => Promise<void>,
  prepareSession: (...args: Parameters<TerminalStore["createSession"]>) => Promise<PreparedTerminalSession>,
  coordination: TerminalRecoveryCoordination,
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
      try { await get().closeSession(id, true); }
      catch (cause) { throw Object.assign(new Error("terminal_recovery_close_failed"), { cause }); }
    },
    openEmergencyTerminal: (id) => coordination.run(id, async (cancelled) => {
      const session = assertLocalPty(get().sessions.find(item => item.id === id));
      const environment = resolveRecoveryEnvironment(session, useProjectStore.getState());
      if (cancelled()) throw new Error("terminal_recovery_session_changed");
      const newId = await get().createSession(environment.projectId, environment.cwd, translateCurrent("terminal.recovery.emergencyTitle"), "", environment.envVars, environment.shell, undefined, environment.worktreeId, undefined, undefined, undefined, undefined, { allowDuplicateWorktree: true, recoveryShell: true });
      return newId;
    }, false, get().sessions.find(item => item.id === id)?.createdAtMs),
    rebuildSession: (id) => coordination.run(id, async (cancelled) => {
      const session = assertLocalPty(get().sessions.find(item => item.id === id));
      const incarnation = session.createdAtMs;
      const environment = resolveRecoveryEnvironment(session, useProjectStore.getState());
      const candidate = await prepareSession(environment.projectId, environment.cwd, session.title, "", environment.envVars, environment.shell, undefined, environment.worktreeId, undefined, undefined, undefined, undefined, { allowDuplicateWorktree: true, recoveryShell: true });
      try {
        const current = get().sessions.find(item => item.id === id);
        if (cancelled() || !current || current.createdAtMs !== incarnation) throw new Error("terminal_recovery_session_changed");
        const latestEnvironment = resolveRecoveryEnvironment(current, useProjectStore.getState());
        if (JSON.stringify(environment) !== JSON.stringify(latestEnvironment) || candidate.launch.environmentType === "ssh") throw new Error("terminal_recovery_session_changed");
        if (candidate.getStatus() !== "running") throw new Error("terminal_recovery_candidate_not_ready");
        try { await closeTerminalSource(session); }
        catch (cause) { throw Object.assign(new Error("terminal_recovery_close_failed"), { cause }); }
        const afterClose = get().sessions.find(item => item.id === id);
        if (!afterClose || afterClose.createdAtMs !== incarnation) throw new Error("terminal_recovery_session_changed");
      } catch (error) {
        await cleanupPreparedTerminal(candidate, get, set, error);
        throw error;
      }
      // No awaits or fallible external callbacks between ACK and publication.
      const current = get();
      const newId = candidate.session.id;
      const latestSource = current.sessions.find(item => item.id === id)!;
      const replacement = { ...candidate.session, title: latestSource.title, titleNaming: latestSource.titleNaming };
      const sessions = current.sessions.map(item => item.id === id ? replacement : item);
      const workspans = replaceRecoveryLayoutSession(current.workspans, id, newId);
      const mirror = buildWorkspanMirror(workspans, current.activeWorkspanId, sessions);
      const sessionStatuses = { ...current.sessionStatuses };
      const statusListeners = { ...current.statusListeners };
      const tabNotifications = { ...current.tabNotifications };
      const tabStatuses = { ...current.tabStatuses };
      const tabStatusDetails = { ...current.tabStatusDetails };
      const ptyOutputActivityAt = { ...current.ptyOutputActivityAt };
      delete sessionStatuses[id]; delete statusListeners[id]; delete tabNotifications[id];
      delete tabStatuses[id]; delete tabStatusDetails[id]; delete ptyOutputActivityAt[id];
      sessionStatuses[newId] = candidate.activate(); statusListeners[newId] = candidate.unlisten;
      set({ sessions, ...mirror, sessionStatuses, statusListeners, tabNotifications, tabStatuses, tabStatusDetails, ptyOutputActivityAt });
      candidate.releaseReservation();
      releaseTerminalSource(session, current.statusListeners[id]);
      try {
        await queueSshSessionPersistence(get().sessions);
        await saveRecoverySnapshot(get);
      } catch (cause) {
        throw Object.assign(new Error(candidate.getStatus() === "running" ? "terminal_recovery_persistence_failed" : "terminal_recovery_candidate_died_after_close"), { committedSessionId: newId, cause });
      }
      if (candidate.getStatus() !== "running") {
        throw Object.assign(new Error("terminal_recovery_candidate_died_after_close"), { committedSessionId: newId });
      }
      return newId;
    }, true, get().sessions.find(item => item.id === id)?.createdAtMs),
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
