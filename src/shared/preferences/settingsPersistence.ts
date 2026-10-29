import type { Store } from "@tauri-apps/plugin-store";

/** All writes through settingsStore share this boundary, including legacy auto-saves.
 * It does not coordinate other windows/processes writing the shared settings.json.
 * autoSave: 0 is immediate, NOT disabled: compensation must restore the cache too.
 */
export function createSettingsPersistence(raw: Store) {
  let tail: Promise<unknown> = Promise.resolve();
  let unsafeCache = false;
  function exclusive<T>(work: (store: Store) => Promise<T>): Promise<T> {
    const result = tail.then(() => work(raw));
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
    save: () => write(store => store.save()),
    exclusive,
    markUnsafeCache: (unsafe: boolean) => { unsafeCache = unsafe; },
  };
}
export type SettingsPersistence = ReturnType<typeof createSettingsPersistence>;
