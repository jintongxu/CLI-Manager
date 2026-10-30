import type { TerminalSession } from "../../../shared/types";
import type { BtwSource } from "./btwThreadModel";

/** Exact runtime Pi identity wins. No title/startup-command/cwd heuristics. */
export function resolveBtwSource(terminalId: string | null, sessions: readonly TerminalSession[],
  statuses: Record<string, { agentIdentity?: { source: string; sessionId?: string } } | undefined>): BtwSource {
  const terminal = sessions.find((item) => item.id === terminalId);
  if (!terminal) return { terminalId, sessionId: null, reason: "no_source_session" };
  const identity = terminalId ? statuses[terminalId]?.agentIdentity : undefined;
  // An observed runtime identity (including an incomplete one) must never
  // fall back to a saved identity from an earlier process in the same terminal.
  const sessionId = identity
    ? (identity.source === "pi" ? identity.sessionId?.trim() || null : null)
    : (terminal?.cliTool === "pi" ? terminal.cliSessionId?.trim() || null : null);
  const remote = terminal?.sshHostId || terminal?.remoteHandoff || terminal?.wslDistroName
    || terminal?.environmentType === "wsl" || terminal?.environmentType === "ssh";
  return { terminalId, sessionId, reason: remote ? "remote_source" : !sessionId ? "no_source_session" : null };
}
