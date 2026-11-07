import type { TerminalSession } from "../../../shared/types/index";
import { sanitizeCurrentWorkPaneTree } from "../lib/currentWorkModel";
import { collectPaneLeaves, createPaneLeaf, type TerminalPaneNode } from "./terminalPaneTree";
import { collectWorkspanSessionIds, migrateTerminalWorkspans, sanitizeTerminalWorkspans, type TerminalWorkspan } from "./terminalWorkspan";

export const TERMINAL_LAYOUT_VERSION = 1;
export const TERMINAL_LAYOUT_KEYS = ["sessions", "splits", "activeSessionId", "workspans", "activeWorkspanId", "currentWorkSessionIds", "currentWorkActiveSessionId", "currentWorkPaneTree"] as const;

export function isPersistableTerminalSession(value: unknown): value is TerminalSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as TerminalSession;
  if (typeof session.id !== "string" || !session.id.trim()) return false;
  return !["subagent-transcript", "file-editor", "synced-history", "ephemeral-pi"].includes(session.kind ?? "")
    && session.transientBackground !== true;
}

export interface CanonicalTerminalSnapshot {
  sessions: TerminalSession[];
  splits: [];
  activeSessionId: string | null;
  workspans: TerminalWorkspan[];
  activeWorkspanId: string | null;
  currentWorkSessionIds: string[];
  currentWorkActiveSessionId: null;
  currentWorkPaneTree: null;
}

/** Pure metadata conversion: never launches, closes, unhides or materializes a session. */
export function canonicalizeTerminalSnapshot(raw: Record<string, unknown>, importLegacy = false): CanonicalTerminalSnapshot {
  const seen = new Set<string>();
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(isPersistableTerminalSession)
    .filter(session => { if (seen.has(session.id)) return false; seen.add(session.id); return true; });
  const ids = new Set(sessions.map(session => session.id));
  // Resolve from the requested leaf, not a stale span/global session selector.
  const requestedSpans = Array.isArray(raw.workspans) ? raw.workspans.map(value => {
    if (!value || typeof value !== "object") return value;
    const span = value as TerminalWorkspan;
    const tree = migrateTerminalWorkspans([{ ...span, activeSessionId: null }])[0]?.paneTree ?? null;
    const active = collectPaneLeaves(tree).find(pane => pane.id === span.activePaneId);
    return active ? { ...span, activeSessionId: active.activeSessionId } : span;
  }) : [];
  let ordinary = migrateTerminalWorkspans(requestedSpans);
  let promoted: TerminalWorkspan | null = null;
  const workspanIds = new Set(ordinary.map(span => span.id));
  const unique = (base: string, used: Set<string>) => {
    let id = base;
    for (let i = 1; used.has(id); i++) id = `${base}:${i}`;
    used.add(id);
    return id;
  };
  if (importLegacy) {
    // Valid tree members also survive malformed/incomplete legacy membership arrays.
    let tree = sanitizeCurrentWorkPaneTree(raw.currentWorkPaneTree, ids);
    const assigned = new Set(collectPaneLeaves(tree).flatMap(pane => pane.sessionIds));
    const members = Array.isArray(raw.currentWorkSessionIds)
      ? [...new Set(raw.currentWorkSessionIds.filter((id): id is string => typeof id === "string" && ids.has(id)))] : [];
    const missing = members.filter(id => !assigned.has(id));
    if (!tree && missing.length) tree = createPaneLeaf("migrated-current-work-pane", missing, typeof raw.currentWorkActiveSessionId === "string" ? raw.currentWorkActiveSessionId : null);
    else if (tree && missing.length) {
      // Append without changing any existing leaf's active tab.
      const append = (node: TerminalPaneNode): TerminalPaneNode => node.type === "leaf"
        ? { ...node, sessionIds: [...node.sessionIds, ...missing] }
        : { ...node, first: append(node.first) };
      tree = append(tree);
    }
    if (tree) {
      const leaves = collectPaneLeaves(tree);
      const active = typeof raw.currentWorkActiveSessionId === "string"
        && leaves.some(pane => pane.sessionIds.includes(raw.currentWorkActiveSessionId as string))
        ? raw.currentWorkActiveSessionId : leaves[0].activeSessionId;
      promoted = { id: unique("migrated-current-work", workspanIds), customTitle: null, paneTree: tree,
        activePaneId: leaves.find(pane => pane.sessionIds.includes(active!))?.id ?? leaves[0].id, activeSessionId: active };
    }
  }
  // First owner wins: the promoted geometry wins overlaps; residual trees keep their ratios.
  ordinary = sanitizeTerminalWorkspans(promoted ? [promoted, ...ordinary] : ordinary, ids);
  const assigned = new Set(ordinary.flatMap(collectWorkspanSessionIds));
  for (const session of sessions) {
    if (assigned.has(session.id)) continue;
    const id = unique(`restored:${session.id}`, workspanIds);
    ordinary.push({ id, customTitle: null, paneTree: createPaneLeaf(`${id}:pane`, [session.id], session.id), activePaneId: `${id}:pane`, activeSessionId: session.id });
    assigned.add(session.id);
  }
  // Pane IDs are global DOM/layout keys, including across legacy trees.
  const nodeIds = new Set<string>();
  const rekey = (node: TerminalPaneNode): TerminalPaneNode => {
    const id = unique(node.id, nodeIds);
    return node.type === "leaf" ? { ...node, id } : { ...node, id, first: rekey(node.first), second: rekey(node.second) };
  };
  const workspans = ordinary.map(span => {
    const oldLeaves = collectPaneLeaves(span.paneTree);
    const selectedIndex = Math.max(0, oldLeaves.findIndex(pane => pane.id === span.activePaneId));
    const paneTree = rekey(span.paneTree!);
    const selected = collectPaneLeaves(paneTree)[selectedIndex];
    return { ...span, paneTree, activePaneId: selected?.id ?? null, activeSessionId: selected?.activeSessionId ?? null };
  });
  const requestedSessionId = promoted?.activeSessionId ?? (typeof raw.activeSessionId === "string" && ids.has(raw.activeSessionId) ? raw.activeSessionId : null);
  const activeWorkspanId = promoted?.id ?? (typeof raw.activeWorkspanId === "string" && workspans.some(span => span.id === raw.activeWorkspanId)
    ? raw.activeWorkspanId : workspans.find(span => collectWorkspanSessionIds(span).includes(requestedSessionId!))?.id ?? workspans[0]?.id ?? null);
  const activeSessionId = workspans.find(span => span.id === activeWorkspanId)?.activeSessionId ?? null;
  return { sessions, splits: [], activeSessionId, workspans, activeWorkspanId,
    currentWorkSessionIds: [], currentWorkActiveSessionId: null, currentWorkPaneTree: null };
}

interface LayoutStorage {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown): Promise<unknown>;
  save(): Promise<unknown>;
}

/** Caller must serialize this with all session writes. Marker follows a successful full save. */
export async function loadCanonicalTerminalSnapshot(store: LayoutStorage): Promise<CanonicalTerminalSnapshot> {
  await repairTerminalLayoutCache(store);
  const raw: Record<string, unknown> = {};
  for (const key of TERMINAL_LAYOUT_KEYS) raw[key] = await store.get(key) ?? null;
  const version = await store.get<number>("terminalLayoutVersion");
  if (version != null && version > TERMINAL_LAYOUT_VERSION) throw new Error(`Unsupported terminal layout version: ${version}`);
  const snapshot = canonicalizeTerminalSnapshot(raw, version !== TERMINAL_LAYOUT_VERSION);
  // Already-versioned files are still untrusted; preserve rejected records before
  // any subsequent complete save can replace the original sessions array.
  const recordsRejected = Array.isArray(raw.sessions) && raw.sessions.length !== snapshot.sessions.length;
  if (version === TERMINAL_LAYOUT_VERSION && !recordsRejected) return snapshot;
  const backup = await store.get("terminalLayoutMigrationBackup");
  await writeTerminalLayoutTransaction(store, {
    ...(backup == null ? { terminalLayoutMigrationBackup: raw } : {}), ...snapshot,
  });
  return snapshot;
}

// A failed cache repair fences every subsequent writer until repair succeeds.
const pendingRepairs = new WeakMap<LayoutStorage, Record<string, unknown>>();
export async function repairTerminalLayoutCache(store: LayoutStorage): Promise<void> {
  const pending = pendingRepairs.get(store);
  if (!pending) return;
  for (const [key, value] of Object.entries(pending)) await store.set(key, value);
  pendingRepairs.delete(store);
}

/** Both saves are observable; rollback never saves a success marker after failure. */
export async function writeTerminalLayoutTransaction(store: LayoutStorage, values: Record<string, unknown>, complete = true): Promise<void> {
  await repairTerminalLayoutCache(store);
  const original: Record<string, unknown> = {};
  for (const key of [...Object.keys(values), ...(complete ? ["terminalLayoutVersion"] : [])]) {
    original[key] = await store.get(key) ?? null;
  }
  try {
    for (const [key, value] of Object.entries(values)) await store.set(key, value);
    await store.save();
    if (complete) {
      await store.set("terminalLayoutVersion", TERMINAL_LAYOUT_VERSION);
      await store.save();
    }
  } catch (error) {
    // Keep a newly established original-data backup even if only the cache saw it.
    delete original.terminalLayoutMigrationBackup;
    pendingRepairs.set(store, original);
    try { await repairTerminalLayoutCache(store); } catch { /* next writer must retry repair */ }
    throw error;
  }
}
