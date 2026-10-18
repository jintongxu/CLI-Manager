import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalSession } from "../../../shared/types/index";

export type TerminalWorkspaceTab = "terminal" | "editor" | "history";

interface UseTerminalWorkspaceModeOptions {
  activeSessionId: string | null;
  sessions: TerminalSession[];
  historyOpen: boolean;
  closeHistory: () => void;
  addCurrentWorkSession: (sessionId: string) => void;
  setActive: (sessionId: string) => void;
}

export function useTerminalWorkspaceMode({
  activeSessionId,
  sessions,
  historyOpen,
  closeHistory,
  addCurrentWorkSession,
  setActive,
}: UseTerminalWorkspaceModeOptions) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<TerminalWorkspaceTab>("terminal");
  const lastTerminalSessionIdRef = useRef<string | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const hasEditorWorkspace = sessions.some((session) => session.kind === "file-editor");
  const historyActive = historyOpen && activeWorkspaceTab === "history";
  const editorActive = activeWorkspaceTab === "editor";

  useEffect(() => {
    if (activeSession?.kind === "file-editor") {
      setActiveWorkspaceTab("editor");
      return;
    }
    if (!activeSession) return;
    lastTerminalSessionIdRef.current = activeSession.id;
    if (activeWorkspaceTab === "editor") setActiveWorkspaceTab("terminal");
  }, [activeSession, activeWorkspaceTab]);

  useEffect(() => {
    if (!historyOpen && activeWorkspaceTab === "history") setActiveWorkspaceTab("terminal");
  }, [activeWorkspaceTab, historyOpen]);

  useEffect(() => {
    if (!editorActive || hasEditorWorkspace) return;
    setActiveWorkspaceTab("terminal");
  }, [editorActive, hasEditorWorkspace]);

  const switchToTerminalWorkspace = useCallback(() => {
    closeHistory();
    setActiveWorkspaceTab("terminal");
    const terminalSession = sessions.find((session) => (
      session.id === lastTerminalSessionIdRef.current
      && session.kind !== "file-editor"
    )) ?? sessions.find((session) => session.kind !== "file-editor");
    if (!terminalSession) return;
    addCurrentWorkSession(terminalSession.id);
    setActive(terminalSession.id);
  }, [addCurrentWorkSession, closeHistory, sessions, setActive]);

  const switchToEditorWorkspace = useCallback(() => {
    const projectId = activeSession?.projectId ?? null;
    const editorSession = sessions.find((session) => (
      session.kind === "file-editor"
      && (!projectId || session.fileEditor?.projectId === projectId)
    ));
    if (!editorSession) return;
    closeHistory();
    setActiveWorkspaceTab("editor");
    setActive(editorSession.id);
  }, [activeSession?.projectId, closeHistory, sessions, setActive]);

  return {
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    historyActive,
    editorActive,
    hasEditorWorkspace,
    switchToTerminalWorkspace,
    switchToEditorWorkspace,
  };
}
