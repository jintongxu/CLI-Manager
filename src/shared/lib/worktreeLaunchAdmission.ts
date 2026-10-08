// Process-local supplement to the authoritative daemon worktree_admission_v1 fence.
// Reservations span the complete async launch, including publication into the session store.
const launches = new Map<symbol, string>();
const barriers = new Map<symbol, string>();
function normalize(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\/\/\?\//, '').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(clean) ? clean.toLowerCase() : clean;
}
export function isWithinWorktree(path: string | undefined, root: string): boolean {
  if (!path) return false;
  const value = normalize(path), scope = normalize(root);
  return value === scope || value.startsWith(scope + '/');
}
export function reserveWorktreeLaunch(cwd: string | undefined): () => void {
  if (!cwd) return () => {};
  if ([...barriers.values()].some(root => isWithinWorktree(cwd, root))) throw new Error('finish_admission_launch_blocked');
  const id = Symbol(); launches.set(id, cwd);
  return () => { launches.delete(id); };
}
export function acquireWorktreeLaunchBarrier(root: string): () => void {
  if ([...barriers.values()].some(scope => isWithinWorktree(root, scope) || isWithinWorktree(scope, root))) {
    throw new Error('finish_in_progress');
  }
  if ([...launches.values()].some(cwd => isWithinWorktree(cwd, root))) throw new Error('finish_admission_launch_in_progress');
  const id = Symbol(); barriers.set(id, root);
  return () => { barriers.delete(id); };
}
