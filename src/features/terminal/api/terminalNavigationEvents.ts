export interface TerminalSessionTarget {
  sessionId: string;
}

export const TERMINAL_SESSION_TARGET_EVENT = "cli-manager:terminal-session-target";

/** Select an existing session through the canonical terminal navigation owner. */
export function dispatchTerminalSessionTarget(sessionId: string): void {
  window.dispatchEvent(new CustomEvent<TerminalSessionTarget>(TERMINAL_SESSION_TARGET_EVENT, {
    detail: { sessionId },
  }));
}
