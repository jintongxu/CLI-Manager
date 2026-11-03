import type { TerminalSession } from "../../../shared/types/index";
import type { TerminalStore, PreparedTerminalSession } from "../types/terminalStoreTypes";
import { terminalProcessManager } from "../api/TerminalProcessManager";
import { createTerminalWorkspan } from "../api/terminalWorkspan";
import { releaseProviderSnapshot, releaseProjectExtensionSnapshot } from "../lib/terminalLaunch";

// Prepared but unpublished PTYs still belong to this window during orphan reconciliation.
export const preparedTerminalSessionIds = new Set<string>();

export class TerminalCandidateCleanupError extends Error {
  constructor(public sessionId: string, public preparationError: unknown, public cleanupError: unknown) {
    super("terminal_recovery_cleanup_failed");
  }
}

/** Last-resort ownership: a failed close must never turn a running PTY into an orphan. */
export function retainPreparedTerminal(get: () => TerminalStore, set: (partial: Partial<TerminalStore>) => void, session: TerminalSession, unlisten: () => void, status: ReturnType<PreparedTerminalSession["getStatus"]> = "error") {
  const state = get();
  preparedTerminalSessionIds.delete(session.id);
  if (state.sessions.some(item => item.id === session.id)) return;
  set({
    sessions: [...state.sessions, { ...session, tabHidden: false, transientBackground: undefined }],
    workspans: [...state.workspans, createTerminalWorkspan(`recovery-${session.id}`, `recovery-pane-${session.id}`, session.id)],
    sessionStatuses: { ...state.sessionStatuses, [session.id]: status },
    statusListeners: { ...state.statusListeners, [session.id]: unlisten },
  });
}

export async function cleanupPreparedTerminal(candidate: PreparedTerminalSession, get: () => TerminalStore, set: (partial: Partial<TerminalStore>) => void, reason: unknown) {
  try { await terminalProcessManager.close(candidate.session.id, true); }
  catch (error) {
    const status = candidate.activate();
    retainPreparedTerminal(get, set, candidate.session, candidate.unlisten, status);
    candidate.releaseReservation();
    throw new TerminalCandidateCleanupError(candidate.session.id, reason, error);
  }
  preparedTerminalSessionIds.delete(candidate.session.id);
  candidate.releaseReservation();
  candidate.unlisten();
  releaseProviderSnapshot(candidate.launch.providerSnapshot);
  releaseProjectExtensionSnapshot(candidate.launch.extensionSnapshotId);
}

export async function closeTerminalSource(session: TerminalSession) {
  await terminalProcessManager.close(session.id, true);
}

/** Post-ACK disposal must not interrupt synchronous publication. */
export function releaseTerminalSource(session: TerminalSession, unlisten?: () => void) {
  try { unlisten?.(); } catch { /* publication remains mandatory */ }
  try { releaseProviderSnapshot(session.providerSnapshot); } catch { /* committed PTY is not retryable */ }
  try { releaseProjectExtensionSnapshot(session.extensionSnapshotId); } catch { /* committed PTY is not retryable */ }
}
