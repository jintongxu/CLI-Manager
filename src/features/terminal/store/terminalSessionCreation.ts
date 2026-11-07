import type { UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { TerminalSession } from "../../../shared/types/index";
import { logError, recordCrashActivity } from "../../../shared/platform/logger";
import { useSessionStore } from "../api/sessionStore";
import { getOsPlatform, normalizeShellKey } from "../../../shared/platform/shell";
import { useProjectStore } from "../../projects/api/projectStore";
import { translateCurrent } from "../../../shared/i18n/index";
import { terminalProcessManager } from "../api/TerminalProcessManager";
import { addSessionToPaneTree } from "../api/terminalPaneTree";
import { createTerminalWorkspan, findWorkspanByPane, syncTerminalWorkspanLayout, updateTerminalWorkspan, type TerminalWorkspan } from "../api/terminalWorkspan";
import { type SessionStatus, type TerminalStore, type ResolvedPtyLaunch } from "../types/terminalStoreTypes";
import { buildWorkspanMirror, persistCommittedLaunch, releaseRemoteHistoryConsumer } from "../lib/terminalStoreLayout";
import { formatStartupInputForPty, getProjectAgentTerminalMetadata, releaseProjectExtensionSnapshot, releaseProviderSnapshot, resolvePtyLaunch } from "../lib/terminalLaunch";
import { formatTerminalCreateError, summarizeStartupCmd, logTerminalExitStatus, buildTabStatusUpdate, applyPtyStatusToSessions } from "../lib/terminalStatus";
import { reserveWorktreeLaunch } from "../../../shared/lib/worktreeLaunchAdmission";
import { assignTerminalTitle, terminalPurpose } from "../lib/terminalSessionNaming";
import { createWorktreeSessionAdmission } from "../lib/worktreeSessionAdmission";
import { sshHostNameForLaunch } from "../lib/terminalSshNaming";
import { preparedTerminalSessionIds, retainPreparedTerminal, TerminalCandidateCleanupError } from "./terminalSessionCandidate";
import type { PreparedTerminalSession, PtyStatusPayload } from "../types/terminalStoreTypes";

const worktreeSessionAdmission = createWorktreeSessionAdmission();
export function createTerminalSessionCreation(set: (partial: Partial<TerminalStore> | ((state: TerminalStore) => Partial<TerminalStore>)) => void, get: () => TerminalStore, queueSshSessionPersistence: (sessions: TerminalSession[]) => Promise<void>, persistSshConnectionStateAfterPtyStatus: (id: string, payload: PtyStatusPayload) => void, createWorkspanId: () => string, createPaneId: () => string, getPendingNamingSessions: () => TerminalSession[]) {
  const execute = async (prepareOnly: boolean, ...[projectId, cwd, title, startupCmd, envVars, shell, paneId, worktreeId, sshHostId, cliSessionId, remoteHistoryConsumerId, remoteHistorySourceInstanceId, options]: Parameters<TerminalStore["createSession"]>) => {
      const ordinaryWorktree = Boolean(worktreeId) && !options?.sessionKind && !options?.transientBackground && !options?.allowDuplicateWorktree;
      const admission = ordinaryWorktree ? worktreeSessionAdmission.begin(worktreeId!, get().sessions) : null;
      if (admission && "existingId" in admission) {
        get().setActive(admission.existingId);
        return admission.existingId;
      }
      if (admission && !("token" in admission) && "promise" in admission) return admission.promise;
      const admissionToken = admission && "token" in admission ? admission.token : undefined;
      if (worktreeId && !useProjectStore.getState().worktrees.some(item => item.id === worktreeId && item.status === "active")) {
        worktreeSessionAdmission.reject(worktreeId!, admissionToken, new Error("finish_invalid_checkout"));
        worktreeSessionAdmission.finish(worktreeId, admissionToken);
        throw new Error("finish_invalid_checkout");
      }
      const launchScope = cwd ?? (worktreeId
        ? useProjectStore.getState().worktrees.find(item => item.id === worktreeId)?.path
        : useProjectStore.getState().projects.find(item => item.id === projectId)?.path);
      let releaseLaunch: () => void;
      try {
        releaseLaunch = reserveWorktreeLaunch(sshHostId ? undefined : launchScope);
      } catch (error) {
        worktreeSessionAdmission.reject(worktreeId!, admissionToken, error);
        worktreeSessionAdmission.finish(worktreeId, admissionToken);
        throw error;
      }
      let reservationTransferred = false;
      try {
        const sessionKind = options?.sessionKind;
        const transientBackground = options?.transientBackground === true && sessionKind !== "ephemeral-pi";
        const oneShot = options?.oneShot === true && transientBackground;
        const os = await getOsPlatform();
        const createdAtMs = Date.now();
        let launch: ResolvedPtyLaunch | null = null;
        let sessionId: string;
        try {
          launch = await resolvePtyLaunch({ projectId, worktreeId, sshHostId, cwd, startupCmd, envVars: oneShot && startupCmd ? { ...(envVars ?? {}), CLI_MANAGER_ONE_SHOT_COMMAND: startupCmd } : envVars, shell, sessionKind, providerSnapshot: options?.providerSnapshot, extensionSnapshotId: options?.extensionSnapshotId, providerId: options?.providerId }, os);
          if (options?.recoveryShell && (launch.environmentType === "ssh" || launch.invokeArgs.sshLaunch)) {
            throw new Error("terminal_recovery_unsupported_remote");
          }
          recordCrashActivity("terminal.session_create", {
            projectId: projectId ?? null,
            worktreeId: worktreeId ?? null,
            cwd: cwd ?? null,
            shell: launch.shell,
            paneId: paneId ?? null,
            startupCmdSummary: summarizeStartupCmd(launch.startupCmd),
          });
          sessionId = await terminalProcessManager.create(launch.invokeArgs);
          preparedTerminalSessionIds.add(sessionId);
        } catch (err) {
          const description = formatTerminalCreateError(err);
          toast.error(translateCurrent("terminal.toast.createFailed"), { description });
          logError("PtyHost create failed", {
            projectId: projectId ?? null,
            cwd: cwd ?? null,
            shell: shell ?? null,
            err,
          });
          releaseProviderSnapshot(launch?.providerSnapshot);
          releaseProjectExtensionSnapshot(launch?.extensionSnapshotId);
          throw err;
        }
        if (!launch) throw new Error("terminal_launch_missing");
        const resolvedShell = launch.shell;
        const launchStartupCmd = launch.startupCmd;
        const startupWrittenBeforeAttach = sessionKind === "ephemeral-pi" && Boolean(launchStartupCmd) && !launch.startupHandledByLaunch && !oneShot;
        const session: TerminalSession = {
          id: sessionId,
          createdAtMs,
          projectId,
          worktreeId,
          title: title ?? "Terminal",
          cwd: sessionKind === "ephemeral-pi" ? undefined : cwd,
          shell: resolvedShell,
          envVars,
          startupCmd: sessionKind !== "ephemeral-pi" && startupCmd === "" ? ""
            : launch.startupHandledByLaunch || sessionKind === "ephemeral-pi" ? launchStartupCmd : startupCmd,
          ...(sessionKind === "ephemeral-pi"
            ? { kind: sessionKind, isAgentSession: true, cliTool: "pi" }
            : getProjectAgentTerminalMetadata(projectId, startupCmd)),
          environmentType: launch.environmentType,
          sshHostId: launch.sshHostId,
          remotePath: launch.remotePath,
          connectionState: launch.environmentType === "ssh" ? "connecting" : undefined,
          providerSnapshot: launch.providerSnapshot ?? undefined,
          extensionSnapshotId: launch.extensionSnapshotId ?? undefined,
          extensionPolicyRevision: launch.extensionPolicyRevision,
          extensionLaunchStatus: launch.extensionStatus,
          cliSessionId: sessionKind === "ephemeral-pi" ? undefined : cliSessionId?.trim() || undefined,
          remoteHistoryConsumerId: sessionKind === "ephemeral-pi" ? undefined : remoteHistoryConsumerId?.trim() || undefined,
          remoteHistorySourceInstanceId: remoteHistorySourceInstanceId?.trim() || undefined,
          ...(transientBackground ? { transientBackground: true as const, tabHidden: true as const } : {}),
        };

        if (startupWrittenBeforeAttach) {
          try { await terminalProcessManager.write(sessionId, formatStartupInputForPty(launchStartupCmd as string, normalizeShellKey(resolvedShell) ?? null)); }
          catch (error) {
            try { await terminalProcessManager.close(sessionId, true); }
            catch (cleanupError) {
              retainPreparedTerminal(get, set, session, () => {});
              throw new TerminalCandidateCleanupError(sessionId, error, cleanupError);
            }
            preparedTerminalSessionIds.delete(sessionId);
            releaseProviderSnapshot(launch.providerSnapshot);
            releaseProjectExtensionSnapshot(launch.extensionSnapshotId);
            throw error;
          }
        }
        let published = false;
        let latestStatus: PtyStatusPayload | undefined;
        let unlisten: UnlistenFn;
        try {
          unlisten = await terminalProcessManager.subscribeStatus(sessionId, (payload) => {
            latestStatus = payload;
            if (!published) return;
            const status = payload.status as SessionStatus;
            logTerminalExitStatus(session, payload);
            set((state) => ({
              sessions: applyPtyStatusToSessions(state.sessions, sessionId, payload),
              sessionStatuses: { ...state.sessionStatuses, [sessionId]: status },
              ...(status === "running" ? {} : buildTabStatusUpdate(state, sessionId, "shell", status === "error" ? "failed" : "done", new Date().toISOString())),
            }));
            persistSshConnectionStateAfterPtyStatus(sessionId, payload);
            if (
              (status === "exited" || status === "error")
            ) {
              releaseRemoteHistoryConsumer(session);
            }
          });
        } catch (error) {
          try { await terminalProcessManager.close(sessionId, true); } catch (cleanupError) {
            retainPreparedTerminal(get, set, session, () => {});
            throw new TerminalCandidateCleanupError(sessionId, error, cleanupError);
          }
          preparedTerminalSessionIds.delete(sessionId);
          releaseProviderSnapshot(launch.providerSnapshot);
          releaseProjectExtensionSnapshot(launch.extensionSnapshotId);
          throw error;
        }

        const publish = () => {
          preparedTerminalSessionIds.delete(sessionId);
          published = true;
        const state = get();
        const projectName = session.projectId
          ? useProjectStore.getState().projects.find((project) => project.id === session.projectId)?.name
          : undefined;
        assignTerminalTitle(session, title, sessionKind === "ephemeral-pi"
          ? "Anonymous Pi"
          : terminalPurpose(resolvedShell, startupCmd === "" ? "" : launchStartupCmd, launch.environmentType, sshHostNameForLaunch(launch)), [...getPendingNamingSessions(), ...useSessionStore.getState().sessions, ...state.sessions], projectName);
        const newSessions = [...state.sessions, session];
        let workspans: TerminalWorkspan[];
        let activeWorkspanId: string | null;
        if (transientBackground) {
          workspans = state.workspans;
          activeWorkspanId = state.activeWorkspanId;
        } else {
          const explicitTargetWorkspan = paneId ? findWorkspanByPane(state.workspans, paneId) : null;
          const targetWorkspan = explicitTargetWorkspan;
          if (targetWorkspan) {
            const paneResult = addSessionToPaneTree(
              targetWorkspan.paneTree,
              explicitTargetWorkspan ? paneId ?? null : targetWorkspan.activePaneId,
              sessionId,
              createPaneId
            );
            workspans = updateTerminalWorkspan(state.workspans, targetWorkspan.id, (workspan) => (
              syncTerminalWorkspanLayout(workspan, paneResult.tree, paneResult.activePaneId, sessionId)
            ));
            activeWorkspanId = targetWorkspan.id;
          } else {
            const workspan = createTerminalWorkspan(createWorkspanId(), createPaneId(), sessionId);
            workspans = [...state.workspans, workspan];
            activeWorkspanId = workspan.id;
          }
        }
        const mirror = transientBackground
          ? { workspans, activeWorkspanId, paneTree: state.paneTree, activePaneId: state.activePaneId, activeSessionId: state.activeSessionId }
          : buildWorkspanMirror(workspans, activeWorkspanId, newSessions);
        set({
          sessions: newSessions,
          ...mirror,
          sessionStatuses: { ...state.sessionStatuses, [sessionId]: (latestStatus?.status as SessionStatus) ?? "running" },
          statusListeners: { ...state.statusListeners, [sessionId]: unlisten },
        });

        };
        const candidate: PreparedTerminalSession = { session, unlisten, publish, launch, releaseReservation: releaseLaunch, getStatus: () => (latestStatus?.status as SessionStatus) ?? "running", activate: () => { preparedTerminalSessionIds.delete(sessionId); published = true; return (latestStatus?.status as SessionStatus) ?? "running"; } };
        if (prepareOnly) { reservationTransferred = true; return candidate; }
        publish();
        const { sessions: newSessions, workspans, activeWorkspanId } = get();
        if (sessionKind !== "ephemeral-pi" && !transientBackground) {
          await persistCommittedLaunch(sessionId, [
            () => queueSshSessionPersistence(newSessions),
            () => useSessionStore.getState().saveActiveSessionId(sessionId),
            () => useSessionStore.getState().saveWorkspans(workspans, activeWorkspanId, newSessions),
          ]);
        }

        if (launch.extensionStatus === "error") {
          toast.warning(translateCurrent("extensions.project.startupFallbackWarning"));
        }

        if (launchStartupCmd && !launch.startupHandledByLaunch && !oneShot && !startupWrittenBeforeAttach) {
          try {
            await terminalProcessManager.write(
              sessionId,
              formatStartupInputForPty(launchStartupCmd, normalizeShellKey(resolvedShell) ?? null),
            );
          } catch (err) {
            toast.error("启动命令写入失败", { description: String(err) });
            logError("Failed to write startup command", {
              sessionId,
              hasStartupCmd: true,
              startupCmdSummary: summarizeStartupCmd(launchStartupCmd),
              err,
            });
            throw err;
          }
        }

        if (ordinaryWorktree) worktreeSessionAdmission.resolve(worktreeId!, admissionToken, sessionId);
        return sessionId;
      } catch (error) {
        if (ordinaryWorktree) worktreeSessionAdmission.reject(worktreeId!, admissionToken, error);
        throw error;
      } finally {
        worktreeSessionAdmission.finish(worktreeId, admissionToken);
        if (!reservationTransferred) releaseLaunch();
      }
  };
  return {
    createSession: (...args: Parameters<TerminalStore["createSession"]>) => execute(false, ...args) as Promise<string>,
    prepareSession: (...args: Parameters<TerminalStore["createSession"]>) => execute(true, ...args) as Promise<PreparedTerminalSession>,
  };
}
