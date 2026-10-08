import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { hasPendingTerminalWrites } from "../../../shared/lib/terminalHistoricalParser";
import { captureTerminalSnapshot, type TerminalSnapshotCapture } from "./terminalSnapshotCapture";
import { registerTerminalSnapshotSource, markTerminalSnapshotDirty } from "../api/sessionSnapshotPersistence";
import { terminalProcessManager } from "../api/TerminalProcessManager";
import { useTerminalStore } from "../state";

/** Owns one mounted display's captures. Parsed events only mark dirty; expensive
 * serialization belongs to persistence/unmount barriers, never the output hot path.
 * Disposal resolves pending captures with the last whole committed image and cannot
 * overwrite a replacement registration. An unfinished async parse is not an image.
 */
export function createTerminalSnapshotLifecycle(sessionId: string, terminal: Terminal, addon: SerializeAddon) {
  let disposed = false;
  let dirty = false;
  let committed = captureTerminalSnapshot(terminal, addon, false);
  const pending = new Set<(capture: TerminalSnapshotCapture) => void>();
  let barrierQueued = false;
  const captureCommitted = (includeCheckpoint = false) => {
    if (dirty || (includeCheckpoint && !committed.checkpointText)) {
      committed = captureTerminalSnapshot(terminal, addon, includeCheckpoint);
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
    if (disposed || !capture) return;
    await terminalProcessManager.checkpoint(sessionId, capture.size.cols, capture.size.rows, serialized);
  });
  return {
    snapshotBeforeUnmount() {
      if (disposed) return;
      // React unmount is synchronous: never flushSync an async parser. Prefer the
      // current whole state when idle, otherwise the last owned barrier capture.
      if (!hasPendingTerminalWrites(terminal)) captureCommitted();
      useTerminalStore.getState().updateSessionTerminalSnapshot(sessionId, committed.text, committed.size);
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
