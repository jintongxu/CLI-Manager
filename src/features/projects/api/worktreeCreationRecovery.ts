import type { WorktreeRecord } from "../../../shared/types/index";

export type WorktreeCreationPhase = "save" | "readback" | "refresh" | "terminal";
type CreatedIdentity = Pick<WorktreeRecord, "id" | "name" | "path" | "branch">;

export interface WorktreeCreationMarker {
  recordId: string;
  projectPath: string;
  taskName: string;
  worktreePath?: string;
  branch?: string;
  rootIdentity?: string;
  createdAtMs: number;
}

const MARKER_STORAGE_KEY = "cli-manager.worktree-creation-markers";

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function readMarkers(): WorktreeCreationMarker[] {
  const raw = storage()?.getItem(MARKER_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WorktreeCreationMarker => (
      item && typeof item === "object" && typeof item.recordId === "string"
      && typeof item.projectPath === "string" && typeof item.taskName === "string"
      && typeof item.createdAtMs === "number"
    ));
  } catch { return []; }
}

function writeMarkers(markers: WorktreeCreationMarker[]): void {
  try { storage()?.setItem(MARKER_STORAGE_KEY, JSON.stringify(markers)); }
  catch { /* Recovery is best effort; the Git safety checks remain authoritative. */ }
}

export function beginWorktreeCreationMarker(marker: Omit<WorktreeCreationMarker, "createdAtMs">): WorktreeCreationMarker {
  const next = { ...marker, createdAtMs: Date.now() };
  const markers = readMarkers().filter(item => item.recordId !== marker.recordId);
  markers.push(next);
  writeMarkers(markers);
  return next;
}

export function updateWorktreeCreationMarker(recordId: string, update: Partial<WorktreeCreationMarker>): void {
  const markers = readMarkers();
  const index = markers.findIndex(item => item.recordId === recordId);
  if (index < 0) return;
  markers[index] = { ...markers[index], ...update };
  writeMarkers(markers);
}

export function completeWorktreeCreationMarker(recordId: string): void {
  writeMarkers(readMarkers().filter(item => item.recordId !== recordId));
}

export function listWorktreeCreationMarkers(): WorktreeCreationMarker[] {
  return readMarkers();
}

export function reconcileWorktreeCreationMarkers(records: WorktreeRecord[]): WorktreeCreationMarker[] {
  const recordIds = new Set(records.map(record => record.id));
  const unresolved = readMarkers().filter(marker => !recordIds.has(marker.recordId));
  writeMarkers(unresolved);
  return unresolved;
}

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

export function worktreeCreationPhase(error: unknown): WorktreeCreationPhase | null {
  const match = /worktree_record_(save|readback|refresh|terminal)_failed:/.exec(String(error));
  return match ? match[1] as WorktreeCreationPhase : null;
}

export class WorktreeCreationAttempts {
  private readonly attempts = new Map<string, Promise<WorktreeRecord>>();

  run(key: string, create: () => Promise<WorktreeRecord>, launch?: (record: WorktreeRecord) => Promise<unknown>): Promise<WorktreeRecord> {
    const existing = this.attempts.get(key);
    if (existing) return existing;
    const attempt = (async () => {
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
