export const TERMINAL_RESOURCE_TARGET_EVENT = "cli-manager:terminal-resource-target";
export function dispatchTerminalResourceTarget(sessionId: string) {
  window.dispatchEvent(new CustomEvent(TERMINAL_RESOURCE_TARGET_EVENT, { detail: { sessionId } }));
}
interface ResourceNavigation {
  exists: (id: string) => boolean;
  currentWorkMode: boolean;
  currentWorkSessionIds: readonly string[];
  activateCurrentWork: (id: string) => void;
  leaveCurrentWork: () => void;
  showTerminal: () => void;
  setActive: (id: string) => void;
}
/** Unlike add/view current-work events, resource inspection may never enroll a terminal. */
export function navigateTerminalResource(sessionId: string, navigation: ResourceNavigation): boolean {
  if (!navigation.exists(sessionId)) return false;
  if (navigation.currentWorkSessionIds.includes(sessionId)) {
    navigation.activateCurrentWork(sessionId);
  } else {
    if (navigation.currentWorkMode) navigation.leaveCurrentWork();
    navigation.showTerminal();
  }
  // Existing store setActive unhides, selects the source workspan and deep pane,
  // and clears incompatible fullscreen. No create/restore/showSessions path.
  navigation.setActive(sessionId);
  return true;
}
