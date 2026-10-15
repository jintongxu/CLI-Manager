import { invoke } from '@tauri-apps/api/core';
import type { FinishRequest, FinishState } from './worktreeFinish';

export interface WorktreeDeleteJobSummary {
  request: FinishRequest;
  mode: 'finish' | 'discard' | 'force';
  state: string;
  phase: string;
  updatedAtMs: number;
  lastError: string | null;
}

export function latestWorktreeDeleteJob<T extends WorktreeDeleteJobSummary>(jobs: T[], worktreeId: string): T | undefined {
  return jobs.reduce<T | undefined>((latest, job) => {
    if (job.request.worktreeId !== worktreeId) return latest;
    return !latest || job.updatedAtMs >= latest.updatedAtMs ? job : latest;
  }, undefined);
}

export async function inspectWorktreeStatus(req: FinishRequest): Promise<FinishState> {
  // The durable deletion journal always takes precedence over inferred finish
  // state, including records not yet normalized to pending/missing in memory.
  const jobs = await invoke<WorktreeDeleteJobSummary[]>('git_worktree_delete_jobs');
  const job = latestWorktreeDeleteJob(jobs, req.worktreeId);
  if (job && job.state !== 'completed') {
    return {
      checkoutValid: false, merged: false, outcome: null, sourceOid: null,
      cleanupReady: false, cleanupPending: true,
      blocker: job.lastError ?? 'worktree_delete_needs_reconfirmation',
      unknown: true, done: false, stashReference: null, mergeResult: null, phase: job.phase,
    };
  }
  return invoke<FinishState>('git_worktree_finish_inspect', { req });
}

export function worktreeStatusSummary(state: FinishState): 'blocked' | 'unknown' | 'done' | 'noDiff' | 'merged' | 'valid' {
  if (state.blocker) return 'blocked';
  if (state.unknown) return 'unknown';
  if (state.done) return 'done';
  if (state.outcome === 'no_diff') return 'noDiff';
  if (state.merged && state.outcome === 'merged') return 'merged';
  return state.checkoutValid ? 'valid' : 'unknown';
}

export function worktreeStatusGuidance(raw: string): 'dirty' | 'residual' | 'stash' | 'abort' | 'changed' | 'branchInUse' | 'identity' | 'recovery' | 'generic' {
  const code = raw.split(':')[0].trim();
  if (code === 'worktree_delete_needs_reconfirmation' || code === 'restart_requires_confirmation') return 'recovery';
  if (code === 'finish_dirty_checkout') return 'dirty';
  if (code === 'finish_legacy_residual_manual_review') return 'residual';
  if (code === 'finish_stash_restore_pending' || code.startsWith('force_merge_restore')) return 'stash';
  if (code === 'finish_merge_abort_unconfirmed' || code === 'force_merge_abort_failed') return 'abort';
  if (code === 'finish_source_changed' || code === 'finish_base_changed') return 'changed';
  if (code === 'finish_branch_in_use') return 'branchInUse';
  if (/^finish_(unsafe|protected|contains_other|receipt_identity|checkout_)/.test(code)) return 'identity';
  return 'generic';
}
