import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { TerminalSession } from "../../../shared/types";

import { hasPendingTerminalWrites, isTerminalSnapshotParserSafe } from "../../../shared/lib/terminalHistoricalParser";
import { serializeTerminalContinuationImage, serializeTerminalContinuationModes } from "../../../shared/lib/terminalContinuationModes";

export const TERMINAL_SNAPSHOT_SCROLLBACK = 2000;
export type TerminalSnapshotSize = NonNullable<TerminalSession["initialTerminalSize"]>;
export interface TerminalSnapshotCapture {
  text: string;
  /** Renderer committed prefix sampled at the image barrier. */
  sequence?: number;
  size: TerminalSnapshotSize;
  /** Full daemon checkpoint, not the local bounded scrollback image. */
  checkpointText: string;
}

export function isTerminalSnapshotSize(size: unknown): size is TerminalSnapshotSize {
  if (!size || typeof size !== "object") return false;
  const candidate = size as Partial<TerminalSnapshotSize>;
  return Number.isSafeInteger(candidate.cols) && Number.isSafeInteger(candidate.rows)
    && (candidate.cols ?? 0) > 0 && (candidate.rows ?? 0) > 0;
}

/** Call synchronously at a write barrier: both images and geometry describe one state.
 * SerializeAddon rebuilds leading cell attributes for the selected scrollback range;
 * substring trimming ANSI after serialization cannot preserve that invariant.
 */
export function captureTerminalSnapshot(terminal: Terminal, addon: SerializeAddon, includeCheckpoint = true, sequence?: number): TerminalSnapshotCapture {
  if (sequence !== undefined && (hasPendingTerminalWrites(terminal) || !isTerminalSnapshotParserSafe(terminal))) {
    throw new Error("Cannot capture a continuation baseline outside a committed VT ground boundary");
  }
  const size = { cols: terminal.cols, rows: terminal.rows };
  const modes = serializeTerminalContinuationModes(terminal);
  const serialize = (options?: { scrollback: number }) => modes.before
    + serializeTerminalContinuationImage(terminal, addon, options) + modes.after;
  return {
    text: serialize({ scrollback: TERMINAL_SNAPSHOT_SCROLLBACK }),
    checkpointText: includeCheckpoint ? serialize() : "",
    size,
    sequence,
  };
}

/** The caller owns the historical-resize fence so this resize never reaches a PTY. */
export function restoreTerminalSnapshotSize(terminal: Terminal, size: unknown): boolean {
  if (!isTerminalSnapshotSize(size)) return false;
  if (terminal.cols !== size.cols || terminal.rows !== size.rows) terminal.resize(size.cols, size.rows);
  return true;
}
