import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type { TerminalSession, PersistedSplit } from "../../../shared/types/index";
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
  loaded: boolean;

  load: () => Promise<void>;
  saveSessions: (sessions: TerminalSession[]) => Promise<void>;
  saveSplits: (splits: PersistedSplit[]) => Promise<void>;
  saveActiveSessionId: (id: string | null) => Promise<void>;
  saveWorkspans: (workspans: TerminalWorkspan[], activeWorkspanId: string | null, sessions: TerminalSession[]) => Promise<void>;
  saveCurrentWork: (sessionIds: string[], activeSessionId: string | null, sessions: TerminalSession[]) => Promise<void>;
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

    useSessionStore.setState({
      sessions,
      splits,
      activeSessionId: activeSessionId ?? null,
      workspans,
      activeWorkspanId,
      currentWorkSessionIds,
      currentWorkActiveSessionId,
      loaded: true,
    });
  }),

  saveSessions: async (sessions) => {
    const s = await getStore();
    // 伪会话和匿名 Pi 不参与应用重启恢复。
    const persistable = sessions.filter(isPersistableSession);
    await s.set("sessions", persistable);
    await s.save();
    useSessionStore.setState({ sessions: persistable });
  },

  saveSplits: async (splits) => {
    const s = await getStore();
    await s.set("splits", splits);
    useSessionStore.setState({ splits });
  },

  saveActiveSessionId: async (id) => {
    const s = await getStore();
    if (id === null) {
      await s.set("activeSessionId", null);
    } else {
      await s.set("activeSessionId", id);
    }
    useSessionStore.setState({ activeSessionId: id });
  },

  saveWorkspans: async (workspans, activeWorkspanId, sessions) => {
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
  },

  saveCurrentWork: async (sessionIds, activeSessionId, sessions) => {
    const s = await getStore();
    const liveSessionIds = new Set(sessions
      .filter((session) => session.kind !== "subagent-transcript"
        && session.kind !== "file-editor"
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
    await s.set("currentWorkSessionIds", persistableCurrentWorkSessionIds);
    await s.set("currentWorkActiveSessionId", persistableCurrentWorkActiveSessionId);
    await s.save();
    useSessionStore.setState({ currentWorkSessionIds, currentWorkActiveSessionId });
  },

  clear: async () => {
    const s = await getStore();
    await s.set("sessions", []);
    await s.set("splits", []);
    await s.set("activeSessionId", null);
    await s.set("workspans", []);
    await s.set("activeWorkspanId", null);
    await s.set("currentWorkSessionIds", []);
    await s.set("currentWorkActiveSessionId", null);
    useSessionStore.setState({
      sessions: [],
      splits: [],
      activeSessionId: null,
      workspans: [],
      activeWorkspanId: null,
      currentWorkSessionIds: [],
      currentWorkActiveSessionId: null,
    });
  },
}));
