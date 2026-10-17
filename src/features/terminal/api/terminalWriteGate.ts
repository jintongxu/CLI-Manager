export type TerminalWriteOperation = () => Promise<void>;

/** Serializes writes per PTY and blocks new writes once close begins. */
export class TerminalWriteGate {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly closing = new Set<string>();

  isClosing(sessionId: string): boolean {
    return this.closing.has(sessionId);
  }

  enqueue(sessionId: string, operation: TerminalWriteOperation): Promise<void> {
    if (this.closing.has(sessionId)) return Promise.resolve();
    const previous = this.pending.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.pending.set(sessionId, next);
    void next.finally(() => {
      if (this.pending.get(sessionId) === next) this.pending.delete(sessionId);
    }).catch(() => undefined);
    return next;
  }

  beginClose(sessionId: string): void {
    this.closing.add(sessionId);
  }

  async waitForWrites(sessionId: string): Promise<void> {
    await this.pending.get(sessionId);
  }

  finishClose(sessionId: string): void {
    this.closing.delete(sessionId);
    this.pending.delete(sessionId);
  }
}
