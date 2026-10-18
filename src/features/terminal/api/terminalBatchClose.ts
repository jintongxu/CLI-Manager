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
