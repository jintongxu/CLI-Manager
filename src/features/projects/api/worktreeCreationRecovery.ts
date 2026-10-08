import type { WorktreeRecord } from "../../../shared/types/index";

export type WorktreeCreationPhase = "save" | "readback" | "refresh" | "terminal";
type CreatedIdentity = Pick<WorktreeRecord, "id" | "name" | "path" | "branch">;

/** Git already succeeded. Never interpret this as permission to create another tree. */
export class WorktreeCreationError extends Error {
  constructor(
    public readonly phase: WorktreeCreationPhase,
    public readonly created: CreatedIdentity,
    public readonly reason: unknown,
  ) {
    super(`worktree_record_${phase}_failed: ${created.name}; ${created.path}; ${String(reason)}; id=${created.id}; branch=${created.branch}`);
    this.name = "WorktreeCreationError";
  }
}

/** Accept old Store string errors too, without depending on instanceof across bundles. */
export function worktreeCreationPhase(error: unknown): WorktreeCreationPhase | null {
  const match = /worktree_record_(save|readback|refresh|terminal)_failed:/.exec(String(error));
  return match ? match[1] as WorktreeCreationPhase : null;
}

/** One form identity is one operation, including terminal launch. Pre-Git errors remain editable. */
export class WorktreeCreationAttempts {
  private readonly attempts = new Map<string, Promise<WorktreeRecord>>();

  run(key: string, create: () => Promise<WorktreeRecord>, launch?: (record: WorktreeRecord) => Promise<unknown>): Promise<WorktreeRecord> {
    const existing = this.attempts.get(key);
    if (existing) return existing;
    const attempt = (async () => {
      // Defer execution until the promise has been registered, including synchronous failures.
      await Promise.resolve();
      try {
        const record = await create();
        if (launch) {
          try { await launch(record); }
          catch (reason) { throw new WorktreeCreationError("terminal", record, reason); }
        }
        return record;
      } catch (error) {
        if (!worktreeCreationPhase(error)) this.attempts.delete(key);
        throw error;
      }
    })();
    this.attempts.set(key, attempt);
    return attempt;
  }
}
