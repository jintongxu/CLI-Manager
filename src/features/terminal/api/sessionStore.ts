import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type { TerminalSession, PersistedSplit } from "../../../shared/types/index";
import type { TerminalWorkspan } from "./terminalWorkspan";
import { getCliManagerDataPaths } from "../../../shared/platform/appPaths";
import { singleFlight } from "../../../shared/lib/singleFlight";
import { queueSessionPersistence } from "./sessionPersistenceBarrier";
import { canonicalizeTerminalSnapshot, isPersistableTerminalSession, loadCanonicalTerminalSnapshot, repairTerminalLayoutCache, writeTerminalLayoutTransaction } from "./terminalLayoutMigration";

interface SessionStore {
  sessions: TerminalSession[];
  splits: PersistedSplit[];
  activeSessionId: string | null;
  workspans: TerminalWorkspan[];
  activeWorkspanId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  saveSessions: (sessions: TerminalSession[]) => Promise<void>;
  saveSplits: (splits: PersistedSplit[]) => Promise<void>;
  saveActiveSessionId: (id: string | null) => Promise<void>;
  saveWorkspans: (workspans: TerminalWorkspan[], activeWorkspanId: string | null, sessions: TerminalSession[]) => Promise<void>;
  clear: () => Promise<void>;
}

type Snapshot = Pick<SessionStore, "sessions" | "splits" | "activeSessionId" | "workspans" | "activeWorkspanId">;
let store: Store | null = null;
async function getStore() {
  if (!store) {
    const paths = await getCliManagerDataPaths();
    store = await Store.load(paths.sessionsStorePath, { autoSave: 0, defaults: {} });
  }
  await repairTerminalLayoutCache(store);
  return store;
}

const empty = (): Snapshot => ({ sessions: [], splits: [], activeSessionId: null, workspans: [], activeWorkspanId: null });

// Legacy keys belong to migration storage only, never the runtime API/state.
function runtimeSnapshot({ sessions, splits, activeSessionId, workspans, activeWorkspanId }: Snapshot): Snapshot {
  return { sessions, splits, activeSessionId, workspans, activeWorkspanId };
}

export const useSessionStore = create<SessionStore>(() => ({
  ...empty(), loaded: false,
  load: singleFlight(async () => {
    let values: Awaited<ReturnType<typeof loadCanonicalTerminalSnapshot>> | undefined;
    await queueSessionPersistence(async () => { values = await loadCanonicalTerminalSnapshot(await getStore()); });
    if (!values) throw new Error("Session persistence is paused during layout loading");
    useSessionStore.setState({ ...runtimeSnapshot(values), loaded: true });
  }),
  saveSessions: sessions => queueSessionPersistence(async () => {
    const s = await getStore();
    const persistable = sessions.filter(isPersistableTerminalSession);
    await writeTerminalLayoutTransaction(s, { sessions: persistable }, false);
    useSessionStore.setState({ sessions: persistable });
  }),
  saveSplits: splits => queueSessionPersistence(async () => {
    const s = await getStore();
    await writeTerminalLayoutTransaction(s, { splits }, false);
    useSessionStore.setState({ splits });
  }),
  saveActiveSessionId: id => queueSessionPersistence(async () => {
    // Topology owns selection; a delayed session-only callback cannot undo it.
    const state = useSessionStore.getState();
    const activeSessionId = state.workspans.length
      ? canonicalizeTerminalSnapshot({ ...state }).activeSessionId : id;
    await writeTerminalLayoutTransaction(await getStore(), { activeSessionId }, false);
    useSessionStore.setState({ activeSessionId });
  }),
  saveWorkspans: (workspans, activeWorkspanId, sessions) => queueSessionPersistence(async () => {
    const values = await writeRestorableSnapshot(await getStore(), { ...useSessionStore.getState(), sessions, workspans, activeWorkspanId });
    useSessionStore.setState(values);
  }),
  clear: () => queueSessionPersistence(async () => {
    const values = await writeRestorableSnapshot(await getStore(), empty());
    useSessionStore.setState(values);
  }),
}));

/** Explicit exit save bypasses only the automatic-write fence, after its queue drains. */
export async function saveRestorableExitSnapshot(snapshot: Snapshot): Promise<void> {
  useSessionStore.setState(await writeRestorableSnapshot(await getStore(), snapshot));
}

async function writeRestorableSnapshot(s: Store, snapshot: Snapshot) {
  const values = canonicalizeTerminalSnapshot({ ...snapshot });
  await writeTerminalLayoutTransaction(s, { ...values });
  return runtimeSnapshot(values);
}

/** One queued complete transaction, sampled after older writes and async loading. */
export function saveRecoverySnapshot(getTerminal: () => Omit<Snapshot, "splits">): Promise<void> {
  return queueSessionPersistence(async () => {
    const s = await getStore();
    useSessionStore.setState(await writeRestorableSnapshot(s, { ...getTerminal(), splits: [] }));
  });
}
