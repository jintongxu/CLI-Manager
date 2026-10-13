import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../api/sessionStore";
import { useTerminalStore } from "../state";
import { activateCurrentWorkSession, appendCurrentWorkSession, createCurrentWorkLayoutIdFactory } from "../lib/currentWorkModel";
import {
  addSessionToPaneTree,
  collectPaneLeaves,
  createSinglePaneTree,
  findPaneLeaf,
  findPaneLeafBySession,
  moveSessionToPane,
  removeSessionFromPaneTree,
  resizePaneSplit,
  setPaneActiveSession,
  splitExistingSessionToPaneEdge,
  unsplitPaneLeaf,
  type TerminalPaneDropEdge,
  type TerminalPaneNode,
} from "../api/terminalPaneTree";

const createCurrentWorkLayoutId = createCurrentWorkLayoutIdFactory();

function createLayout(sessionIds: string[], activeSessionId: string | null): TerminalPaneNode | null {
  return sessionIds.length ? createSinglePaneTree(sessionIds, activeSessionId, createCurrentWorkLayoutId) : null;
}

function reconcileLayout(
  tree: TerminalPaneNode | null,
  sessionIds: string[],
  activeSessionId: string | null,
  activePaneId: string | null,
): { tree: TerminalPaneNode | null; activePaneId: string | null } {
  let nextTree = tree;
  const validIds = new Set(sessionIds);
  for (const pane of collectPaneLeaves(nextTree)) {
    for (const sessionId of pane.sessionIds) {
      if (!validIds.has(sessionId)) nextTree = removeSessionFromPaneTree(nextTree, sessionId);
    }
  }
  const existingIds = new Set(collectPaneLeaves(nextTree).flatMap((pane) => pane.sessionIds));
  for (const sessionId of sessionIds) {
    if (existingIds.has(sessionId)) continue;
    const added = addSessionToPaneTree(nextTree, activePaneId, sessionId, createCurrentWorkLayoutId);
    nextTree = added.tree;
    activePaneId = added.activePaneId;
    existingIds.add(sessionId);
  }
  if (!nextTree) nextTree = createLayout(sessionIds, activeSessionId);
  const activated = activeSessionId ? setPaneActiveSession(nextTree, activeSessionId) : null;
  if (activated?.activePaneId) {
    nextTree = activated.tree;
    activePaneId = activated.activePaneId;
  }
  const leaves = collectPaneLeaves(nextTree);
  if (!activePaneId || !findPaneLeaf(nextTree, activePaneId)) activePaneId = leaves[0]?.id ?? null;
  return { tree: nextTree, activePaneId };
}

interface CurrentWorkSessionControllerOptions {
  sessionStoreLoaded: boolean;
  persistedSessionIds: string[];
  persistedActiveSessionId: string | null;
  persistedPaneTree: TerminalPaneNode | null;
}

export function useCurrentWorkSessionController({
  sessionStoreLoaded,
  persistedSessionIds,
  persistedActiveSessionId,
  persistedPaneTree,
}: CurrentWorkSessionControllerOptions) {
  const saveCurrentWork = useSessionStore((state) => state.saveCurrentWork);
  const initialTree = persistedPaneTree ?? createLayout(persistedSessionIds, persistedActiveSessionId);
  const [currentWorkMode, setCurrentWorkMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [sessionIds, setSessionIds] = useState(persistedSessionIds);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(persistedActiveSessionId);
  const [paneTree, setPaneTree] = useState<TerminalPaneNode | null>(initialTree);
  const [activePaneId, setActivePaneId] = useState<string | null>(() => findPaneLeafBySession(initialTree, persistedActiveSessionId ?? "")?.id ?? collectPaneLeaves(initialTree)[0]?.id ?? null);
  const [fullscreenPaneId, setFullscreenPaneId] = useState<string | null>(null);
  const sessionIdsRef = useRef(sessionIds);
  const activeSessionIdRef = useRef(activeSessionId);
  const paneTreeRef = useRef(paneTree);
  const activePaneIdRef = useRef(activePaneId);

  const persist = useCallback((nextIds: string[], nextActiveId: string | null) => {
    if (!sessionStoreLoaded) return;
    void saveCurrentWork(nextIds, nextActiveId, useTerminalStore.getState().sessions, paneTreeRef.current);
  }, [saveCurrentWork, sessionStoreLoaded]);
  const commitLayout = useCallback((tree: TerminalPaneNode | null, paneId: string | null) => {
    paneTreeRef.current = tree;
    activePaneIdRef.current = paneId;
    setPaneTree(tree);
    setActivePaneId(paneId);
  }, []);

  useEffect(() => {
    if (!sessionStoreLoaded) return;
    const membershipChanged = persistedSessionIds.length !== sessionIdsRef.current.length
      || persistedSessionIds.some((sessionId, index) => sessionId !== sessionIdsRef.current[index]);
    const baseTree = membershipChanged && persistedPaneTree ? persistedPaneTree : paneTreeRef.current;
    sessionIdsRef.current = persistedSessionIds;
    activeSessionIdRef.current = persistedActiveSessionId;
    setSessionIds(persistedSessionIds);
    setActiveSessionId(persistedActiveSessionId);
    const reconciled = reconcileLayout(baseTree, persistedSessionIds, persistedActiveSessionId, activePaneIdRef.current);
    commitLayout(reconciled.tree, reconciled.activePaneId);
  }, [commitLayout, persistedActiveSessionId, persistedPaneTree, persistedSessionIds, sessionStoreLoaded]);
  useEffect(() => {
    if (activeSessionId && sessionIds.includes(activeSessionId)) return;
    const nextActiveId = sessionIds[0] ?? null;
    activeSessionIdRef.current = nextActiveId;
    setActiveSessionId(nextActiveId);
  }, [activeSessionId, sessionIds]);

  const updateMembership = useCallback((nextIds: string[], nextActiveId: string | null) => {
    sessionIdsRef.current = nextIds;
    activeSessionIdRef.current = nextActiveId;
    setSessionIds(nextIds);
    setActiveSessionId(nextActiveId);
    const reconciled = reconcileLayout(paneTreeRef.current, nextIds, nextActiveId, activePaneIdRef.current);
    commitLayout(reconciled.tree, reconciled.activePaneId);
    persist(nextIds, nextActiveId);
  }, [commitLayout, persist]);
  const addSession = useCallback((sessionId: string) => {
    const currentIds = sessionIdsRef.current;
    if (!currentWorkMode || currentIds.includes(sessionId)) return;
    const next = appendCurrentWorkSession(currentIds, activeSessionIdRef.current, sessionId);
    updateMembership(next.sessionIds, next.activeSessionId);
  }, [currentWorkMode, updateMembership]);
  const activateSession = useCallback((sessionId: string) => {
    const next = activateCurrentWorkSession(sessionIdsRef.current, sessionId);
    updateMembership(next.sessionIds, next.activeSessionId);
    return true;
  }, [updateMembership]);
  const removeSessions = useCallback((ids: readonly string[]) => {
    const remove = new Set(ids);
    const nextIds = sessionIdsRef.current.filter((id) => !remove.has(id));
    const nextActiveId = nextIds.includes(activeSessionIdRef.current ?? "") ? activeSessionIdRef.current : nextIds[0] ?? null;
    setSelectedSessionIds(new Set());
    updateMembership(nextIds, nextActiveId);
  }, [updateMembership]);
  const toggleSession = useCallback((sessionId: string) => {
    if (sessionIdsRef.current.includes(sessionId)) {
      removeSessions([sessionId]);
      return;
    }
    const next = appendCurrentWorkSession(sessionIdsRef.current, activeSessionIdRef.current, sessionId);
    updateMembership(next.sessionIds, next.activeSessionId);
  }, [removeSessions, updateMembership]);
  const reorder = useCallback((fromId: string, toId: string) => {
    const nextIds = [...sessionIdsRef.current];
    const fromIndex = nextIds.indexOf(fromId);
    const toIndex = nextIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved);
    sessionIdsRef.current = nextIds;
    setSessionIds(nextIds);
    persist(nextIds, activeSessionIdRef.current);
  }, [persist]);
  const splitSessionToEdge = useCallback((sessionId: string, targetPaneId: string, edge: TerminalPaneDropEdge) => {
    const result = splitExistingSessionToPaneEdge(paneTreeRef.current, sessionId, targetPaneId, edge, createCurrentWorkLayoutId);
    if (!result.changed) return false;
    commitLayout(result.tree, result.activePaneId);
    activeSessionIdRef.current = result.activeSessionId;
    setActiveSessionId(result.activeSessionId);
    if (result.activeSessionId) useTerminalStore.getState().setActive(result.activeSessionId);
    persist(sessionIdsRef.current, result.activeSessionId);
    return true;
  }, [commitLayout, persist]);
  const moveSession = useCallback((sessionId: string, targetPaneId: string) => {
    const sourcePane = findPaneLeafBySession(paneTreeRef.current, sessionId);
    if (!sourcePane || sourcePane.id === targetPaneId) return false;
    const result = moveSessionToPane(paneTreeRef.current, sourcePane.id, targetPaneId, sessionId);
    commitLayout(result.tree, result.activePaneId);
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    useTerminalStore.getState().setActive(sessionId);
    persist(sessionIdsRef.current, sessionId);
    return true;
  }, [commitLayout, persist]);
  const unsplitPane = useCallback((paneId: string) => {
    const result = unsplitPaneLeaf(paneTreeRef.current, paneId, "merge");
    commitLayout(result.tree, result.activePaneId);
    setFullscreenPaneId(null);
    activeSessionIdRef.current = result.activeSessionId;
    setActiveSessionId(result.activeSessionId);
    if (result.activeSessionId) useTerminalStore.getState().setActive(result.activeSessionId);
    persist(sessionIdsRef.current, result.activeSessionId);
  }, [commitLayout, persist]);
  const toggleFullscreen = useCallback((paneId: string) => {
    setFullscreenPaneId((current) => current === paneId ? null : paneId);
  }, []);
  const setSplitRatio = useCallback((splitId: string, ratio: number) => {
    commitLayout(resizePaneSplit(paneTreeRef.current, splitId, ratio), activePaneIdRef.current);
    persist(sessionIdsRef.current, activeSessionIdRef.current);
  }, [commitLayout, persist]);
  const canSplitSessionToEdge = useCallback((sessionId: string, targetPaneId: string) => {
    const sourcePane = findPaneLeafBySession(paneTreeRef.current, sessionId);
    const targetPane = findPaneLeaf(paneTreeRef.current, targetPaneId);
    return Boolean(sourcePane && targetPane && (sourcePane.id !== targetPane.id || sourcePane.sessionIds.length > 1));
  }, []);
  const toggleSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((selected) => {
      const next = new Set(selected);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    removeSessions(selectedSessionIds.size ? [...selectedSessionIds] : sessionIdsRef.current);
  }, [removeSessions, selectedSessionIds]);
  useEffect(() => {
    if (fullscreenPaneId && !findPaneLeaf(paneTree, fullscreenPaneId)) setFullscreenPaneId(null);
  }, [fullscreenPaneId, paneTree]);
  useEffect(() => {
    setSelectedSessionIds((selected) => {
      const next = new Set([...selected].filter((id) => sessionIds.includes(id)));
      return next.size === selected.size ? selected : next;
    });
  }, [sessionIds]);

  return {
    currentWorkMode, setCurrentWorkMode,
    currentWorkSessionIds: sessionIds,
    currentWorkActiveSessionId: activeSessionId,
    setCurrentWorkActiveSessionId: setActiveSessionId,
    currentWorkPaneTree: paneTree,
    currentWorkActivePaneId: activePaneId,
    currentWorkFullscreenPaneId: fullscreenPaneId,
    selectedCurrentWorkSessionIds: selectedSessionIds,
    addCurrentWorkSession: addSession,
    activateCurrentWorkSession: activateSession,
    removeCurrentWorkSessions: removeSessions,
    toggleCurrentWork: toggleSession,
    toggleCurrentWorkSelection: toggleSelection,
    reorderCurrentWork: reorder,
    splitCurrentWorkSessionToPaneEdge: splitSessionToEdge,
    moveCurrentWorkSessionToPane: moveSession,
    unsplitCurrentWorkPane: unsplitPane,
    toggleCurrentWorkPaneFullscreen: toggleFullscreen,
    setCurrentWorkSplitRatio: setSplitRatio,
    canSplitCurrentWorkSessionToPaneEdge: canSplitSessionToEdge,
    clearCurrentWork: clear,
    persistCurrentWork: persist,
    currentWorkSessionIdsRef: sessionIdsRef,
    currentWorkActiveSessionIdRef: activeSessionIdRef,
  };
}
