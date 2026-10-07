import { invoke } from '@tauri-apps/api/core';
import type { FinishRequest } from './worktreeFinish';

export interface ForceDeleteInspection {
  token: string;
  confirmedPath: string;
  deleteBranch: true;
  branchOid: string | null;
  pathMissing: boolean;
}
export interface ForceDeleteConfirmation extends ForceDeleteInspection {
  req: FinishRequest;
  sessionIds: string[];
}
function validBranchOid(oid: unknown): oid is string | null {
  return oid === null || (typeof oid === "string" && /^[0-9a-f]{40,64}$/.test(oid));
}
export async function inspectForceDelete(req: FinishRequest): Promise<ForceDeleteInspection> {
  const result = await invoke<ForceDeleteInspection>('git_worktree_force_delete_inspect', { req });
  if (!result.token || result.confirmedPath !== req.worktreePath || result.deleteBranch !== true || !validBranchOid(result.branchOid)) {
    throw new Error('force_delete_invalid_inspection');
  }
  return result;
}
export interface ForceDeleteDependencies {
  currentRequest: () => FinishRequest;
  isCurrent?: () => boolean;
  sessionIds: () => string[];
  closeSession: (id: string) => Promise<void>;
  releaseSessions: () => Promise<void>;
  deleteRecord: () => Promise<void>;
  removeLocal: () => void;
  refresh: () => Promise<void>;
  warn: (err: unknown) => void;
}
// Original opaque authorization must be validated, never replaced with a fresh inspect.
export async function finalizeForceDelete(deps: ForceDeleteDependencies, confirmation: ForceDeleteConfirmation, typedPath: string): Promise<void> {
  const { req, token, confirmedPath } = confirmation;
  const check = () => {
    if (deps.isCurrent && !deps.isCurrent()) throw new Error('force_delete_confirmation_changed');
    if (typedPath !== confirmedPath || confirmedPath !== req.worktreePath || confirmation.deleteBranch !== true || !validBranchOid(confirmation.branchOid) ||
      JSON.stringify(deps.currentRequest()) !== JSON.stringify(req)) throw new Error('force_delete_confirmation_changed');
    if (deps.sessionIds().some(id => !confirmation.sessionIds.includes(id))) throw new Error('finish_sessions_changed');
  };
  check();
  const args = { req, token, confirmedPath };
  // Non-consuming backend validation is required BEFORE any session side effects.
  const validated = await invoke<ForceDeleteInspection>('git_worktree_force_delete_validate', args);
  if (validated.token !== token || validated.confirmedPath !== confirmedPath || validated.deleteBranch !== true || validated.branchOid !== confirmation.branchOid || validated.pathMissing !== confirmation.pathMissing) {
    throw new Error('force_delete_authorization_changed');
  }
  check();
  const sessions = deps.sessionIds();
  for (const id of sessions) { check(); await deps.closeSession(id); }
  if (sessions.length) await deps.releaseSessions();
  check();
  const result = await invoke<{ done: boolean; branchDeleted: boolean }>('git_worktree_force_delete', args);
  if (!result.done || result.branchDeleted !== true) throw new Error('force_delete_incomplete');
  try { await deps.deleteRecord(); } catch (err) { throw new Error(`force_delete_database_failed: ${String(err)}`); }
  deps.removeLocal();
  try { await deps.refresh(); } catch (err) { deps.warn(err); }
}
