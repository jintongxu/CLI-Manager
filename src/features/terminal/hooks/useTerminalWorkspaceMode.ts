import { useCallback, useEffect, useState } from "react";
import type { TerminalSession } from "../../../shared/types/index";
import { useFileExplorerStore } from "../../files/api/fileExplorerStore";
import { useFileCompanionStore } from "../api/fileCompanionState";
import { setFileCompanionFocused } from "../api/fileCompanionFocus";
import { useTerminalStore } from "../state";

export type TerminalWorkspaceTab = "terminal" | "editor" | "history";

interface UseTerminalWorkspaceModeOptions {
  activeSessionId: string | null;
  sessions: TerminalSession[];
  historyOpen: boolean;
  closeHistory: () => void;
  setActive: (sessionId: string) => void;
}

export function useTerminalWorkspaceMode({
  activeSessionId,
  sessions,
  historyOpen,
  closeHistory,
}: UseTerminalWorkspaceModeOptions) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<TerminalWorkspaceTab>("terminal");
  const companionOpen = useFileCompanionStore((state) => state.open);
  const companionMode = useFileCompanionStore((state) => state.mode);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const hasEditorWorkspace = sessions.some((session) => session.kind === "file-editor");
  const historyActive = historyOpen && activeWorkspaceTab === "history";
  const editorActive = companionOpen && companionMode === "current" && !historyActive;

  useEffect(() => {
    if (!historyOpen && activeWorkspaceTab === "history") setActiveWorkspaceTab("terminal");
  }, [activeWorkspaceTab, historyOpen]);

  useEffect(() => {
    if (activeWorkspaceTab === "history") return;
    setActiveWorkspaceTab(companionOpen && companionMode === "current" ? "editor" : "terminal");
  }, [activeWorkspaceTab, companionOpen, companionMode]);

  const switchToTerminalWorkspace = useCallback(() => {
    closeHistory();
    useFileCompanionStore.getState().collapse();
    setFileCompanionFocused(false);
    setActiveWorkspaceTab("terminal");
  }, [closeHistory]);

  const switchToEditorWorkspace = useCallback(() => {
    const projectId = activeSession?.projectId ?? null;
    const editorSession = sessions.find((session) => (
      session.kind === "file-editor"
      && (!projectId || session.fileEditor?.projectId === projectId)
    ));
    const currentProject = useFileExplorerStore.getState().project;
    const project = currentProject && (!projectId || currentProject.id === projectId)
      ? currentProject : editorSession?.fileEditor?.project;
    if (!project) return;
    closeHistory();
    useTerminalStore.getState().openFileEditorPane(project, "current");
    setActiveWorkspaceTab("editor");
  }, [activeSession?.projectId, closeHistory, sessions]);

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
