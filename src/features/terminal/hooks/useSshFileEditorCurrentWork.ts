import { useEffect } from "react";
import type { TerminalSession } from "../../../shared/types/index";

interface Options {
  activeSessionId: string | null;
  addCurrentWorkSession: (sessionId: string) => void;
  currentWorkMode: boolean;
  currentWorkSessionIds: readonly string[];
  sessions: TerminalSession[];
}

/** Keeps the source SSH terminal in current work when its file editor is active. */
export function useSshFileEditorCurrentWork({
  activeSessionId,
  addCurrentWorkSession,
  currentWorkMode,
  currentWorkSessionIds,
  sessions,
}: Options): void {
  useEffect(() => {
    if (!currentWorkMode) return;
    const editorSession = sessions.find((session) => session.id === activeSessionId);
    if (editorSession?.kind !== "file-editor") return;
    const editorProject = editorSession.fileEditor?.project;
    if (editorProject?.environment_type !== "ssh") return;
    if (!currentWorkSessionIds.includes(editorSession.id)) addCurrentWorkSession(editorSession.id);
    const editorProjectId = editorSession.fileEditor?.projectId;
    const editorHostId = editorProject.ssh_host_id?.trim();
    const editorRemotePath = editorProject.remote_path.trim().replace(/[\\/]+$/u, "");
    const sourceSession = sessions.find((session) => {
      if (session.kind === "file-editor" || session.environmentType !== "ssh" || session.tabHidden) return false;
      if (editorProjectId && session.projectId === editorProjectId) return true;
      const sessionRemotePath = session.remotePath?.trim().replace(/[\\/]+$/u, "");
      return Boolean(editorHostId && session.sshHostId === editorHostId && sessionRemotePath === editorRemotePath);
    });
    if (sourceSession && !currentWorkSessionIds.includes(sourceSession.id)) {
      addCurrentWorkSession(sourceSession.id);
    }
  }, [activeSessionId, addCurrentWorkSession, currentWorkMode, currentWorkSessionIds, sessions]);
}
