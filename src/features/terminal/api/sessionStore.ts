import { create } from "zustand";
import { queueSessionPersistence } from "./sessionPersistenceBarrier";
import { Store } from "@tauri-apps/plugin-store";
import type { TerminalSession, PersistedSplit } from "../../../shared/types/index";
import type { TerminalPaneNode } from "./terminalPaneTree";
import { sanitizeCurrentWorkPaneTree } from "../lib/currentWorkModel";
import { getCliManagerDataPaths } from "../../../shared/platform/appPaths";
import { singleFlight } from "../../../shared/lib/singleFlight";
import {
  migrateTerminalWorkspans,
  sanitizeTerminalWorkspans,
  type TerminalWorkspan,
} from "./terminalWorkspan";

interface SessionStore {
  sessions: TerminalSession[];
  splits: PersistedSplit[];
  activeSessionId: string | null;
  workspans: TerminalWorkspan[];
  activeWorkspanId: string | null;
  currentWorkSessionIds: string[];
  currentWorkActiveSessionId: string | null;
  currentWorkPaneTree: TerminalPaneNode | null;
  loaded: boolean;

  load: () => Promise<void>;
  saveSessions: (sessions: TerminalSession[]) => Promise<void>;
  saveSplits: (splits: PersistedSplit[]) => Promise<void>;
  saveActiveSessionId: (id: string | null) => Promise<void>;
  saveWorkspans: (workspans: TerminalWorkspan[], activeWorkspanId: string | null, sessions: TerminalSession[]) => Promise<void>;
  saveCurrentWork: (sessionIds: string[], activeSessionId: string | null, sessions: TerminalSession[], paneTree?: TerminalPaneNode | null) => Promise<void>;
  clear: () => Promise<void>;
}

function isPersistableSession(session: TerminalSession): boolean {
  return session.kind !== "subagent-transcript"
    && session.kind !== "file-editor"
    && session.kind !== "synced-history"
    && session.kind !== "ephemeral-pi"
    && session.transientBackground !== true;
}

let store: Store | null = null;
async function getStore() {
  if (!store) {
    const paths = await getCliManagerDataPaths();
    store = await Store.load(paths.sessionsStorePath, { autoSave: 0, defaults: {} });
  }
  return store;
}

export const useSessionStore = create<SessionStore>(() => ({
  sessions: [],
  splits: [],
  activeSessionId: null,
  workspans: [],
  activeWorkspanId: null,
  currentWorkSessionIds: [],
  currentWorkActiveSessionId: null,
  currentWorkPaneTree: null,
  loaded: false,

  load: singleFlight(async () => {
    const s = await getStore();
    const sessions = (await s.get<TerminalSession[]>("sessions")) ?? [];
    const splits = (await s.get<PersistedSplit[]>("splits")) ?? [];
    const activeSessionId = await s.get<string>("activeSessionId");
    const workspans = migrateTerminalWorkspans(await s.get<unknown>("workspans"));
    const storedActiveWorkspanId = await s.get<unknown>("activeWorkspanId");
    const activeWorkspanId = typeof storedActiveWorkspanId === "string"
      && workspans.some((workspan) => workspan.id === storedActiveWorkspanId)
      ? storedActiveWorkspanId
      : null;
    const sessionIds = new Set(sessions.filter(isPersistableSession).map((session) => session.id));
    const storedCurrentWorkSessionIds = await s.get<unknown>("currentWorkSessionIds");
    const currentWorkSessionIds = Array.isArray(storedCurrentWorkSessionIds)
      ? storedCurrentWorkSessionIds.filter((id): id is string => typeof id === "string" && sessionIds.has(id))
      : [];
    const storedCurrentWorkActiveSessionId = await s.get<unknown>("currentWorkActiveSessionId");
    const currentWorkActiveSessionId = typeof storedCurrentWorkActiveSessionId === "string"
      && currentWorkSessionIds.includes(storedCurrentWorkActiveSessionId)
      ? storedCurrentWorkActiveSessionId
      : currentWorkSessionIds[0] ?? null;
    const currentWorkPaneTree = sanitizeCurrentWorkPaneTree(
      await s.get<unknown>("currentWorkPaneTree"),
      new Set(currentWorkSessionIds),
    );

    useSessionStore.setState({
      sessions,
      splits,
      activeSessionId: activeSessionId ?? null,
      workspans,
      activeWorkspanId,
      currentWorkSessionIds,
      currentWorkActiveSessionId,
      currentWorkPaneTree,
      loaded: true,
    });
  }),

  saveSessions: (sessions) => queueSessionPersistence(async () => {
    const s = await getStore();
    // 伪会话和匿名 Pi 不参与应用重启恢复。
    const persistable = sessions.filter(isPersistableSession);
    await s.set("sessions", persistable);
    await s.save();
    useSessionStore.setState({ sessions: persistable });
  }),

  saveSplits: (splits) => queueSessionPersistence(async () => {
    const s = await getStore();
    await s.set("splits", splits);
    useSessionStore.setState({ splits });
  }),

  saveActiveSessionId: (id) => queueSessionPersistence(async () => {
    const s = await getStore();
    if (id === null) {
      await s.set("activeSessionId", null);
    } else {
      await s.set("activeSessionId", id);
    }
    useSessionStore.setState({ activeSessionId: id });
  }),

  saveWorkspans: (workspans, activeWorkspanId, sessions) => queueSessionPersistence(async () => {
    const s = await getStore();
    const validSessionIds = new Set(sessions.filter(isPersistableSession).map((session) => session.id));
    const persistableWorkspans = sanitizeTerminalWorkspans(workspans, validSessionIds);
    const resolvedActiveWorkspanId = activeWorkspanId
      && persistableWorkspans.some((workspan) => workspan.id === activeWorkspanId)
      ? activeWorkspanId
      : persistableWorkspans[0]?.id ?? null;
    await s.set("workspans", persistableWorkspans);
    await s.set("activeWorkspanId", resolvedActiveWorkspanId);
    useSessionStore.setState({
      workspans: persistableWorkspans,
      activeWorkspanId: resolvedActiveWorkspanId,
    });
  }),

  saveCurrentWork: (sessionIds, activeSessionId, sessions, paneTree) => queueSessionPersistence(async () => {
    const s = await getStore();
    const liveSessionIds = new Set(sessions
      .filter((session) => session.kind !== "subagent-transcript"
        && session.kind !== "synced-history"
        && session.transientBackground !== true)
      .map((session) => session.id));
    const currentWorkSessionIds = sessionIds.filter((id, index, ids) => liveSessionIds.has(id) && ids.indexOf(id) === index);
    const currentWorkActiveSessionId = activeSessionId && currentWorkSessionIds.includes(activeSessionId)
      ? activeSessionId
      : currentWorkSessionIds[0] ?? null;
    const persistableCurrentWorkSessionIds = currentWorkSessionIds.filter((id) => {
      const session = sessions.find((item) => item.id === id);
      return session ? isPersistableSession(session) : false;
    });
    const persistableCurrentWorkActiveSessionId = currentWorkActiveSessionId && persistableCurrentWorkSessionIds.includes(currentWorkActiveSessionId)
      ? currentWorkActiveSessionId
      : persistableCurrentWorkSessionIds[0] ?? null;
    const runtimeCurrentWorkPaneTree = sanitizeCurrentWorkPaneTree(
      paneTree ?? useSessionStore.getState().currentWorkPaneTree,
      new Set(currentWorkSessionIds),
    );
    const persistableCurrentWorkPaneTree = sanitizeCurrentWorkPaneTree(
      runtimeCurrentWorkPaneTree,
      new Set(persistableCurrentWorkSessionIds),
    );
    await s.set("currentWorkSessionIds", persistableCurrentWorkSessionIds);
    await s.set("currentWorkActiveSessionId", persistableCurrentWorkActiveSessionId);
    await s.set("currentWorkPaneTree", persistableCurrentWorkPaneTree);
    await s.save();
    useSessionStore.setState({
      currentWorkSessionIds,
      currentWorkActiveSessionId,
      currentWorkPaneTree: runtimeCurrentWorkPaneTree,
    });
  }),

  clear: () => queueSessionPersistence(async () => {
    const s = await getStore();
    await s.set("sessions", []);
    await s.set("splits", []);
    await s.set("activeSessionId", null);
    await s.set("workspans", []);
    await s.set("activeWorkspanId", null);
    await s.set("currentWorkSessionIds", []);
    await s.set("currentWorkActiveSessionId", null);
    await s.set("currentWorkPaneTree", null);
    useSessionStore.setState({
      sessions: [],
      splits: [],
      activeSessionId: null,
      workspans: [],
      activeWorkspanId: null,
      currentWorkSessionIds: [],
      currentWorkActiveSessionId: null,
      currentWorkPaneTree: null,
    });
  }),
}));

/** Explicit exit save bypasses only the automatic-write fence, after its queue drains. */
export async function saveRestorableExitSnapshot(snapshot: Pick<SessionStore,
  "sessions" | "splits" | "activeSessionId" | "workspans" | "activeWorkspanId"
  | "currentWorkSessionIds" | "currentWorkActiveSessionId" | "currentWorkPaneTree"
>): Promise<void> {
  const s = await getStore();
  const sessions = snapshot.sessions.filter(isPersistableSession);
  const ids = new Set(sessions.map((session) => session.id));
  const workspans = sanitizeTerminalWorkspans(snapshot.workspans, ids);
  const currentWorkSessionIds = snapshot.currentWorkSessionIds.filter((id) => ids.has(id));
  const values = {
    ...snapshot, sessions, workspans, currentWorkSessionIds,
    activeSessionId: snapshot.activeSessionId && ids.has(snapshot.activeSessionId) ? snapshot.activeSessionId : null,
    currentWorkActiveSessionId: snapshot.currentWorkActiveSessionId && ids.has(snapshot.currentWorkActiveSessionId)
      ? snapshot.currentWorkActiveSessionId : currentWorkSessionIds[0] ?? null,
    currentWorkPaneTree: sanitizeCurrentWorkPaneTree(snapshot.currentWorkPaneTree, new Set(currentWorkSessionIds)),
  };
  for (const [key, value] of Object.entries(values)) await s.set(key, value);
  await s.save();
  useSessionStore.setState(values);
}
