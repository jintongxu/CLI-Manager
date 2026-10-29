export const HIDDEN_TERMINAL_DISPOSE_DELAY_MS = 60_000;

export interface HiddenTerminalDisplayScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export interface HiddenTerminalDisplayLifecycle {
  update(options: { enabled: boolean; visible: boolean }): void;
  dispose(): void;
}

/** Delays display disposal without changing the underlying PTY/session lifecycle. */
export function createHiddenTerminalDisplayLifecycle(
  onDispose: () => void,
  onRestore: () => void,
  scheduler: HiddenTerminalDisplayScheduler = globalThis,
  delayMs = HIDDEN_TERMINAL_DISPOSE_DELAY_MS,
): HiddenTerminalDisplayLifecycle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let displayDisposed = false;
  let disposed = false;
  let generation = 0;

  const clear = () => {
    generation++;
    if (timer === null) return;
    scheduler.clearTimeout(timer);
    timer = null;
  };

  return {
    update({ enabled, visible }) {
      if (disposed) return;
      if (visible || !enabled) {
        clear();
        const restore = displayDisposed;
        displayDisposed = false;
        if (restore) onRestore();
        return;
      }
      if (displayDisposed || timer !== null) return;
      const scheduledGeneration = generation;
      timer = scheduler.setTimeout(() => {
        if (disposed || displayDisposed || generation !== scheduledGeneration) return;
        timer = null;
        displayDisposed = true;
        onDispose();
      }, delayMs);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
