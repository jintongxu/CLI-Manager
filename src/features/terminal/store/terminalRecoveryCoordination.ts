export function createTerminalRecoveryCoordination(onBusy?: (id: string, busy: boolean) => void) {
  const flights = new Map<string, { promise: Promise<string>; cancelled: boolean; replacesSource: boolean; incarnation?: number }>();
  const closing = new Set<string>();
  return {
    run(id: string, execute: (cancelled: () => boolean) => Promise<string>, replacesSource = false, incarnation?: number): Promise<string> {
      const existing = flights.get(id);
      if (existing) return existing.incarnation === incarnation ? existing.promise : Promise.reject(new Error("terminal_recovery_session_changed"));
      if (closing.has(id)) return Promise.reject(new Error("terminal_recovery_session_changed"));
      const entry = { promise: null as unknown as Promise<string>, cancelled: false, replacesSource, incarnation };
      entry.promise = Promise.resolve().then(() => execute(() => entry.cancelled)).finally(() => {
        if (flights.get(id) === entry) { flights.delete(id); onBusy?.(id, false); }
      });
      flights.set(id, entry);
      onBusy?.(id, true);
      return entry.promise;
    },
    async beforeClose(id: string): Promise<string> {
      closing.add(id);
      const entry = flights.get(id);
      if (!entry) return id;
      entry.cancelled = true;
      try { const result = await entry.promise; return entry.replacesSource ? result : id; } catch (error) {
        return (error as { committedSessionId?: string })?.committedSessionId ?? id;
      }
    },
    afterClose(id: string) { closing.delete(id); },
  };
}
export type TerminalRecoveryCoordination = ReturnType<typeof createTerminalRecoveryCoordination>;
