import {
  beginWorktreeCreationMarker,
  completeWorktreeCreationMarker,
  reconcileWorktreeCreationMarkers,
  updateWorktreeCreationMarker,
  WorktreeCreationError,
} from "./worktreeCreationRecovery";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import { getDb } from "../../../shared/platform/db";
import { logInfo, logWarn } from "../../../shared/platform/logger";
import { hasConfiguredCliTool } from "../../providers/api/providerSwitching";
import { projectSupportsCapability } from "./projectCapabilities";
import type { Project, TerminalSession, WorktreeIsolationStrategy, WorktreeRecord } from "../../../shared/types/index";
import { useProjectStore } from "./projectStore";
import { normalizeWorktreeShortLabel } from "./worktreeLabels";
import { assertSameCleanupPlan, finalizeFinish, finishRequest, finishStatus, withFinishLock, type FinishState, type CleanupPlan, type CleanupConfirmation } from "./worktreeFinish";
import { inspectForceDelete, finalizeForceDelete, type ForceDeleteConfirmation } from "./worktreeForceDelete";
import { acquireWorktreeLaunchBarrier, isWithinWorktree } from "../../../shared/lib/worktreeLaunchAdmission";
import { useTerminalStore } from "../../terminal/state";
import { useBackgroundOperationStore } from "../../terminal/api/backgroundOperationStore";
import { translateCurrent } from "../../../shared/i18n/index";

export interface GitWorktreeCreateResult {
  name: string;
  branch: string;
  path: string;
  rootIdentity: string;
  baseBranch: string;
}

export interface WorktreeCreateInput {
  /** Reuse an optimistic sidebar row created before the Git operation starts. */
  placeholderId?: string;
  /** Optional independent alias; empty leaves the display name as the visible label. */
  shortLabel?: string;
  /** User-facing task name. It may contain Unicode text. */
  displayName?: string;
  /** Optional user-facing task description. */
  description?: string;
  /** Stable internal preview candidate; Rust alone reallocates on actual occupancy. */
  taskName?: string;
}

export interface GitWorktreeDepsCheckResult {
  needsInstall: boolean;
  command: string | null;
  reason: string | null;
}

export interface GitWorktreeMergeResult {
  merged: boolean;
  output: string;
  conflictFiles: string[];
  skipped: boolean;
  skipReason: string | null;
  stashCreated: boolean;
  stashRestored: boolean;
  stashReference: string | null;
  stashRestoreConflictFiles: string[];
}

export type WorktreeIsolationDecision = "prompt" | "auto" | "none";

export const WORKTREE_CREATE_IN_PROGRESS = "worktree_create_in_progress";

const inFlightWorktreeCreates = new Set<string>();
const inFlightWorktreeRemovals = new Map<string, Promise<void>>();

const RESERVED_WINDOWS_WORKTREE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
  "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
const WORKTREE_SESSION_RELEASE_DELAY_MS = 350;

function waitForSessionRelease(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, WORKTREE_SESSION_RELEASE_DELAY_MS));
}

async function stopWorktreeProcesses(worktree: WorktreeRecord): Promise<void> {
  await import("./worktreeDepsRunner").then(async (mod) => {
    await mod.useWorktreeDepsRunnerStore.getState().cancel(worktree.id);
    await mod.waitForWorktreeDepsClose(worktree.id);
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const sessions = useTerminalStore.getState().sessions.filter((session) =>
      session.worktreeId === worktree.id || isWithinWorktree(session.cwd, worktree.path));
    if (sessions.length === 0) return;
    for (const session of sessions) {
      await useTerminalStore.getState().closeSession(session.id, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("worktree_processes_still_active");
}

const WORKTREE_RETRY_BASE_DELAY_MS = 250;
const WORKTREE_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
const WORKTREE_RETRY_MAX_ATTEMPTS = 5;
const WORKTREE_RETRYABLE_ERROR = /(?:access denied|permission denied|sharing violation|used by another process|os error (?:5|32)|device or resource busy|failed to delete|unable to unlink|git_failed|database_failed|sessions_still_active|task_failed|temporarily unavailable|database is locked|busy)/i;

function isRetryableWorktreeError(error: unknown): boolean {
  return WORKTREE_RETRYABLE_ERROR.test(error instanceof Error ? error.message : String(error));
}

function waitForWorktreeRetry(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

class WorktreeRetryExhaustedError extends Error {
  constructor(cause: unknown) {
    super(`worktree_retry_exhausted: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "WorktreeRetryExhaustedError";
  }
}

function isWorktreeRetryExhausted(error: unknown): boolean {
  return error instanceof WorktreeRetryExhaustedError;
}

async function runWorktreeWithRetry(task: () => Promise<void>, onRetry: (error: unknown) => Promise<void>, afterWait: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await task(); return; }
    catch (error) {
      if (!isRetryableWorktreeError(error)) throw error;
      if (attempt >= WORKTREE_RETRY_MAX_ATTEMPTS - 1) throw new WorktreeRetryExhaustedError(error);
      await onRetry(error);
      const delay = Math.min(WORKTREE_RETRY_MAX_DELAY_MS, WORKTREE_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt, 10));
      await waitForWorktreeRetry(delay);
      await afterWait();
    }
  }
}

type WorktreeDeleteMode = "finish" | "discard" | "force";
interface WorktreeDeleteJob { id: string; request: ReturnType<typeof finishRequest>; mode: WorktreeDeleteMode; state: string; phase: string; updatedAtMs: number; lastError: string | null; }

function latestWorktreeDeleteJobs(jobs: WorktreeDeleteJob[]): WorktreeDeleteJob[] {
  const latest = new Map<string, WorktreeDeleteJob>();
  for (const job of jobs) {
    const current = latest.get(job.request.worktreeId);
    if (!current || job.updatedAtMs >= current.updatedAtMs) latest.set(job.request.worktreeId, job);
  }
  return [...latest.values()];
}

async function setRecoveredWorktreeStatus(worktreeId: string, status: WorktreeRecord["status"]): Promise<void> {
  const now = Date.now().toString();
  // Fail closed in memory before attempting persistence. A transient SQL error
  // must not expose an interrupted destructive operation as an active checkout.
  useWorktreeStore.setState((state) => ({
    worktrees: state.worktrees.map((item) => item.id === worktreeId ? { ...item, status, updated_at: now } : item),
  }));
  useProjectStore.getState().setWorktreeStatusLocal(worktreeId, status);
  const db = await getDb();
  await db.execute("UPDATE worktrees SET status = $1, updated_at = $2 WHERE id = $3", [status, now, worktreeId]);
}

function enqueueWorktreeOperation(
  worktree: WorktreeRecord,
  req: ReturnType<typeof finishRequest>,
  mode: WorktreeDeleteMode,
  deleteBranch: boolean,
  task: (markGitCompleted: () => Promise<void>) => Promise<void>,
  retryTransient = true,
  onTerminalFailure?: (error: unknown) => Promise<void>,
): Promise<void> {
  const operationId = `worktree-${mode}-${worktree.id}`;
  useWorktreeStore.getState().setWorktreeDeleting(worktree.id, true);
  useBackgroundOperationStore.getState().start({ id: operationId, kind: "worktree", titleKey: "backgroundOperations.worktree.title", detailKey: "backgroundOperations.worktree.loading" });
  const operation = (async () => {
    const job = await invoke<WorktreeDeleteJob>("git_worktree_delete_enqueue", { req, mode, deleteBranch });
    const db = await getDb();
    const now = Date.now().toString();
    await db.execute("UPDATE worktrees SET status = $1, updated_at = $2 WHERE id = $3", ["pending", now, worktree.id]);
    useWorktreeStore.setState((state) => ({ worktrees: state.worktrees.map((item) => item.id === worktree.id ? { ...item, status: "pending" } : item) }));
    useProjectStore.getState().setWorktreeStatusLocal(worktree.id, "pending");
    if (job.state === "queued" || job.state === "retryWait") {
      await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: job.state, state: "running", phase: "closingSessions", error: null });
    }
    try {
      if (retryTransient) {
        await runWorktreeWithRetry(
          () => task(async () => {
            await invoke("git_worktree_delete_job_update", {
              id: job.id,
              expectedState: "running",
              state: "running",
              phase: "gitCompleted",
              error: null,
            });
          }),
          async (error) => { await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: "running", state: "retryWait", phase: "retryWait", error: String(error) }).catch(() => undefined); },
          async () => { await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: "retryWait", state: "running", phase: "closingSessions", error: null }).catch(() => undefined); },
        );
      } else {
        await task(async () => {
          await invoke("git_worktree_delete_job_update", {
            id: job.id,
            expectedState: "running",
            state: "running",
            phase: "gitCompleted",
            error: null,
          });
        });
      }
      await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: "running", state: "completed", phase: "completed", error: null });
    } catch (error) {
      const retryable = retryTransient && !isWorktreeRetryExhausted(error) && isRetryableWorktreeError(error);
      await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: "running", state: retryable ? "retryWait" : "needsReconfirmation", phase: retryable ? "retryWait" : "needsReconfirmation", error: String(error) }).catch(() => undefined);
      if (!retryable && onTerminalFailure) await onTerminalFailure(error).catch((cleanupError) => logWarn("worktree terminal failure recovery failed", cleanupError));
      throw error;
    }
  })();
  void operation.then(
    () => {
      useWorktreeStore.getState().setWorktreeDeleting(worktree.id, false);
      useBackgroundOperationStore.getState().succeed(operationId);
      const messageKey = mode === "discard"
        ? "worktree.toast.discardSuccess"
        : mode === "force"
          ? "worktree.forceDelete.done"
          : "worktree.finish.cleanupDone";
      toast.success(translateCurrent(messageKey));
    },
    (error) => {
      useWorktreeStore.getState().setWorktreeDeleting(worktree.id, false);
      useBackgroundOperationStore.getState().fail(operationId, error);
    },
  );
  return operation;
}

interface ProjectGitValidationCacheEntry {
  key: string;
  valid: boolean;
}

interface WorktreeStore {
  worktrees: WorktreeRecord[];
  deletingWorktreeIds: Record<string, boolean>;
  loaded: boolean;
  validatingProjects: Record<string, ProjectGitValidationCacheEntry>;
  setWorktreeDeleting: (worktreeId: string, deleting: boolean) => void;
  loadWorktrees: () => Promise<void>;
  createWorktreeForProject: (project: Project, input?: WorktreeCreateInput | string) => Promise<WorktreeRecord>;
  removeWorktreeLocal: (worktreeId: string) => void;
  renameWorktree: (worktreeId: string, displayName: string) => Promise<void>;
  updateWorktreeMetadata: (worktreeId: string, displayName: string, description: string, shortLabel?: string) => Promise<void>;
  shouldIsolateNewSession: (
    project: Project,
    sessions: TerminalSession[]
  ) => WorktreeIsolationDecision;
  validateProjectGit: (project: Project) => Promise<boolean>;
  updateWorktreeProviderOverrides: (worktreeId: string, providerOverrides: string) => Promise<void>;
  checkDeps: (worktree: WorktreeRecord) => Promise<GitWorktreeDepsCheckResult>;
  dismissDepsPrompt: (worktreeId: string) => Promise<void>;
  mergeWorktree: (worktree: WorktreeRecord) => Promise<GitWorktreeMergeResult>;
  forceMergeWorktree: (worktree: WorktreeRecord) => Promise<GitWorktreeMergeResult>;
  removeWorktree: (worktree: WorktreeRecord, deleteBranch: boolean) => Promise<void>;
  inspectFinish: (worktree: WorktreeRecord) => Promise<FinishState>;
  finishMerge: (worktree: WorktreeRecord, force?: boolean) => Promise<FinishState>;
  planFinishCleanup: (worktree: WorktreeRecord, deleteBranch: boolean) => Promise<CleanupPlan>;
  releaseFinishCleanup: (plan: CleanupPlan) => Promise<void>;
  finishCleanup: (worktree: WorktreeRecord, deleteBranch: boolean, confirmation: CleanupConfirmation, isCurrent?: () => boolean, background?: boolean) => Promise<void>;
  inspectForceDelete: (worktree: WorktreeRecord) => Promise<ForceDeleteConfirmation>;
  forceDelete: (worktree: WorktreeRecord, confirmation: ForceDeleteConfirmation, typedPath: string, isCurrent?: () => boolean, background?: boolean) => Promise<void>;
  markMissingWorktrees: () => Promise<void>;
  resumeWorktreeDeleteJobs: () => Promise<void>;
}

function normalizeStrategy(value: string | null | undefined): WorktreeIsolationStrategy {
  return value === "prompt" || value === "autoParallel" || value === "always" ? value : "disabled";
}

function isMissingWorktreesTableError(err: unknown): boolean {
  const message = String(err).toLowerCase();
  if (!message.includes("no such table: worktrees")) return false;
  return !(
    message.includes("migration") ||
    message.includes("checksum") ||
    message.includes("previously applied") ||
    message.includes("modified") ||
    message.includes("initialization") ||
    message.includes("init failed")
  );
}

function hasSameProjectTerminalSession(projectId: string, sessions: TerminalSession[]): boolean {
  return sessions.some((session) => session.projectId === projectId && (session.kind ?? "pty") === "pty");
}

export function createDefaultWorktreeTaskName(_projectId?: string): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `task-${mm}${dd}-${hh}${min}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function createPendingWorktreeRecord(
  projectId: string,
  input: WorktreeCreateInput,
): WorktreeRecord {
  const taskName = input.taskName || createDefaultWorktreeTaskName();
  const displayName = normalizeWorktreeDisplayName(input.displayName?.trim() || taskName);
  const now = Date.now().toString();
  return {
    creation_pending: true,
    id: input.placeholderId || crypto.randomUUID(),
    project_id: projectId,
    name: taskName,
    display_name: displayName,
    description: normalizeWorktreeDescription(input.description ?? ""),
    short_label: normalizeWorktreeShortLabel(input.shortLabel ?? ""),
    branch: "",
    path: "",
    root_identity: "",
    base_branch: "",
    label_ordinal: 0,
    deps_prompt_dismissed: 0,
    provider_overrides: "{}",
    status: "pending",
    created_at: now,
    updated_at: now,
  };
}

export function sanitizeWorktreeTaskName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+/, "").slice(0, 64);
}

export function validateWorktreeTaskName(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(trimmed) && !RESERVED_WINDOWS_WORKTREE_NAMES.has(trimmed.toUpperCase());
}

const MAX_WORKTREE_DISPLAY_NAME_LENGTH = 64;
const MAX_WORKTREE_DESCRIPTION_LENGTH = 2000;

export function normalizeWorktreeDisplayName(value: string): string {
  return value.trim();
}

export function validateWorktreeDisplayName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && Array.from(normalized).length <= MAX_WORKTREE_DISPLAY_NAME_LENGTH;
}

export function normalizeWorktreeDescription(value: string): string {
  return value.trim();
}

export function validateWorktreeDescription(value: string): boolean {
  return Array.from(value.trim()).length <= MAX_WORKTREE_DESCRIPTION_LENGTH;
}

export function isWorktreeCreateInProgressError(error: unknown): boolean {
  return String(error).includes(WORKTREE_CREATE_IN_PROGRESS);
}

function mapCreateResultToRecord(
  projectId: string,
  recordId: string,
  result: GitWorktreeCreateResult,
  displayName: string,
  description: string,
  shortLabel: string,
): Omit<WorktreeRecord, "label_ordinal"> {
  const ts = Date.now().toString();
  return {
    creation_pending: false,
    id: recordId,
    project_id: projectId,
    name: result.name,
    display_name: displayName,
    description,
    short_label: shortLabel,
    branch: result.branch,
    path: result.path,
    root_identity: result.rootIdentity,
    base_branch: result.baseBranch,
    deps_prompt_dismissed: 0,
    provider_overrides: "{}",
    status: "active",
    created_at: ts,
    updated_at: ts,
  };
}

async function saveWorktreeRecord(record: Omit<WorktreeRecord, "label_ordinal">): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO worktrees (id, project_id, name, display_name, description, branch, path, root_identity, base_branch, deps_prompt_dismissed, provider_overrides, status, created_at, updated_at, short_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      record.id,
      record.project_id,
      record.name,
      record.display_name,
      record.description,
      record.branch,
      record.path,
      record.root_identity,
      record.base_branch,
      record.deps_prompt_dismissed,
      record.provider_overrides,
      record.status,
      record.created_at,
      record.updated_at,
      record.short_label,
    ]
  );
}

/** Advisory preflight only: the SQLite unique index arbitrates cross-window races. */
async function preflightShortLabel(projectId: string, shortLabel: string, exceptId = ""): Promise<void> {
  if (!shortLabel) return;
  const db = await getDb();
  const conflicts = await db.select<{ id: string }[]>(
    "SELECT id FROM worktrees WHERE project_id = $1 AND short_label = $2 COLLATE NOCASE AND id <> $3 LIMIT 1",
    [projectId, shortLabel, exceptId],
  );
  if (conflicts.length) throw new Error("worktree_short_label_conflict");
}

function metadataWriteError(error: unknown): unknown {
  return /UNIQUE constraint failed: worktrees.project_id, worktrees.short_label/i.test(String(error))
    ? new Error(`worktree_short_label_conflict: ${String(error)}`) : error;
}

export const useWorktreeStore = create<WorktreeStore>((set, get) => ({
  worktrees: [],
  deletingWorktreeIds: {},
  loaded: false,
  setWorktreeDeleting: (worktreeId, deleting) => set((state) => {
    const next = { ...state.deletingWorktreeIds };
    if (deleting) next[worktreeId] = true;
    else delete next[worktreeId];
    return { deletingWorktreeIds: next };
  }),
  removeWorktreeLocal: (worktreeId) => {
    set((state) => ({ worktrees: state.worktrees.filter((item) => item.id !== worktreeId) }));
    useProjectStore.getState().removeWorktreeLocal(worktreeId);
  },
  validatingProjects: {},

  loadWorktrees: async () => {
    const db = await getDb();
    try {
      const worktrees = await db.select<WorktreeRecord[]>("SELECT * FROM worktrees ORDER BY created_at DESC");
      set({ worktrees, loaded: true });
      const unresolved = reconcileWorktreeCreationMarkers(worktrees);
      for (const marker of unresolved) {
        if (!marker.worktreePath || !marker.branch || !marker.rootIdentity) {
          logWarn("worktree creation recovery marker lacks an exact target", marker);
          continue;
        }
        try {
          await invoke("git_worktree_remove", {
            projectPath: marker.projectPath,
            worktreePath: marker.worktreePath,
            rootIdentity: marker.rootIdentity,
            branch: marker.branch,
            deleteBranch: true,
          });
          completeWorktreeCreationMarker(marker.recordId);
        } catch (error) {
          logWarn("worktree creation recovery cleanup deferred", { marker, error });
        }
      }
    } catch (err) {
      if (!isMissingWorktreesTableError(err)) throw err;
      logWarn("worktree table is not available yet", err);
      set({ worktrees: [], loaded: true });
    }
  },

  resumeWorktreeDeleteJobs: async () => {
    const jobs = await invoke<WorktreeDeleteJob[]>("git_worktree_delete_jobs");
    for (const job of latestWorktreeDeleteJobs(jobs).filter((item) => ["queued", "running", "retryWait", "needsReconfirmation"].includes(item.state))) {
      const worktree = get().worktrees.find((item) => item.id === job.request.worktreeId);
      if (job.state === "running" && job.phase === "gitCompleted") {
        if (!worktree) {
          await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: "running", state: "completed", phase: "completed", error: null }).catch((error) => logWarn("failed to finalize completed Worktree deletion job", { job, error }));
          continue;
        }
        try {
          const db = await getDb();
          await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]);
          set((state) => ({ worktrees: state.worktrees.filter((item) => item.id !== worktree.id) }));
          useProjectStore.getState().removeWorktreeLocal(worktree.id);
          await invoke("git_worktree_delete_job_update", { id: job.id, expectedState: "running", state: "completed", phase: "completed", error: null });
          continue;
        } catch (error) {
          logWarn("failed to converge Worktree database after Git deletion", { job, error });
        }
      }
      if (["queued", "running", "retryWait"].includes(job.state)) {
        await invoke("git_worktree_delete_job_update", {
          id: job.id,
          expectedState: job.state,
          state: "needsReconfirmation",
          phase: "needsReconfirmation",
          error: "restart_requires_confirmation",
        }).catch(() => undefined);
      }
      if (!worktree) continue;
      // A destructive operation must never resume after restart. Discard has
      // already invalidated the checkout from the runtime's perspective;
      // finish/force remain pending until a fresh confirmation resolves them.
      await setRecoveredWorktreeStatus(worktree.id, job.mode === "discard" ? "missing" : "pending").catch((error) => {
        logWarn("failed to persist Worktree deletion recovery status", error);
      });
    }
  },

  markMissingWorktrees: async () => {
    // Do not run finish inspection against an interrupted delete operation:
    // its residual filesystem state is not evidence of a finish/merge failure.
    let jobs: WorktreeDeleteJob[];
    try {
      jobs = await invoke<WorktreeDeleteJob[]>("git_worktree_delete_jobs");
    } catch (error) {
      logWarn("worktree deletion job inspection failed during startup", error);
      for (const worktree of get().worktrees) {
        if (worktree.status !== "pending") await setRecoveredWorktreeStatus(worktree.id, "pending").catch(() => undefined);
      }
      return;
    }
    const recovering = new Map(latestWorktreeDeleteJobs(jobs)
      .filter((job) => job.state !== "completed")
      .map((job) => [job.request.worktreeId, job]));
    for (const worktree of get().worktrees) {
      const recoveryJob = recovering.get(worktree.id);
      if (recoveryJob) {
        await setRecoveredWorktreeStatus(worktree.id, recoveryJob.mode === "discard" ? "missing" : "pending").catch((error) => {
          logWarn("failed to persist Worktree deletion recovery status during inspection", error);
        });
        continue;
      }
      try { await get().inspectFinish(worktree); }
      catch (err) { logWarn("worktree validity inspection failed", err); }
    }
    try { await useProjectStore.getState().fetchAll("startup"); }
    finally {
      // A failed SQL status write must not make pending checkouts effective again.
      for (const item of get().worktrees) useProjectStore.getState().setWorktreeStatusLocal(item.id, item.status);
    }
  },

  inspectFinish: async (worktree) => {
    const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    let state: FinishState;
    try {
      state = await invoke<FinishState>("git_worktree_finish_inspect", { req: finishRequest(worktree, project.path) });
    } catch (err) {
      // Failed authority is not evidence that an old active checkout is usable.
      // Preserve pending recovery visibility, but fail closed for runtime consumers.
      const current = get().worktrees.find(item => item.id === worktree.id);
      const status = current?.status === "pending" ? "pending" : "missing";
      set(store => ({ worktrees: store.worktrees.map(item => item.id === worktree.id ? { ...item, status } : item) }));
      useProjectStore.getState().setWorktreeStatusLocal(worktree.id, status);
      throw err;
    }
    const status = finishStatus(state);
    useProjectStore.getState().setWorktreeStatusLocal(worktree.id, status);
    const current = get().worktrees.find(item => item.id === worktree.id);
    if (current && current.status !== status) {
      set(store => ({ worktrees: store.worktrees.map(item => item.id === worktree.id ? { ...item, status } : item) }));
      const db = await getDb();
      await db.execute("UPDATE worktrees SET status = $1, updated_at = $2 WHERE id = $3", [status, Date.now().toString(), worktree.id]);
    }
    return state;
  },

  finishMerge: async (worktree, force = false) => {
    const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    return withFinishLock(worktree.id, async () => {
      const inspected = await get().inspectFinish(worktree);
      if (inspected.cleanupPending || inspected.done || inspected.blocker || inspected.unknown || !inspected.checkoutValid) {
        throw new Error(inspected.blocker || "finish_invalid_checkout");
      }
      try {
        return await invoke<FinishState>("git_worktree_finish_merge", { req: finishRequest(worktree, project.path), force });
      } finally { await get().inspectFinish(worktree); }
    });
  },

  planFinishCleanup: async (worktree, deleteBranch) => {
    const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    return invoke<CleanupPlan>("git_worktree_finish_cleanup_plan", { req: finishRequest(worktree, project.path), deleteBranch });
  },
  releaseFinishCleanup: plan => invoke("git_worktree_finish_cleanup_release", { req: plan.request, token: plan.token }),
  finishCleanup: async (worktree, deleteBranch, confirmation, isCurrent, background = false) => {
    if (background) {
      const project = useProjectStore.getState().projects.find((item) => item.id === worktree.project_id);
      if (!project) throw new Error("project_not_found");
      enqueueWorktreeOperation(worktree, finishRequest(worktree, project.path), "finish", deleteBranch, async (markGitCompleted) => {
        await stopWorktreeProcesses(worktree);
        const state = await get().inspectFinish(worktree);
        if (state.blocker || state.unknown) throw new Error(state.blocker || "finish_cleanup_not_ready");
        if (state.done) {
          await get().finishCleanup(worktree, deleteBranch, { plan: null, sessionIds: useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id).map(item => item.id) }, undefined, false);
          await markGitCompleted();
          return;
        }
        const freshPlan = await get().planFinishCleanup(worktree, deleteBranch);
        if (confirmation.plan) assertSameCleanupPlan(confirmation.plan, freshPlan);
        if (freshPlan.blocker && !freshPlan.preserved.length) throw new Error(freshPlan.blocker);
        try {
          await get().finishCleanup(worktree, deleteBranch, {
            plan: freshPlan,
            sessionIds: [...new Set([...useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id || isWithinWorktree(item.cwd, worktree.path)).map(item => item.id), ...freshPlan.sessionIds])],
          }, undefined, false);
        } catch (error) {
          if (String(error).includes("finish_database_failed")) {
            await markGitCompleted().catch((markError) => logWarn("failed to persist finish Git completion", markError));
          }
          throw error;
        } finally { await get().releaseFinishCleanup(freshPlan).catch(() => undefined); }
        await markGitCompleted();
      }, true, async () => {
        // Cleanup remains recoverable only through a fresh confirmation.
        await setRecoveredWorktreeStatus(worktree.id, "pending");
      });
      return;
    }
    const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    const req = finishRequest(worktree, project.path);
    await withFinishLock(worktree.id, async () => {
      const releaseLaunchBarrier = acquireWorktreeLaunchBarrier(worktree.path);
      try {
        if (confirmation.plan && (JSON.stringify(confirmation.plan.request) !== JSON.stringify(req) || confirmation.plan.deleteBranch !== deleteBranch)) {
          throw new Error("finish_plan_request_changed");
        }
        await finalizeFinish({
          inspect: () => get().inspectFinish(worktree),
          sessionIds: () => useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id || isWithinWorktree(item.cwd, worktree.path)).map(item => item.id),
          closeSession: id => useTerminalStore.getState().closeSession(id, true),
          releaseSessions: waitForSessionRelease,
          isCurrent,
          validate: confirmation.plan ? () => invoke<CleanupPlan>("git_worktree_finish_cleanup_validate", { req, deleteBranch, token: confirmation.plan!.token }) : undefined,
          releasePlan: confirmation.plan ? () => get().releaseFinishCleanup(confirmation.plan!) : undefined,
          cleanup: () => invoke<FinishState>("git_worktree_finish_cleanup_confirmed", { req, deleteBranch, token: confirmation.plan!.token }),
          deleteRecord: async () => { const db = await getDb(); await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]); },
          removeLocal: () => {
            set(store => ({ worktrees: store.worktrees.filter(item => item.id !== worktree.id) }));
            useProjectStore.getState().removeWorktreeLocal(worktree.id);
          },
          ack: () => invoke("git_worktree_finish_ack", { req }),
          refresh: () => useProjectStore.getState().fetchAll("interactive"),
          warn: err => logWarn("worktree finish release/acknowledgement/sidebar diagnostic", err),
        }, confirmation);
      } catch (err) {
        try { await get().inspectFinish(worktree); } catch (inspectErr) { logWarn("finish recovery inspect failed", inspectErr); }
        throw err;
      } finally { releaseLaunchBarrier(); }
    });
  },

  inspectForceDelete: async (worktree) => {
    const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    const req = finishRequest(worktree, project.path);
    const inspection = await inspectForceDelete(req);
    return { ...inspection, req, sessionIds: useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id || isWithinWorktree(item.cwd, worktree.path)).map(item => item.id) };
  },

  forceDelete: async (worktree, confirmation, typedPath, isCurrent, background = false) => {
    if (background) {
      const project = useProjectStore.getState().projects.find((item) => item.id === worktree.project_id);
      if (!project) throw new Error("project_not_found");
      let gitCompleted = false;
      enqueueWorktreeOperation(worktree, finishRequest(worktree, project.path), "force", true, async (markGitCompleted) => {
        await stopWorktreeProcesses(worktree);
        if (gitCompleted) {
          const db = await getDb();
          await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]);
          set((state) => ({ worktrees: state.worktrees.filter((item) => item.id !== worktree.id) }));
          useProjectStore.getState().removeWorktreeLocal(worktree.id);
          return;
        }
        const fresh = await get().inspectForceDelete(worktree);
        if (fresh.confirmedPath !== confirmation.confirmedPath || fresh.branchOid !== confirmation.branchOid || fresh.pathMissing !== confirmation.pathMissing || JSON.stringify(fresh.req) !== JSON.stringify(confirmation.req)) {
          throw new Error("force_delete_confirmation_changed");
        }
        try {
          await get().forceDelete(worktree, fresh, fresh.confirmedPath, undefined, false);
          gitCompleted = true;
          await markGitCompleted();
        } catch (error) {
          if (String(error).includes("force_delete_database_failed")) {
            gitCompleted = true;
            await markGitCompleted().catch((markError) => logWarn("failed to persist force-delete Git completion", markError));
          }
          throw error;
        }
      }, false, async () => {
        // Force-delete failures remain pending until the user performs a new
        // identity check and confirmation; never fall through finish inspect.
        await setRecoveredWorktreeStatus(worktree.id, "pending");
      });
      return;
    }
    return withFinishLock(worktree.id, async () => {
    const releaseLaunchBarrier = acquireWorktreeLaunchBarrier(worktree.path);
    try {
    await finalizeForceDelete({
      isCurrent,
      currentRequest: () => {
        const current = get().worktrees.find(item => item.id === worktree.id);
        const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
        if (!current || !project) throw new Error("force_delete_identity_changed");
        return finishRequest(current, project.path);
      },
      sessionIds: () => useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id || isWithinWorktree(item.cwd, worktree.path)).map(item => item.id),
      closeSession: id => useTerminalStore.getState().closeSession(id, true),
      releaseSessions: waitForSessionRelease,
      deleteRecord: async () => { const db = await getDb(); await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]); },
      removeLocal: () => {
        set(store => ({ worktrees: store.worktrees.filter(item => item.id !== worktree.id) }));
        useProjectStore.getState().removeWorktreeLocal(worktree.id);
      },
      refresh: () => useProjectStore.getState().fetchAll("interactive"),
      warn: err => logWarn("force deletion complete; sidebar refresh failed", err),
    }, confirmation, typedPath);
    } finally { releaseLaunchBarrier(); }
    });
  },

  createWorktreeForProject: async (project, input) => {
    if (!projectSupportsCapability(project, "worktree")) {
      throw new Error("remote_project_capability_unsupported:worktree");
    }
    const requested = typeof input === "string" ? { displayName: input } : (input ?? {});
    const shortLabel = normalizeWorktreeShortLabel(requested.shortLabel ?? "");
    const fallbackDisplayName = requested.taskName || createDefaultWorktreeTaskName();
    const displayName = normalizeWorktreeDisplayName(requested.displayName?.trim() || requested.taskName || fallbackDisplayName);
    if (!validateWorktreeDisplayName(displayName)) {
      throw new Error("display_name_invalid");
    }
    const description = normalizeWorktreeDescription(requested.description ?? "");
    if (!validateWorktreeDescription(description)) {
      throw new Error("description_too_long");
    }
    const taskName = requested.taskName || fallbackDisplayName;
    if (!validateWorktreeTaskName(taskName)) {
      throw new Error("task_name_invalid");
    }
    const creationKey = `${project.path}\u0000${project.worktree_root.trim()}\u0000${taskName}`;
    if (inFlightWorktreeCreates.has(creationKey)) {
      throw new Error(WORKTREE_CREATE_IN_PROGRESS);
    }
    inFlightWorktreeCreates.add(creationKey);
    const recordId = requested.placeholderId || crypto.randomUUID();
    let gitCreated = false;
    beginWorktreeCreationMarker({
      recordId,
      projectPath: project.path,
      taskName,
    });
    try {
      await preflightShortLabel(project.id, shortLabel);
      const result = await invoke<GitWorktreeCreateResult>("git_worktree_create", {
        req: {
          projectPath: project.path,
          taskName,
          worktreeRoot: project.worktree_root.trim() || null,
        },
      });
      gitCreated = true;
      updateWorktreeCreationMarker(recordId, {
        worktreePath: result.path,
        branch: result.branch,
        rootIdentity: result.rootIdentity,
      });
      const pendingRecord = mapCreateResultToRecord(project.id, recordId, result, displayName, description, shortLabel);
      // The marker is the durable compensation record for a Git success followed
      // by a database failure. Roll back only this exact, identity-bound target.
      try { await saveWorktreeRecord(pendingRecord); }
      catch (error) {
        try {
          await invoke("git_worktree_remove", {
            projectPath: project.path,
            worktreePath: result.path,
            rootIdentity: result.rootIdentity,
            branch: result.branch,
            deleteBranch: true,
          });
          completeWorktreeCreationMarker(recordId);
        } catch (rollbackError) {
          logWarn("worktree creation rollback deferred to startup recovery", rollbackError);
        }
        throw new WorktreeCreationError("save", pendingRecord, metadataWriteError(error));
      }
      let record: WorktreeRecord;
      try {
        const db = await getDb();
        const rows = await db.select<WorktreeRecord[]>("SELECT * FROM worktrees WHERE id = $1", [pendingRecord.id]);
        if (!rows[0]) throw new Error("worktree_not_found_after_insert");
        record = rows[0];
      } catch (error) {
        throw new WorktreeCreationError("readback", pendingRecord, error);
      }
      completeWorktreeCreationMarker(recordId);
      // The inserted record is authoritative for the new row. Refresh the full
      // project tree in the background so terminal creation is not blocked by it.
      set((state) => ({ worktrees: [record, ...state.worktrees.filter(item => item.id !== record.id)] }));
      useProjectStore.getState().addWorktreeLocal(record);
      void useProjectStore.getState().fetchAll("interactive").catch(() => {});
      return record;
    } catch (error) {
      if (!gitCreated) completeWorktreeCreationMarker(recordId);
      throw error;
    } finally {
      inFlightWorktreeCreates.delete(creationKey);
    }
  },

  renameWorktree: async (worktreeId, displayName) => {
    const current = get().worktrees.find((worktree) => worktree.id === worktreeId);
    if (!current) throw new Error("worktree_not_found");
    await get().updateWorktreeMetadata(worktreeId, displayName, current.description);
  },

  updateWorktreeMetadata: async (worktreeId, displayName, description, shortLabel) => {
    const current = get().worktrees.find((worktree) => worktree.id === worktreeId);
    if (!current) throw new Error("worktree_not_found");
    const normalizedDisplayName = normalizeWorktreeDisplayName(displayName);
    if (!validateWorktreeDisplayName(normalizedDisplayName)) throw new Error("display_name_invalid");
    const normalizedDescription = normalizeWorktreeDescription(description);
    if (!validateWorktreeDescription(normalizedDescription)) throw new Error("description_too_long");
    const ts = Date.now().toString();
    const db = await getDb();
    const normalizedLabel = shortLabel === undefined ? undefined : normalizeWorktreeShortLabel(shortLabel);
    if (normalizedLabel !== undefined) await preflightShortLabel(current.project_id, normalizedLabel, worktreeId);
    try {
      await db.execute(
        `UPDATE worktrees SET display_name = $1, description = $2, updated_at = $3${normalizedLabel === undefined ? "" : ", short_label = $5"} WHERE id = $4`,
        [normalizedDisplayName, normalizedDescription, ts, worktreeId, ...(normalizedLabel === undefined ? [] : [normalizedLabel])]
      );
    } catch (error) { throw metadataWriteError(error); }
    set((state) => ({
      worktrees: state.worktrees.map((worktree) => worktree.id === worktreeId
        ? { ...worktree, display_name: normalizedDisplayName, description: normalizedDescription, updated_at: ts, ...(normalizedLabel === undefined ? {} : { short_label: normalizedLabel }) }
        : worktree),
    }));
    try { await useProjectStore.getState().fetchAll("interactive"); }
    catch (error) { throw new Error(`worktree_metadata_refresh_failed: ${worktreeId}; ${String(error)}`); }
  },

  shouldIsolateNewSession: (project, sessions) => {
    if (!projectSupportsCapability(project, "worktree")) return "none";
    const strategy = normalizeStrategy(project.worktree_strategy);
    if (strategy === "disabled") return "none";
    if (strategy === "always") return "auto";
    if (!hasConfiguredCliTool(project)) return "none";
    if (!hasSameProjectTerminalSession(project.id, sessions)) return "none";
    return strategy === "autoParallel" ? "auto" : "prompt";
  },

  validateProjectGit: async (project) => {
    if (!projectSupportsCapability(project, "worktree")) return false;
    const key = `${project.id}:${project.path}`;
    const cached = get().validatingProjects[project.id];
    if (cached?.key === key) return cached.valid;
    let valid = false;
    try {
      valid = await invoke<boolean>("git_worktree_validate", { projectPath: project.path });
    } catch {
      valid = false;
    }
    set((state) => ({
      validatingProjects: {
        ...state.validatingProjects,
        [project.id]: { key, valid },
      },
    }));
    return valid;
  },

  updateWorktreeProviderOverrides: async (worktreeId, providerOverrides) => {
    const db = await getDb();
    const ts = Date.now().toString();
    await db.execute("UPDATE worktrees SET provider_overrides = $1, updated_at = $2 WHERE id = $3", [
      providerOverrides,
      ts,
      worktreeId,
    ]);
    set((state) => ({
      worktrees: state.worktrees.map((worktree) =>
        worktree.id === worktreeId
          ? { ...worktree, provider_overrides: providerOverrides, updated_at: ts }
          : worktree
      ),
    }));
    await useProjectStore.getState().fetchAll("interactive");
  },

  checkDeps: async (worktree) => {
    return invoke<GitWorktreeDepsCheckResult>("git_worktree_check_deps", { worktreePath: worktree.path });
  },

  dismissDepsPrompt: async (worktreeId) => {
    const ts = Date.now().toString();
    const db = await getDb();
    await db.execute("UPDATE worktrees SET deps_prompt_dismissed = 1, updated_at = $1 WHERE id = $2", [ts, worktreeId]);
    set((state) => ({
      worktrees: state.worktrees.map((worktree) =>
        worktree.id === worktreeId
          ? { ...worktree, deps_prompt_dismissed: 1, updated_at: ts }
          : worktree
      ),
    }));
    await useProjectStore.getState().fetchAll("interactive");
  },

  mergeWorktree: async (worktree) => {
    const project = useProjectStore.getState().projects.find((item) => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    return invoke<GitWorktreeMergeResult>("git_worktree_merge", {
      projectPath: project.path,
      worktreeBranch: worktree.branch,
      baseBranch: worktree.base_branch,
    });
  },

  forceMergeWorktree: async (worktree) => {
    const project = useProjectStore.getState().projects.find((item) => item.id === worktree.project_id);
    if (!project) throw new Error("project_not_found");
    return invoke<GitWorktreeMergeResult>("git_worktree_force_merge", {
      projectPath: project.path,
      worktreeBranch: worktree.branch,
      baseBranch: worktree.base_branch,
    });
  },

  removeWorktree: (worktree, deleteBranch) => {
    if (inFlightWorktreeRemovals.has(worktree.id)) return Promise.resolve();
    const project = useProjectStore.getState().projects.find((item) => item.id === worktree.project_id);
    if (!project) return Promise.reject(new Error("project_not_found"));
    let gitCompleted = false;
    const removalTask = async (markGitCompleted: () => Promise<void>) => {
    logInfo("Worktree discard started", { worktreeId: worktree.id, path: worktree.path });
      // Explicit discard remains destructive, but cannot close sessions or mutate
      // Git while a finish/commit operation owns this Worktree.
      const releaseLaunchBarrier = acquireWorktreeLaunchBarrier(worktree.path);
      try { await withFinishLock(worktree.id, async () => {
      await stopWorktreeProcesses(worktree);
      if (!gitCompleted) {
        await invoke<string>("git_worktree_remove", {
          projectPath: project.path,
          worktreePath: worktree.path,
          rootIdentity: worktree.root_identity,
          branch: worktree.branch,
          deleteBranch,
        });
        gitCompleted = true;
        await markGitCompleted();
      }
      const db = await getDb();
      await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]);
      set((state) => ({ worktrees: state.worktrees.filter((item) => item.id !== worktree.id) }));
      useProjectStore.getState().removeWorktreeLocal(worktree.id);
          logInfo("Worktree discard completed", { worktreeId: worktree.id });
        void useProjectStore.getState().fetchAll("interactive").catch(() => {});
      }); } finally { releaseLaunchBarrier(); }
    };
    const removal = enqueueWorktreeOperation(worktree, finishRequest(worktree, project.path), "discard", deleteBranch, async (markGitCompleted) => {
      await removalTask(markGitCompleted);
    }, true, async () => {
      // Discard is independent of finish receipts. A failed/partial destructive
      // removal must not call inspectFinish and surface legacy merge blockers.
      await setRecoveredWorktreeStatus(worktree.id, "missing");
    });
    inFlightWorktreeRemovals.set(worktree.id, removal);
    void removal.finally(() => {
      if (inFlightWorktreeRemovals.get(worktree.id) === removal) inFlightWorktreeRemovals.delete(worktree.id);
    }).catch(() => undefined);
    return Promise.resolve();
  },
}));
