import type { TerminalResourceSnapshot } from "../api/terminalResources";
import { terminalResourceError } from "../api/terminalResources";

export interface ResourcePollState {
  snapshot: TerminalResourceSnapshot | null;
  error: string | null;
  loading: boolean;
}
export interface ResourcePollGate { busy: boolean; waiting: Set<() => void> }
// Module lifetime, not effect lifetime: hiding/unmounting never frees a native request.
export const terminalResourcePollGate: ResourcePollGate = { busy: false, waiting: new Set() };

export function createTerminalResourcePoller(
  request: (ids: readonly string[]) => Promise<TerminalResourceSnapshot>,
  changed: (state: ResourcePollState) => void,
  gate = terminalResourcePollGate,
  clock = { setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms), clearInterval: (id: ReturnType<typeof setInterval>) => globalThis.clearInterval(id) },
) {
  let generation = 0;
  let pendingGeneration: number | null = null;
  let enabled = false;
  let ids: readonly string[] = [];
  let identity = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: ResourcePollState = { snapshot: null, error: null, loading: false };
  const publish = (next: ResourcePollState) => { state = next; changed(next); };
  const wake = () => { if (enabled) void refresh(); };
  async function refresh() {
    if (!enabled || !ids.length) return;
    if (gate.busy) {
      if (pendingGeneration !== generation) gate.waiting.add(wake);
      return;
    }
    gate.busy = true;
    const admitted = generation;
    pendingGeneration = admitted;
    const requested = ids;
    publish({ ...state, loading: true });
    try {
      const snapshot = await request(requested);
      if (enabled && admitted === generation) publish({ snapshot, error: null, loading: false });
    } catch (error) {
      if (enabled && admitted === generation) publish({ snapshot: null, error: terminalResourceError(error), loading: false });
    } finally {
      pendingGeneration = null;
      gate.busy = false;
      const waiting = [...gate.waiting];
      gate.waiting.clear();
      waiting.forEach((callback) => callback());
    }
  }
  return {
    configure(active: boolean, sessionIds: readonly string[], incarnation: string) {
      const nextIdentity = JSON.stringify([sessionIds, incarnation]);
      if (enabled === active && identity === nextIdentity) return;
      generation += 1;
      enabled = active;
      ids = [...sessionIds];
      identity = nextIdentity;
      if (timer !== undefined) clock.clearInterval(timer);
      timer = undefined;
      gate.waiting.delete(wake);
      publish({ snapshot: null, error: null, loading: false });
      if (enabled) {
        void refresh();
        timer = clock.setInterval(() => void refresh(), 2500);
      }
    },
    refresh,
    dispose() {
      enabled = false;
      generation += 1;
      if (timer !== undefined) clock.clearInterval(timer);
      timer = undefined;
      gate.waiting.delete(wake);
    },
  };
}
