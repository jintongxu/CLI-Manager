import { normalizeExitWithRunningTasksBehavior } from "../../../shared/preferences/exitPolicy.ts";

// Legacy return union keeps App's old background branch compiling until integration.
// Running-task choices take precedence; idle is not proof that a PTY has exited.
export function resolveTerminalExitAction(
  runningCount: number,
  _restoreEnabled: boolean, // Compatibility only: restore never authorizes background exit.
  behavior: "ask" | "background" | "minimize" | "discard",
): "cleanup" | "background" | "minimize" | "discard" | "ask" {
  return runningCount > 0 ? normalizeExitWithRunningTasksBehavior(behavior) : "cleanup";
}

export interface TerminalExitCleanupOptions {
  closePty: boolean;
  closeAllPty: boolean;
  foregroundSessionIds: string[];
  alwaysCloseSessionIds?: string[];
}

export interface TerminalExitCleanupDependencies {
  closeAll: () => Promise<void>;
  close: (sessionId: string) => Promise<void>;
  shutdownDaemonIfIdle: () => Promise<boolean>;
}

export interface TerminalExitCleanupResult {
  canExit: boolean;
  daemonStopped: boolean | null;
  closeAllError: unknown | null;
  foregroundCloseErrors: Array<{ sessionId: string; error: unknown }>;
  shutdownError: unknown | null;
}

export async function cleanupTerminalProcessesForExit(
  options: TerminalExitCleanupOptions,
  dependencies: TerminalExitCleanupDependencies,
): Promise<TerminalExitCleanupResult> {
  const result: TerminalExitCleanupResult = {
    canExit: true,
    daemonStopped: null,
    closeAllError: null,
    foregroundCloseErrors: [],
    shutdownError: null,
  };

  const alwaysCloseSessionIds = [...new Set(options.alwaysCloseSessionIds ?? [])];
  if (!options.closePty && alwaysCloseSessionIds.length === 0) return result;

  if (options.closePty && options.closeAllPty) {
    try {
      await dependencies.closeAll();
    } catch (error) {
      result.closeAllError = error;
    }
  } else {
    const sessionIds = [...new Set([
      ...(options.closePty ? options.foregroundSessionIds : []),
      ...alwaysCloseSessionIds,
    ])];
    for (const sessionId of sessionIds) {
      try {
        await dependencies.close(sessionId);
      } catch (error) {
        result.foregroundCloseErrors.push({ sessionId, error });
      }
    }
  }

  try {
    result.daemonStopped = await dependencies.shutdownDaemonIfIdle();
  } catch (error) {
    result.canExit = false;
    result.shutdownError = error;
  }
  return result;
}
