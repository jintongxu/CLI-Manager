import { invoke } from '@tauri-apps/api/core';
import type { FinishRequest, FinishState } from './worktreeFinish';

// Unlike Store.inspectFinish, this read does not update the persisted record status.
export function inspectWorktreeStatus(req: FinishRequest): Promise<FinishState> {
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

export function worktreeStatusGuidance(raw: string): 'dirty' | 'residual' | 'stash' | 'abort' | 'changed' | 'branchInUse' | 'identity' | 'generic' {
  const code = raw.split(':')[0].trim();
  if (code === 'finish_dirty_checkout') return 'dirty';
  if (code === 'finish_legacy_residual_manual_review') return 'residual';
  if (code === 'finish_stash_restore_pending' || code.startsWith('force_merge_restore')) return 'stash';
  if (code === 'finish_merge_abort_unconfirmed' || code === 'force_merge_abort_failed') return 'abort';
  if (code === 'finish_source_changed' || code === 'finish_base_changed') return 'changed';
  if (code === 'finish_branch_in_use') return 'branchInUse';
  if (/^finish_(unsafe|protected|contains_other|receipt_identity|checkout_)/.test(code)) return 'identity';
  return 'generic';
}
