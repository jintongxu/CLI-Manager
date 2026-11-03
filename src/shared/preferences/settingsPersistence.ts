import type { Store } from "@tauri-apps/plugin-store";

/** All writes through settingsStore share this boundary, including legacy auto-saves.
 * It does not coordinate other windows/processes writing the shared settings.json.
 * autoSave: 0 is immediate, NOT disabled: compensation must restore the cache too.
 */
export function createSettingsPersistence(raw: Store) {
  let tail: Promise<unknown> = Promise.resolve();
  // Root failures retain their dedicated retry semantics. Confirmed preference
  // baselines cannot be cleared by a successful root write or root rollback.
  let unsafeCache = false;
  const unresolvedBaselines = new Map<string, unknown>();
  function exclusive<T>(work: (store: Store) => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      // Repair before handing out the raw Store: set/delete may auto-save the
      // whole cache, so even another key's write must wait for this recovery.
      for (const [key, previous] of unresolvedBaselines) {
        if (previous === undefined) await raw.delete(key);
        else await raw.set(key, previous);
        unresolvedBaselines.delete(key);
      }
      return work(raw);
    });
    tail = result.catch(() => {});
    return result;
  }
  function write<T>(work: (store: Store) => Promise<T>): Promise<T> {
    return exclusive((store) => {
      if (unsafeCache) throw new Error("worktree_default_root_cache_unresolved");
      return work(store);
    });
  }
  return {
    entries: () => exclusive(store => store.entries()),
    set: (key: string, value: unknown) => write(store => store.set(key, value)),
    /** Opt-in durable preference write; legacy settings retain their existing semantics. */
    setConfirmed: (key: string, value: unknown) => write(async store => {
      const previous = await store.get<unknown>(key);
      try {
        await store.set(key, value);
        await store.save();
      } catch (error) {
        try {
          if (previous === undefined) await store.delete(key);
          else await store.set(key, previous);
        } catch {
          // Never let a later local writer flush an unconfirmed value.
          unresolvedBaselines.set(key, previous);
        }
        // Best-effort disk compensation (set may already have auto-saved). A
        // restored cache remains safe for later writes if disk is still unwritable.
        if (!unresolvedBaselines.has(key)) {
          try { await store.save(); } catch { /* Preserve the original save error. */ }
        }
        throw error;
      }
    }),
    save: () => write(store => store.save()),
    exclusive,
    markUnsafeCache: (unsafe: boolean) => { unsafeCache = unsafe; },
  };
}
export type SettingsPersistence = ReturnType<typeof createSettingsPersistence>;
