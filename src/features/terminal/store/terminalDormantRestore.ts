import type { UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { TerminalSession } from "../../../shared/types/index";
import { translateCurrent } from "../../../shared/i18n/index";
import { logError, logInfo } from "../../../shared/platform/logger";
import { getOsPlatform, normalizeShellKey } from "../../../shared/platform/shell";
import { useSessionStore } from "../api/sessionStore";
import { listOwnedDaemonSessions } from "../api/ownedDaemonSessions";
import { terminalProcessManager } from "../api/TerminalProcessManager";
import { useProjectStore } from "../../projects/api/projectStore";
import { replaceRecoveryLayoutSession } from "../lib/terminalRecoveryLayout";
import {
  detectCliResumeKind, buildCliResumeStartupCommand, formatStartupInputForPty,
  resolvePtyLaunch, releaseProviderSnapshot,
  releaseProjectExtensionSnapshot,
} from "../lib/terminalLaunch";
import { normalizeDirectCodexStartupCommand } from "../../projects/api/projectStartupCommand";
import {
  applyPtyStatusToSessions, buildTabStatusUpdate, resolveAttachedDaemonSession,
  resolveDaemonAttachTaskStatus, resolveDaemonAttachUpdatedAt, summarizeStartupCmd,
} from "../lib/terminalStatus";
import { releaseRemoteHistoryConsumer } from "../lib/terminalStoreLayout";
import { validTitleNaming } from "../lib/terminalSessionNaming";
import type { DaemonSessionMeta, PtyStatusPayload, SessionStatus, TerminalStore } from "../types/terminalStoreTypes";

type StoreGet = () => TerminalStore;
type StoreSet = (partial: Partial<TerminalStore>) => void;

export interface DormantRestoreDeps {
  get: StoreGet;
  set: StoreSet;
  queueSshSessionPersistence: (sessions: TerminalSession[]) => Promise<void>;
  persistSshConnectionStateAfterPtyStatus(sessionId: string, payload: PtyStatusPayload): void;
}

export interface DormantRestoreCoordinator {
  isDormant: (id: string) => boolean;
  /** Rebuild or attach one dormant restored session; keeps it dormant on failure. */
  materializeDormantSession: (id: string) => Promise<boolean>;
  clearDormant: (id: string) => void;
}

/**
 * 休眠会话 = 重启恢复时仅回填元数据、未实体化 PTY 的隐藏终端（运行态派生，不落盘）。
 * 用户重新打开时在此实体化：daemon 存活 → attach；否则按恢复语义重建并贴回 scrollback。
 */
export function createDormantRestoreCoordinator(deps: DormantRestoreDeps): DormantRestoreCoordinator {
  const { get, set } = deps;

  const removeFromDormant = (id: string) => {
    const dormant = get().dormantRestoredSessionIds;
    if (!dormant.has(id)) return;
    const next = new Set(dormant);
    next.delete(id);
    set({ dormantRestoredSessionIds: next });
  };

  const isDormant = (id: string) => get().dormantRestoredSessionIds.has(id);

  /** Complete the user's pending activation now that a real PTY backs the tab. */
  const commitActivation = (finalId: string) => {
    const state = get();
    if (!state.sessions.some((session) => session.id === finalId)) return;
    const sessions = state.sessions.map((session) => (
      session.id === finalId && session.tabHidden ? { ...session, tabHidden: false } : session
    ));
    set({ sessions });
    void deps.queueSshSessionPersistence(sessions);
    state.setActive(finalId);
  };

  const materializeViaDaemon = async (ps: TerminalSession, daemonSession: DaemonSessionMeta): Promise<boolean> => {
    const taskStatus = resolveDaemonAttachTaskStatus(daemonSession);
    const taskUpdatedAt = resolveDaemonAttachUpdatedAt(daemonSession);
    const attachedMeta = resolveAttachedDaemonSession(ps, daemonSession);
    const attachedSession: TerminalSession = {
      ...ps,
      projectId: attachedMeta.projectId,
      worktreeId: attachedMeta.worktreeId,
      title: attachedMeta.title,
      titleNaming: validTitleNaming(ps.titleNaming),
      cwd: attachedMeta.cwd,
      shell: attachedMeta.shell,
      environmentType: attachedMeta.environmentType,
      sshHostId: attachedMeta.sshHostId,
      remotePath: attachedMeta.remotePath,
      connectionState: attachedMeta.connectionState,
      disconnectReason: attachedMeta.disconnectReason,
      createdAtMs: daemonSession.createdAtMs ?? ps.createdAtMs,
      deferStartupUntilInitialOutput: false,
    };
    const unlisten = await terminalProcessManager.subscribeStatus(ps.id, (payload) => {
      const status = payload.status as SessionStatus;
      if (status !== "running") releaseRemoteHistoryConsumer(attachedSession);
      const store = deps.get();
      deps.set({
        sessions: applyPtyStatusToSessions(store.sessions, ps.id, payload),
        sessionStatuses: { ...store.sessionStatuses, [ps.id]: status },
      });
      deps.persistSshConnectionStateAfterPtyStatus(ps.id, payload);
    });
    const state = get();
    set({
      sessions: state.sessions.map((session) => session.id === ps.id ? attachedSession : session),
      sessionStatuses: { ...state.sessionStatuses, [ps.id]: daemonSession.alive ? "running" : "exited" },
      statusListeners: { ...state.statusListeners, [ps.id]: unlisten },
      daemonAttachPendingSessionIds: new Set([...state.daemonAttachPendingSessionIds, ps.id]),
      ...buildTabStatusUpdate(state, ps.id, "hook", taskStatus, taskUpdatedAt),
    });
    if (!daemonSession.alive) releaseRemoteHistoryConsumer(attachedSession);
    removeFromDormant(ps.id);
    return true;
  };

  const materializeViaRecreate = async (ps: TerminalSession): Promise<string | null> => {
    const os = await getOsPlatform();
    const restoreProject = ps.projectId
      ? useProjectStore.getState().projects.find((project) => project.id === ps.projectId)
      : undefined;
    const detectedKind = detectCliResumeKind(ps.startupCmd,
      ps.isAgentSession === false ? undefined : restoreProject, ps.cliTool);
    const cliKind = ps.isAgentSession === false && detectedKind !== "pi" ? null : detectedKind;
    const restoredStartupCmd = cliKind
      ? buildCliResumeStartupCommand(
        cliKind,
        ps.cliSessionId,
        restoreProject,
        ps.providerSnapshot ? { includeProviderOverrides: false } : {},
      )
      : ps.isAgentSession === false && !ps.startupCmd ? "" : normalizeDirectCodexStartupCommand(ps.startupCmd);
    let launch;
    try {
      launch = await resolvePtyLaunch({
        projectId: ps.projectId,
        worktreeId: ps.worktreeId,
        sshHostId: ps.sshHostId,
        cwd: ps.environmentType === "ssh" ? (ps.remotePath ?? ps.cwd) : ps.cwd,
        startupCmd: restoredStartupCmd,
        envVars: ps.envVars,
        shell: ps.shell,
        providerSnapshot: ps.providerSnapshot,
        extensionSnapshotId: ps.extensionSnapshotId,
      }, os);
    } catch (err) {
      logError("Failed to resolve dormant session launch", { sessionId: ps.id, err });
      toast.error(translateCurrent("terminal.dormant.reopenFailed"), { description: String(err) });
      return null;
    }

    let newSessionId: string;
    try {
      newSessionId = await terminalProcessManager.create(launch.invokeArgs);
    } catch (err) {
      logError("Failed to recreate dormant session", { sessionId: ps.id, err });
      releaseProviderSnapshot(launch.providerSnapshot);
      releaseProjectExtensionSnapshot(launch.extensionSnapshotId);
      toast.error(translateCurrent("terminal.dormant.reopenFailed"), { description: String(err) });
      return null;
    }

    // 恢复按会话类型分流：CLI 会话走原生 resume，普通 shell 会话静态贴回 scrollback。
    const shellKey = normalizeShellKey(launch.shell) ?? null;
    const hasInitialOutput = !!ps.initialTerminalOutput && !cliKind;
    const restoredSession: TerminalSession = {
      ...ps,
      id: newSessionId,
      createdAtMs: Date.now(),
      shell: launch.shell ?? ps.shell,
      startupCmd: restoredStartupCmd === "" ? "" : launch.startupHandledByLaunch ? restoredStartupCmd : launch.startupCmd,
      environmentType: launch.environmentType ?? ps.environmentType,
      sshHostId: launch.sshHostId ?? ps.sshHostId,
      remotePath: launch.remotePath ?? ps.remotePath,
      connectionState: (launch.environmentType ?? ps.environmentType) === "ssh" ? "connecting" : undefined,
      disconnectReason: undefined,
      providerSnapshot: launch.providerSnapshot ?? undefined,
      extensionSnapshotId: launch.extensionSnapshotId ?? undefined,
      extensionPolicyRevision: launch.extensionPolicyRevision,
      extensionLaunchStatus: launch.extensionStatus,
      initialTerminalOutput: hasInitialOutput ? ps.initialTerminalOutput : undefined,
      initialTerminalSize: hasInitialOutput ? ps.initialTerminalSize : undefined,
      deferStartupUntilInitialOutput: hasInitialOutput && !!launch.startupCmd,
    };

    let unlisten: UnlistenFn;
    try {
      unlisten = await terminalProcessManager.subscribeStatus(newSessionId, (payload) => {
        const status = payload.status as SessionStatus;
        const store = deps.get();
        deps.set({
          sessions: applyPtyStatusToSessions(store.sessions, newSessionId, payload),
          sessionStatuses: { ...store.sessionStatuses, [newSessionId]: status },
        });
        deps.persistSshConnectionStateAfterPtyStatus(newSessionId, payload);
        if (status === "exited" || status === "error") releaseRemoteHistoryConsumer(restoredSession);
      });
    } catch (err) {
      logError("Failed to register dormant session status listener", { sessionId: newSessionId, err });
      await terminalProcessManager.close(newSessionId).catch(() => { });
      releaseProviderSnapshot(launch.providerSnapshot);
      releaseProjectExtensionSnapshot(launch.extensionSnapshotId);
      toast.error(translateCurrent("terminal.dormant.reopenFailed"), { description: String(err) });
      return null;
    }

    const state = get();
    const sessions = state.sessions.map((session) => session.id === ps.id ? restoredSession : session);
    const workspans = replaceRecoveryLayoutSession(state.workspans, ps.id, newSessionId);
    const activeWorkspanId = state.activeWorkspanId
      && workspans.some((workspan) => workspan.id === state.activeWorkspanId)
      ? state.activeWorkspanId
      : workspans[0]?.id ?? null;
    set({
      sessions,
      workspans,
      activeWorkspanId,
      sessionStatuses: { ...state.sessionStatuses, [newSessionId]: "running" },
      statusListeners: { ...state.statusListeners, [newSessionId]: unlisten },
    });
    removeFromDormant(ps.id);
    try {
      await deps.queueSshSessionPersistence(get().sessions);
      await useSessionStore.getState().saveSessions(get().sessions);
      await useSessionStore.getState().saveWorkspans(get().workspans, get().activeWorkspanId, get().sessions);
    } catch (err) {
      logError("Failed to persist materialized dormant session", { sessionId: newSessionId, err });
    }

    // 执行启动命令：CLI resume / 无历史画面的普通命令直接写入；有历史画面时由
    // XTermTerminal 在贴回完成后重放（deferStartupUntilInitialOutput），避免双写。
    const launchStartupCmd = restoredSession.startupCmd;
    if (launchStartupCmd && !launch.startupHandledByLaunch && !hasInitialOutput) {
      setTimeout(() => {
        terminalProcessManager.write(newSessionId, formatStartupInputForPty(launchStartupCmd, shellKey)).catch((err) => {
          logError("Failed to write startup command on dormant materialize", {
            sessionId: newSessionId,
            startupCmdSummary: summarizeStartupCmd(launchStartupCmd),
            err,
          });
        });
      }, 500);
    }
    return newSessionId;
  };

  const materialize = async (id: string): Promise<boolean> => {
    if (!isDormant(id)) return true;
    const ps = get().sessions.find((session) => session.id === id);
    if (!ps) {
      removeFromDormant(id);
      return false;
    }
    try {
      const daemonSessions = await listOwnedDaemonSessions();
      const daemonSession = daemonSessions.find((session) => session.sessionId === id);
      if (daemonSession) {
        const ok = await materializeViaDaemon(ps, daemonSession);
        if (ok) commitActivation(ps.id);
        return ok;
      }
    } catch (err) {
      logInfo("daemon sessions unavailable for dormant materialize, recreating", { err });
    }
    const newSessionId = await materializeViaRecreate(ps);
    if (newSessionId) commitActivation(newSessionId);
    return newSessionId !== null;
  };

  // Sidebar reopen and canonical navigation may request the same dormant owner
  // in one turn. Share the entire operation, including remap and final activation.
  const inFlight = new Map<string, Promise<boolean>>();
  const materializeDormantSession = (id: string): Promise<boolean> => {
    const pending = inFlight.get(id);
    if (pending) return pending;
    const operation = Promise.resolve().then(() => materialize(id)).finally(() => {
      inFlight.delete(id);
    });
    inFlight.set(id, operation);
    return operation;
  };

  return { isDormant, materializeDormantSession, clearDormant: removeFromDormant };
}
