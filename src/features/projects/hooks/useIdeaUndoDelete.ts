import { useCallback, useEffect, useRef, useState } from "react";

export interface IdeaUndoEntry {
  id: string;
  projectId: string;
}

const UNDO_WINDOW_MS = 6000;

/** 删除后的撤销窗口；组件卸载时清理定时器，避免对已卸载组件 setState。 */
export function useIdeaUndoDelete(restore: (id: string, projectId: string) => Promise<unknown>) {
  const [undoDelete, setUndoDelete] = useState<IdeaUndoEntry | null>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const scheduleUndo = useCallback(
    (entry: IdeaUndoEntry) => {
      clearTimer();
      setUndoDelete(entry);
      timer.current = window.setTimeout(() => {
        setUndoDelete(null);
        timer.current = null;
      }, UNDO_WINDOW_MS);
    },
    [clearTimer],
  );

  const dismissUndo = useCallback(() => {
    clearTimer();
    setUndoDelete(null);
  }, [clearTimer]);

  const undo = useCallback(async () => {
    if (!undoDelete) return;
    const entry = undoDelete;
    clearTimer();
    await restore(entry.id, entry.projectId);
    setUndoDelete(null);
  }, [clearTimer, restore, undoDelete]);

  return { undoDelete, scheduleUndo, dismissUndo, undo };
}
