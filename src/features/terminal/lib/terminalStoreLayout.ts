import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { translateCurrent } from "../../../shared/i18n/index";
import type { Project, TerminalSession } from "../../../shared/types/index";
import { logError } from "../../../shared/platform/logger";
import { useSessionStore } from "../api/sessionStore";
import { useFileExplorerStore } from "../../files/api/fileExplorerStore";
import { resolveVisibleTerminalFocus } from "./terminalTabVisibility";
import { type TerminalWorkspan } from "../api/terminalWorkspan";
import { type SplitTerminalOptions, type TerminalStore } from "../types/terminalStoreTypes";

export function buildWorkspanMirror(
  workspans: TerminalWorkspan[],
  requestedActiveWorkspanId: string | null,
  sessions?: TerminalSession[]
): Pick<TerminalStore, "workspans" | "activeWorkspanId" | "paneTree" | "activePaneId" | "activeSessionId"> {
  const focus = sessions ? resolveVisibleTerminalFocus(workspans, requestedActiveWorkspanId, sessions) : null;
  const activeWorkspan = workspans.find((workspan) => workspan.id === (focus ? focus.activeWorkspanId : requestedActiveWorkspanId))
    ?? (focus ? null : workspans[0])
    ?? null;
  return {
    workspans,
    activeWorkspanId: focus ? focus.activeWorkspanId : activeWorkspan?.id ?? null,
    paneTree: activeWorkspan?.paneTree ?? null,
    activePaneId: focus ? focus.activePaneId : activeWorkspan?.activePaneId ?? null,
    activeSessionId: focus ? focus.activeSessionId : activeWorkspan?.activeSessionId ?? null,
  };
}

export function persistWorkspanState(
  workspans: TerminalWorkspan[],
  activeWorkspanId: string | null,
  sessions: TerminalSession[]
) {
  void useSessionStore.getState().saveWorkspans(workspans, activeWorkspanId, sessions).catch((err) => {
    logError("Failed to persist terminal workspans", err);
  });
}

// Committed PTYs must finish startup even when snapshot persistence fails.
export async function persistCommittedLaunch(sessionId: string, steps: Array<() => Promise<void>>) {
  for (const save of steps) {
    try {
      await save();
    } catch (err) {
      toast.error(translateCurrent("saveSession.failed"), { description: String(err) });
      logError("Failed to persist committed terminal launch", { sessionId, err });
    }
  }
}

export function createFileEditorSessionId(projectId: string): string {
  return `file-editor:${projectId}`;
}

export function clearProjectEditorWorkspacesIfUnused(project: Project, sessions: TerminalSession[]): void {
  const stillUsed = sessions.some((session) => (
    session.kind === "file-editor"
    && session.fileEditor?.projectId === project.id
  ));
  if (!stillUsed) useFileExplorerStore.getState().clearProjectEditorWorkspaces(project.id);
}

export function isPersistableSession(session: TerminalSession | undefined): boolean {
  return !!session
    && session.kind !== "subagent-transcript"
    && session.kind !== "file-editor"
    && session.kind !== "synced-history"
    && session.kind !== "ephemeral-pi";
}

export function hasBackendPty(session: TerminalSession): boolean {
  return !session.remoteHandoff
    && session.kind !== "subagent-transcript"
    && session.kind !== "file-editor";
}

export function createSplitSessionTitle(options?: SplitTerminalOptions) {
  return options?.title ?? "Split Terminal";
}

export function releaseRemoteHistoryConsumer(session: TerminalSession | undefined): void {
  if (!session?.sshHostId || !session.remoteHistoryConsumerId) return;
  void invoke("history_remote_close", {
    hostId: session.sshHostId,
    consumerId: session.remoteHistoryConsumerId,
  }).catch(() => undefined);
}
