import type { TerminalSession } from "../../../shared/types/index";
import { visibleTerminalSessionIds } from "./terminalTabVisibility";

/** Presentation eligibility never mutates durable session/layout/PTY owners. */
export function terminalPresentationAllowedIds(
  sessions: TerminalSession[], scope: Set<string> | null,
): Set<string> {
  return visibleTerminalSessionIds(sessions.filter((session) => !session.transientBackground && session.kind !== "file-editor"), scope);
}
