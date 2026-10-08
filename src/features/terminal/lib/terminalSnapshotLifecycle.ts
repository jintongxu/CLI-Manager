import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { hasPendingTerminalWrites, isTerminalSnapshotParserSafe } from "../../../shared/lib/terminalHistoricalParser";
import { captureTerminalSnapshot, type TerminalSnapshotCapture } from "./terminalSnapshotCapture";
import { registerTerminalSnapshotSource, markTerminalSnapshotDirty } from "../api/sessionSnapshotPersistence";
import { terminalProcessManager } from "../api/TerminalProcessManager";
import { useTerminalStore } from "../state";

/** Owns one mounted display's captures. Parsed events only mark dirty; expensive
 * serialization belongs to persistence/unmount barriers, never the output hot path.
 * Disposal resolves pending captures with the last whole committed image and cannot
 * overwrite a replacement registration. An unfinished async parse is not an image.
 */
export function createTerminalSnapshotLifecycle(sessionId: string, terminal: Terminal, addon: SerializeAddon, isHydrated: () => boolean = () => true, isNormalizerSafe: () => boolean = () => true) {
  let disposed = false;
  let dirty = false;
  let committed = captureTerminalSnapshot(terminal, addon, false);
  const pending = new Set<(capture: TerminalSnapshotCapture) => void>();
  let barrierQueued = false;
  const captureCommitted = (includeCheckpoint = false) => {
    // A drained FIFO is not a VT boundary. Keep the last safe image/sequence;
    // daemon replay retains the raw suffix, including unfinished escapes. Never
    // wait for another frame here: an exit may leave that escape incomplete forever.
    if (!isTerminalSnapshotParserSafe(terminal) || !isNormalizerSafe()) return committed;
    if (dirty || committed.sequence !== (isHydrated() ? terminalProcessManager.getCommittedSequence(sessionId) : undefined)
      || (includeCheckpoint && !committed.checkpointText)) {
      committed = captureTerminalSnapshot(terminal, addon, includeCheckpoint, isHydrated() ? terminalProcessManager.getCommittedSequence(sessionId) : undefined);
      dirty = false;
    }
    return committed;
  };
  const markDirty = () => {
    dirty = true;
    markTerminalSnapshotDirty(sessionId);
  };
  const parsed = terminal.onWriteParsed(markDirty);
  const resized = terminal.onResize(markDirty);
  const queueBarrier = () => {
    if (disposed || barrierQueued || !pending.size) return;
    barrierQueued = true;
    terminal.write("", () => queueMicrotask(() => {
      // The origin adapter commits in a microtask after xterm advances its offset.
      // A later chunk can already be paused in an async handler by then. Retry at
      // the next real parser barrier, not by timer or by guessing completion time.
      barrierQueued = false;
      if (disposed) return;
      if (hasPendingTerminalWrites(terminal)) { queueBarrier(); return; }
      const capture = captureCommitted(true);
      for (const resolve of pending) resolve(capture);
      pending.clear();
    }));
  };
  const unregister = registerTerminalSnapshotSource(sessionId, () => new Promise<TerminalSnapshotCapture>((resolve) => {
    if (disposed) { resolve(committed); return; }
    pending.add(resolve);
    queueBarrier();
  }), async (serialized, capture) => {
    if (disposed || !capture || capture.sequence === undefined || !serialized) return;
    await terminalProcessManager.checkpoint(sessionId, capture.size.cols, capture.size.rows, serialized, capture.sequence);
  });
  return {
    snapshotBeforeUnmount() {
      if (disposed) return;
      // React unmount is synchronous: never flushSync an async parser. Prefer the
      // current whole state when idle, otherwise the last owned barrier capture.
      const unfinished = hasPendingTerminalWrites(terminal);
      if (!unfinished) captureCommitted();
      // Async parsing may have mutated cells without delivery commit. Invalidate
      // the continuation baseline: only daemon reset/replay can reconstruct it.
      useTerminalStore.getState().updateSessionTerminalSnapshot(
        sessionId, committed.text, committed.size, unfinished || !isHydrated() ? undefined : committed.sequence,
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unregister();
      parsed.dispose();
      resized.dispose();
      for (const resolve of pending) resolve(committed);
      pending.clear();
    },
  };
}
