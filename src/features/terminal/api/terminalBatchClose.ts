import type { TerminalStore } from "../types/terminalStoreTypes";

/** Default SSH close releases the PTY; explicit hide remains presentation-only. */
export async function closeTerminalTab(
  sessionId: string,
  getState: () => Pick<TerminalStore, "sessions" | "hideSession" | "closeSession">,
  destroy = false,
): Promise<void> {
  const state = getState();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const sshPty = (session.kind ?? "pty") === "pty" && session.environmentType === "ssh";
  if (sshPty) await state.closeSession(sessionId, true);
  else if (destroy) await state.closeSession(sessionId);
  else await state.hideSession(sessionId);
}

export function excludeProtectedSessionIds(
  sessionIds: readonly string[],
  protectedSessionIds: readonly string[],
): string[] {
  const protectedIds = new Set(protectedSessionIds);
  return sessionIds.filter((sessionId) => !protectedIds.has(sessionId));
}

export async function closeTerminalSessions(
  sessionIds: readonly string[],
  protectedSessionIds: readonly string[],
  closeSession: (sessionId: string) => Promise<void>,
  onError: (sessionId: string, error: unknown) => void,
): Promise<void> {
  for (const sessionId of excludeProtectedSessionIds(sessionIds, protectedSessionIds)) {
    try {
      await closeSession(sessionId);
    } catch (error) {
      onError(sessionId, error);
    }
  }
}
