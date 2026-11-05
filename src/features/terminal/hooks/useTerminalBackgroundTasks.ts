import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TerminalSession } from "../../../shared/types/index";
import type { BackgroundTaskMeta } from "../components/BackgroundTasksPanel";

/** Poll daemon-only tasks independently of the main tab controller. */
export function useTerminalBackgroundTasks(sessions: TerminalSession[]) {
  const [daemonTasks, setDaemonTasks] = useState<BackgroundTaskMeta[]>([]);
  const refreshBackgroundTasks = useCallback(async () => {
    try {
      const tasks = await invoke<BackgroundTaskMeta[]>("pty_daemon_sessions");
      setDaemonTasks(tasks);
    } catch {
      setDaemonTasks([]);
    }
  }, []);

  useEffect(() => {
    void refreshBackgroundTasks();
    const timer = window.setInterval(() => void refreshBackgroundTasks(), 3000);
    return () => window.clearInterval(timer);
  }, [refreshBackgroundTasks]);

  const backgroundTasks = useMemo(() => {
    const openIds = new Set(sessions.map((session) => session.id));
    return daemonTasks.filter((task) => !openIds.has(task.sessionId));
  }, [daemonTasks, sessions]);

  return { backgroundTasks, refreshBackgroundTasks };
}
