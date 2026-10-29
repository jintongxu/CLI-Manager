import type { SettingsPersistence } from "./settingsPersistence";

export class WorktreeRootSaveError extends Error {
  constructor(readonly writeError: unknown, readonly rollbackErrors: unknown[]) {
    super(`Worktree root save failed: ${String(writeError)}${rollbackErrors.length
      ? `; rollback failed: ${rollbackErrors.map(String).join("; ")}` : ""}`);
  }
}

/** Display-only normalization. Never persist a fallback over malformed stored data. */
export function loadedWorktreeRoot(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createWorktreeRootSaver(
  getStore: () => Promise<SettingsPersistence>,
  validate: (root: string) => Promise<string>,
  publish: (root: string) => void,
) {
  let pending = false;
  return async (draft: string): Promise<string> => {
    if (pending) throw new Error("worktree_default_root_save_pending");
    pending = true;
    try {
      const root = await validate(draft);
      const persistence = await getStore();
      await persistence.exclusive(async store => {
        // Read the actual cache baseline, not potentially stale React state.
        const previous = await store.get<unknown>("worktreeDefaultRoot");
        try {
          await store.set("worktreeDefaultRoot", root);
          await store.save();
        } catch (writeError) {
          const rollbackErrors: unknown[] = [];
          try {
            if (previous === undefined) await store.delete("worktreeDefaultRoot");
            else await store.set("worktreeDefaultRoot", previous);
            persistence.markUnsafeCache(false);
          } catch (error) {
            // Block later local auto-save writers from flushing a failed draft.
            persistence.markUnsafeCache(true);
            rollbackErrors.push(error);
          }
          if (!rollbackErrors.length) {
            try { await store.save(); } catch (error) { rollbackErrors.push(error); }
          }
          throw new WorktreeRootSaveError(writeError, rollbackErrors);
        }
        persistence.markUnsafeCache(false);
      });
      publish(root);
      return root;
    } finally {
      pending = false;
    }
  };
}
