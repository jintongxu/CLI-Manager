import { WorktreeCreationError } from "./worktreeCreationRecovery";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getDb } from "../../../shared/platform/db";
import { logInfo, logWarn } from "../../../shared/platform/logger";
import { hasConfiguredCliTool } from "../../providers/api/providerSwitching";
import { projectSupportsCapability } from "./projectCapabilities";
import type { Project, TerminalSession, WorktreeIsolationStrategy, WorktreeRecord } from "../../../shared/types/index";
import { useProjectStore } from "./projectStore";
import { normalizeWorktreeShortLabel } from "./worktreeLabels";
import { finalizeFinish, finishRequest, finishStatus, withFinishLock, type FinishState, type CleanupPlan, type CleanupConfirmation } from "./worktreeFinish";
import { inspectForceDelete, finalizeForceDelete, type ForceDeleteConfirmation } from "./worktreeForceDelete";
import { acquireWorktreeLaunchBarrier, isWithinWorktree } from "../../../shared/lib/worktreeLaunchAdmission";
import { useTerminalStore } from "../../terminal/state";

export interface GitWorktreeCreateResult {
  name: string;
  branch: string;
  path: string;
  baseBranch: string;
}

export interface WorktreeCreateInput {
  /** Optional independent alias; empty uses the database-allocated Wn. */
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

interface ProjectGitValidationCacheEntry {
  key: string;
  valid: boolean;
}

interface WorktreeStore {
  worktrees: WorktreeRecord[];
  loaded: boolean;
  validatingProjects: Record<string, ProjectGitValidationCacheEntry>;
  loadWorktrees: () => Promise<void>;
  createWorktreeForProject: (project: Project, input?: WorktreeCreateInput | string) => Promise<WorktreeRecord>;
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
  finishCleanup: (worktree: WorktreeRecord, deleteBranch: boolean, confirmation: CleanupConfirmation, isCurrent?: () => boolean) => Promise<void>;
  inspectForceDelete: (worktree: WorktreeRecord) => Promise<ForceDeleteConfirmation>;
  forceDelete: (worktree: WorktreeRecord, confirmation: ForceDeleteConfirmation, typedPath: string, isCurrent?: () => boolean) => Promise<void>;
  markMissingWorktrees: () => Promise<void>;
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
  result: GitWorktreeCreateResult,
  displayName: string,
  description: string,
  shortLabel: string,
): Omit<WorktreeRecord, "label_ordinal"> {
  const ts = Date.now().toString();
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    name: result.name,
    display_name: displayName,
    description,
    short_label: shortLabel,
    branch: result.branch,
    path: result.path,
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
    `INSERT INTO worktrees (id, project_id, name, display_name, description, branch, path, base_branch, deps_prompt_dismissed, provider_overrides, status, created_at, updated_at, short_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      record.id,
      record.project_id,
      record.name,
      record.display_name,
      record.description,
      record.branch,
      record.path,
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
  loaded: false,
  validatingProjects: {},

  loadWorktrees: async () => {
    const db = await getDb();
    try {
      const worktrees = await db.select<WorktreeRecord[]>("SELECT * FROM worktrees ORDER BY created_at DESC");
      set({ worktrees, loaded: true });
    } catch (err) {
      if (!isMissingWorktreesTableError(err)) throw err;
      logWarn("worktree table is not available yet", err);
      set({ worktrees: [], loaded: true });
    }
  },

  markMissingWorktrees: async () => {
    // Startup reads authority only; never resume cleanup or close sessions.
    for (const worktree of get().worktrees) {
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
  finishCleanup: async (worktree, deleteBranch, confirmation, isCurrent) => {
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
    return { ...inspection, req, sessionIds: useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id).map(item => item.id) };
  },

  forceDelete: async (worktree, confirmation, typedPath, isCurrent) => withFinishLock(worktree.id, async () => {
    await finalizeForceDelete({
      isCurrent,
      currentRequest: () => {
        const current = get().worktrees.find(item => item.id === worktree.id);
        const project = useProjectStore.getState().projects.find(item => item.id === worktree.project_id);
        if (!current || !project) throw new Error("force_delete_identity_changed");
        return finishRequest(current, project.path);
      },
      sessionIds: () => useTerminalStore.getState().sessions.filter(item => item.worktreeId === worktree.id).map(item => item.id),
      closeSession: id => useTerminalStore.getState().closeSession(id),
      releaseSessions: waitForSessionRelease,
      deleteRecord: async () => { const db = await getDb(); await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]); },
      removeLocal: () => {
        set(store => ({ worktrees: store.worktrees.filter(item => item.id !== worktree.id) }));
        useProjectStore.getState().removeWorktreeLocal(worktree.id);
      },
      refresh: () => useProjectStore.getState().fetchAll("interactive"),
      warn: err => logWarn("force deletion complete; sidebar refresh failed", err),
    }, confirmation, typedPath);
  }),

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
    try {
      await preflightShortLabel(project.id, shortLabel);
      const result = await invoke<GitWorktreeCreateResult>("git_worktree_create", {
        req: {
          projectPath: project.path,
          taskName,
          worktreeRoot: project.worktree_root.trim() || null,
        },
      });
      const pendingRecord = mapCreateResultToRecord(project.id, result, displayName, description, shortLabel);
      try { await saveWorktreeRecord(pendingRecord); }
      catch (error) {
        // Git succeeded: retain all objects; do not attempt unsafe rollback.
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
      // The inserted record is authoritative for the new row. Refresh the full
      // project tree in the background so terminal creation is not blocked by it.
      set((state) => ({ worktrees: [record, ...state.worktrees.filter(item => item.id !== record.id)] }));
      useProjectStore.getState().addWorktreeLocal(record);
      void useProjectStore.getState().fetchAll("interactive").catch(() => {});
      return record;
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

  removeWorktree: async (worktree, deleteBranch) => {
    logInfo("Worktree discard started", { worktreeId: worktree.id, path: worktree.path });
    const existing = inFlightWorktreeRemovals.get(worktree.id);
    if (existing) return existing;
    const removal = (async () => {
      const project = useProjectStore.getState().projects.find((item) => item.id === worktree.project_id);
      if (!project) throw new Error("project_not_found");
      // Explicit discard remains destructive, but cannot close sessions or mutate
      // Git while a finish/commit operation owns this Worktree.
      await withFinishLock(worktree.id, async () => {
      // 先停掉同 worktree 的后台依赖安装任务（动态引入避免 store 循环依赖），再关会话删目录。
      await import("./worktreeDepsRunner")
        .then(async (mod) => {
          await mod.useWorktreeDepsRunnerStore.getState().cancel(worktree.id);
          await mod.waitForWorktreeDepsClose(worktree.id);
        })
        .catch(() => {});
      const terminalStore = useTerminalStore.getState();
      const linkedSessionIds = terminalStore.sessions
        .filter((session) => session.worktreeId === worktree.id)
        .map((session) => session.id);
      // Await each backend close before Git removal. This removes the fixed
      // 350ms delay while preserving terminal-store snapshot ordering.
      for (const sessionId of linkedSessionIds) {
        await terminalStore.closeSession(sessionId, true);
      }
      await invoke<string>("git_worktree_remove", {
        projectPath: project.path,
        worktreePath: worktree.path,
        branch: worktree.branch,
        deleteBranch,
      });
      const db = await getDb();
      await db.execute("DELETE FROM worktrees WHERE id = $1", [worktree.id]);
      set((state) => ({ worktrees: state.worktrees.filter((item) => item.id !== worktree.id) }));
      useProjectStore.getState().removeWorktreeLocal(worktree.id);
          logInfo("Worktree discard completed", { worktreeId: worktree.id });
        void useProjectStore.getState().fetchAll("interactive").catch(() => {});
      });
    })();
    inFlightWorktreeRemovals.set(worktree.id, removal);
    try {
      return await removal;
    } finally {
      if (inFlightWorktreeRemovals.get(worktree.id) === removal) inFlightWorktreeRemovals.delete(worktree.id);
    }
  },
}));
