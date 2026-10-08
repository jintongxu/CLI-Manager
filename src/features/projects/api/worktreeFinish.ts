import type { GitFileChange, WorktreeRecord, WorktreeStatus } from '../../../shared/types/index';
import type { GitWorktreeMergeResult } from './worktreeStore';

export interface FinishRequest {
  worktreeId: string;
  projectPath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
}
export interface FinishState {
  checkoutValid: boolean;
  merged: boolean;
  outcome: 'merged' | 'no_diff' | null;
  sourceOid: string | null;
  cleanupReady: boolean;
  cleanupPending: boolean;
  blocker: string | null;
  unknown: boolean;
  done: boolean;
  stashReference: string | null;
  mergeResult: GitWorktreeMergeResult | null;
}
export function finishRequest(worktree: WorktreeRecord, projectPath: string): FinishRequest {
  return { worktreeId: worktree.id, projectPath, worktreePath: worktree.path,
    branch: worktree.branch, baseBranch: worktree.base_branch };
}
// pending 仅表示恢复入口，不允许作为普通 checkout 启动路径。
export function finishStatus(state: FinishState): WorktreeStatus {
  if (state.cleanupPending || state.done) return 'pending';
  return state.checkoutValid ? 'active' : 'missing';
}
// 仅有效且尚未进入清理的 checkout 可提交；已合并后新改动仍须留在审查阶段。
export function canReviewFinish(state: FinishState): boolean {
  return state.checkoutValid && !state.cleanupPending && !state.done && (!state.blocker || state.blocker === "finish_dirty_checkout") && !state.unknown;
}
export function assertCleanupReady(state: FinishState): void {
  if (state.blocker || state.unknown || (!state.done && !state.cleanupReady)) {
    throw new Error(state.blocker || 'finish_cleanup_not_ready');
  }
}
const operations = new Set<string>();
// 跨共享弹窗/Store 操作按 Worktree 串行，失败也必须释放进程内占用。
export async function withFinishLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  if (operations.has(id)) throw new Error('finish_in_progress');
  operations.add(id);
  try { return await operation(); } finally { operations.delete(id); }
}

// One open cycle is keyed by stable identity, never by object or translation references.
// Cancellation invalidates *all* outstanding requests, including reads and mutations.
export class FinishGeneration {
  private generation = 0;
  begin(): number { return ++this.generation; }
  current(token: number): boolean { return this.generation === token; }
  cancel(): void { ++this.generation; }
}
// 先读后端权威状态，再决定是否允许读取 checkout，不能把失效目录当零改动。
export async function readFinishReview(
  inspect: () => Promise<FinishState>,
  readChanges: () => Promise<GitFileChange[]>,
): Promise<{ state: FinishState; changes: GitFileChange[]; step: 'review' | 'merge' | 'cleanup' }> {
  const state = await inspect();
  const changes = canReviewFinish(state) ? await readChanges() : [];
  // Dirty valid checkouts must still be reviewed despite historical ancestry evidence.
  const step = changes.length ? 'review' : state.cleanupPending || state.done || state.merged || state.outcome === 'no_diff'
    ? 'cleanup' : 'merge';
  return { state, changes, step };
}

export interface FinishCleanupDependencies {
  inspect: () => Promise<FinishState>;
  sessionIds: () => string[];
  closeSession: (id: string) => Promise<void>;
  releaseSessions: () => Promise<void>;
  cleanup: () => Promise<FinishState>;
  deleteRecord: () => Promise<void>;
  removeLocal: () => void;
  ack: () => Promise<unknown>;
  refresh: () => Promise<void>;
  warn: (error: unknown) => void;
}
// 安全检查先于会话关闭；SQL 成功即本地移除，后续 ack/刷新失败不重做 Git 清理。
export async function finalizeFinish(deps: FinishCleanupDependencies, confirmedSessionIds: string[]): Promise<void> {
  const state = await deps.inspect();
  assertCleanupReady(state); // Never close sessions on an unsafe/failed inspect.
  const latest = deps.sessionIds();
  if (latest.some(id => !confirmedSessionIds.includes(id))) throw new Error('finish_sessions_changed');
  for (const id of latest) await deps.closeSession(id);
  if (latest.length) await deps.releaseSessions();
  // New arrivals are not implicitly covered by the original confirmation.
  if (deps.sessionIds().some(id => !confirmedSessionIds.includes(id))) throw new Error('finish_sessions_changed');
  if (!state.done) {
    const cleaned = await deps.cleanup();
    if (!cleaned.done) throw new Error(cleaned.blocker || 'finish_cleanup_not_ready');
  }
  try { await deps.deleteRecord(); } catch (err) { throw new Error(`finish_database_failed: ${String(err)}`); }
  deps.removeLocal(); // SQL success is final even when acknowledgement or sidebar refresh fails.
  try { await deps.ack(); } catch (err) { deps.warn(err); }
  try { await deps.refresh(); } catch (err) { deps.warn(err); }
}
