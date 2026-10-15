import type { TerminalSession } from "../../../shared/types/index";

type Pending = {
  token: symbol;
  promise: Promise<string>;
  resolve: (sessionId: string) => void;
  reject: (error: unknown) => void;
};

type AdmissionResult =
  | { existingId: string }
  | { promise: Promise<string>; token?: symbol };

export function createWorktreeSessionAdmission() {
  const pending = new Map<string, Pending>();
  const isOrdinary = (session: TerminalSession) =>
    (session.kind ?? "pty") === "pty" && session.transientBackground !== true;

  return {
    begin(worktreeId: string, sessions: TerminalSession[]): AdmissionResult {
      const existing = sessions.find((session) => session.worktreeId === worktreeId && isOrdinary(session));
      if (existing) return { existingId: existing.id };
      const current = pending.get(worktreeId);
      if (current) return { promise: current.promise };
      let resolve!: (sessionId: string) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<string>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const entry = { token: Symbol(), promise, resolve, reject };
      // The owner executes the launch directly; this handler prevents a failed
      // owner launch from becoming an unhandled rejection while waiters still
      // receive the original promise.
      void promise.catch(() => {});
      pending.set(worktreeId, entry);
      return { token: entry.token, promise: entry.promise };
    },
    resolve(worktreeId: string, token: symbol | undefined, sessionId: string) {
      const entry = pending.get(worktreeId);
      if (entry && entry.token === token) entry.resolve(sessionId);
    },
    reject(worktreeId: string, token: symbol | undefined, error: unknown) {
      const entry = pending.get(worktreeId);
      if (entry && entry.token === token) entry.reject(error);
    },
    finish(worktreeId: string | undefined, token: symbol | undefined) {
      if (worktreeId && pending.get(worktreeId)?.token === token) pending.delete(worktreeId);
    },
  };
}
