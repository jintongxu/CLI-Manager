export interface BulkDeleteResult {
  succeeded: string[];
  failed: { id: string; error: unknown }[];
}
export interface HistorySelectionSnapshot {
  scope: string;
  enabled: boolean;
  ids: readonly string[];
  confirmation: readonly string[] | null;
  busy: boolean;
  result: BulkDeleteResult | null;
}

/** Ephemeral history selection. Only captured loaded rows are ever mutation targets. */
export class HistorySelection {
  private state: HistorySelectionSnapshot = {
    scope: "", enabled: false, ids: [], confirmation: null, busy: false, result: null,
  };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private patch(values: Partial<HistorySelectionSnapshot>) {
    this.state = { ...this.state, ...values };
    this.listeners.forEach(listener => listener());
  }
  resetScope(scope: string) {
    if (scope === this.state.scope) return;
    // An admitted operation finishes its original snapshot, never a replacement scope.
    this.patch({ scope, enabled: false, ids: [], confirmation: null, result: null });
  }
  start(scope: string) {
    if (this.state.busy) return;
    this.resetScope(scope);
    this.patch({ enabled: true, ids: [], result: null });
  }
  cancel() {
    if (!this.state.busy) this.patch({ enabled: false, ids: [], confirmation: null, result: null });
  }
  private editable(scope: string) {
    return this.state.scope === scope && this.state.enabled && !this.state.busy && !this.state.confirmation;
  }
  toggle(scope: string, id: string, visible: readonly string[]) {
    if (!this.editable(scope) || !visible.includes(id)) return;
    this.patch({ ids: this.state.ids.includes(id) ? this.state.ids.filter(value => value !== id) : [...this.state.ids, id], result: null });
  }
  selectAll(scope: string, visible: readonly string[]) {
    if (this.editable(scope)) this.patch({ ids: [...new Set(visible)], result: null });
  }
  clear(scope: string) {
    if (this.editable(scope)) this.patch({ ids: [], result: null });
  }
  open(scope: string, visible: readonly string[]) {
    if (!this.editable(scope)) return;
    const ids = this.state.ids.filter(id => visible.includes(id));
    if (ids.length) this.patch({ ids, confirmation: Object.freeze([...ids]), result: null });
  }
  close() {
    if (!this.state.busy) this.patch({ confirmation: null });
  }
  async confirm(scope: string, remove: (id: string) => Promise<void>): Promise<BulkDeleteResult | null> {
    if (this.state.busy || this.state.scope !== scope || !this.state.confirmation) return null;
    const targets = this.state.confirmation;
    // Synchronous admission lock prevents duplicate submits before React rerenders.
    this.patch({ busy: true });
    const result: BulkDeleteResult = { succeeded: [], failed: [] };
    // Sequential, bounded by the captured loaded selection; not an atomic backend batch.
    for (const id of targets) {
      try { await remove(id); result.succeeded.push(id); }
      catch (error) { result.failed.push({ id, error }); }
    }
    const sameScope = this.state.scope === scope;
    this.patch({ busy: false, confirmation: null,
      ids: sameScope ? result.failed.map(item => item.id) : [],
      result: sameScope ? result : null });
    return result;
  }
}
