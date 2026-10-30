import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createExitTransaction, type ExitView, type NativeExitSource } from "./exitTransaction";
import { pauseSessionPersistence, resumeSessionPersistence } from "../features/terminal/api/sessionPersistenceBarrier";
import { saveRestorableExitSnapshot, useSessionStore } from "../features/terminal/api/sessionStore";
import { flushTerminalSnapshotsNow } from "../features/terminal/api/sessionSnapshotPersistence";
import { useTerminalStore } from "../features/terminal/state";
import { suspendChatEditing, flushChatPersistence, resumeChatEditing } from "../features/chat/api/lifecycle";

export function useAppExit(show: () => Promise<void>, backup: () => Promise<void>) {
  const [view, setView] = useState<ExitView>({ phase: null, receipt: null, error: null });
  const callbacks = useRef({ show, backup });
  callbacks.current = { show, backup };
  const controller = useRef<ReturnType<typeof createExitTransaction> | null>(null);
  if (!controller.current) controller.current = createExitTransaction({
    invoke,
    pause: async () => {
      suspendChatEditing();
      await pauseSessionPersistence();
    },
    resume: () => {
      resumeSessionPersistence();
      resumeChatEditing();
    },
    show: () => callbacks.current.show(),
    changed: setView,
    wait: () => new Promise((resolve) => setTimeout(resolve, 250)),
    save: async () => {
      await flushChatPersistence();
      await flushTerminalSnapshotsNow();
      const terminal = useTerminalStore.getState();
      const persisted = useSessionStore.getState();
      await saveRestorableExitSnapshot({
        sessions: terminal.sessions,
        splits: persisted.splits,
        activeSessionId: terminal.activeSessionId,
        workspans: terminal.workspans,
        activeWorkspanId: terminal.activeWorkspanId,
        currentWorkSessionIds: persisted.currentWorkSessionIds,
        currentWorkActiveSessionId: persisted.currentWorkActiveSessionId,
        currentWorkPaneTree: persisted.currentWorkPaneTree,
      });
      await callbacks.current.backup();
    },
  });
  // Deliberately no effect cleanup: React unmount/Fast Refresh is not exit authority.
  return {
    view,
    run: (source: string) => controller.current!.run(
      (source === "native" ? "native" : source.includes("tray") ? "tray" : source.includes("window") ? "window" : "menu") as NativeExitSource,
    ),
    retry: () => controller.current!.retry(),
    resume: () => controller.current!.resume(),
    isActive: () => controller.current!.isActive(),
  };
}
