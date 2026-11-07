export const TERMINAL_RESOURCE_TARGET_EVENT = "cli-manager:terminal-resource-target";
export function dispatchTerminalResourceTarget(sessionId: string) {
  window.dispatchEvent(new CustomEvent(TERMINAL_RESOURCE_TARGET_EVENT, { detail: { sessionId } }));
}
interface ResourceNavigation {
  exists: (id: string) => boolean;
  showTerminal: () => void;
  setActive: (id: string) => void;
}
/** Resource inspection selects the existing canonical owner without creating a session. */
export function navigateTerminalResource(sessionId: string, navigation: ResourceNavigation): boolean {
  if (!navigation.exists(sessionId)) return false;
  navigation.showTerminal();
  // Existing store setActive unhides, selects the source workspan and deep pane,
  // and clears incompatible fullscreen. No create/restore/showSessions path.
  navigation.setActive(sessionId);
  return true;
}
