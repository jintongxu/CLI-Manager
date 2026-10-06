import { validateWorktreeOrder, type WorktreeOrderByProject } from "../lib/worktreeOrder";
import type { WorktreeRecord } from "../types/index";

/** Optimistic, serialized settings writes; callers supply the authoritative loaded membership. */
export function createWorktreeOrderUpdater(
  get: () => WorktreeOrderByProject,
  set: (order: WorktreeOrderByProject) => void,
  save: (order: WorktreeOrderByProject) => Promise<void>,
) {
  let queue: Promise<void> = Promise.resolve();
  let revision = 0;
  let committed: WorktreeOrderByProject | undefined;
  return (projectId: string, orderedIds: string[], worktrees: readonly WorktreeRecord[]): Promise<boolean> => {
    if (!validateWorktreeOrder(projectId, orderedIds, worktrees)) return Promise.resolve(false);
    // Capture external loads when idle; pending optimistic state is not durable state.
    committed ??= get();
    const ids = [...orderedIds];
    const currentRevision = ++revision;
    set({ ...get(), [projectId]: ids });
    const write = queue.then(async () => {
      const next = { ...committed, [projectId]: ids };
      try {
        await save(next);
        committed = next;
        if (revision === currentRevision) set(next);
        return true;
      } catch {
        if (revision === currentRevision) set(committed!);
        return false;
      }
    });
    // Failures settle as false, leaving the serialized queue usable.
    queue = write.then(() => { if (revision === currentRevision) committed = undefined; });
    return write;
  };
}
