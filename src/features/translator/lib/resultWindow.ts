export interface ScreenshotResult {
  original: string | null;
  translated: string;
  imageBase64: string;
  elapsedMs: number;
}
export interface ScreenshotCardState {
  attempt?: number;
  errorCode?: string | null;
  sessionId: number;
  phase: "loading" | "success" | "error";
  imageBase64: string;
  startedAt: number;
  elapsedMs: number;
}
export type TranslatorMode = "input" | "screenshot";
export interface TranslatorOpening {
  generation: number;
  revision?: number;
  card?: ScreenshotCardState | null;
  mode: TranslatorMode;
  text: string;
  result: ScreenshotResult | null;
}
export const translatedClipboardText = (result: ScreenshotResult) => result.translated;

/** Retained read/event ordering and forced fresh measurement share one opening identity. */
export class ResultWindowSession {
  current: TranslatorOpening | null = null;
  private sequence = 0;
  private measured = 0;
  accept(opening: TranslatorOpening) {
    const current = this.current;
    if (!opening.generation || opening.generation < (current?.generation ?? 0)) return false;
    if (opening.generation === current?.generation) {
      if ((opening.revision ?? 0) <= (current.revision ?? 0)) return false;
      this.current = opening;
      return true;
    }
    this.current = opening;
    this.sequence = 0;
    this.measured = 0;
    return true;
  }
  measure(height: number) {
    const opening = this.current;
    if (!opening || !Number.isFinite(height) || height <= 0) return null;
    const bounded = Math.ceil(Math.min(opening.mode === "input" ? 520 : 680,
      Math.max(opening.mode === "input" ? 220 : 300, height)));
    if (bounded === this.measured) return null;
    this.measured = bounded;
    return { height: bounded, generation: opening.generation, sequence: ++this.sequence, mode: opening.mode };
  }
}

/** Serial latest-value queue: native IPC cannot reorder an older resize behind the newest one. */
export class ResizeQueue<T> {
  private pending: T | null = null;
  private running = false;
  constructor(private send: (value: T) => Promise<unknown>) {}
  push(value: T) { this.pending = value; void this.drain(); }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const value = this.pending;
        this.pending = null;
        await this.send(value).catch(() => {});
      }
    } finally { this.running = false; }
  }
}
