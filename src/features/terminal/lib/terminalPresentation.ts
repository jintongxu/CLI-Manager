import type { TerminalSession } from "../../../shared/types/index";
import { visibleTerminalSessionIds } from "./terminalTabVisibility";

/** Presentation membership only: never mutate the durable session/layout/PTY owners. */
export function terminalPresentationAllowedIds(
  sessions: TerminalSession[], scope: Set<string> | null, currentWorkIds: readonly string[], currentWorkMode: boolean,
): Set<string> {
  const members = new Set(currentWorkIds);
  return new Set([...visibleTerminalSessionIds(sessions, scope)]
    .filter((id) => members.has(id) === currentWorkMode));
}
