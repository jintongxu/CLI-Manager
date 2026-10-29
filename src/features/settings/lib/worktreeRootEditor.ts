export interface WorktreeRootEditorState {
  draft: string;
  busy: boolean;
  defaultRoot: string | null;
  error: unknown;
  saved: boolean;
}

/** Draft lifecycle is independent of persistence; failed saves never discard user input. */
export function createWorktreeRootEditor(initial: string, dependencies: {
  save(root: string): Promise<string>;
  pick(): Promise<string | string[] | null>;
  getDefaultRoot(): Promise<string>;
}) {
  let state: WorktreeRootEditorState = { draft: initial, busy: false, defaultRoot: null, error: null, saved: false };
  let confirmed = initial;
  const listeners = new Set<() => void>();
  function patch(values: Partial<WorktreeRootEditorState>) {
    state = { ...state, ...values };
    for (const listener of listeners) listener();
  }
  async function save(root: string) {
    if (state.busy) return;
    // Restore-default is also a draft until durable save succeeds.
    patch({ draft: root, busy: true, error: null, saved: false });
    try {
      confirmed = await dependencies.save(root);
      patch({ draft: confirmed, saved: true });
    } catch (error) {
      patch({ error });
    } finally { patch({ busy: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    sync(root: string) {
      const clean = state.draft === confirmed;
      confirmed = root;
      if (clean && !state.busy) patch({ draft: root });
    },
    edit(draft: string) { if (!state.busy) patch({ draft, error: null, saved: false }); },
    async loadDefault() {
      try { patch({ defaultRoot: await dependencies.getDefaultRoot() }); }
      catch (error) { patch({ error }); }
    },
    async pick() {
      if (state.busy) return;
      patch({ busy: true, error: null, saved: false });
      try {
        const selected = await dependencies.pick();
        if (typeof selected === "string") patch({ draft: selected });
      } catch (error) { patch({ error }); }
      finally { patch({ busy: false }); }
    },
    save: () => save(state.draft),
    restoreDefault: () => save(""),
  };
}
