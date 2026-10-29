import { readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { digest, freeze, fail, gitText, optionalGit, runGit } from './git-run.mjs';
import { loadDeliveryConfig, resolveDelivery } from './git-config.mjs';
export { runGit, gitText, optionalGit, digest, DeliveryError } from './git-run.mjs';
export { loadDeliveryConfig, resolveDelivery, validateBranch, redactRemote } from './git-config.mjs';

export function parseWorktrees(raw) {
  const records = []; let record = null;
  for (const field of raw.split('\0')) {
    if (!field) { if (record) records.push(record); record = null; continue; }
    const i = field.indexOf(' '); const key = i < 0 ? field : field.slice(0, i); const value = i < 0 ? true : field.slice(i + 1);
    if (key === 'worktree') { if (record) records.push(record); record = { path: value }; }
    else if (record) record[key] = value;
  }
  if (record) records.push(record);
  return records;
}
function canonical(p) { return realpathSync.native(p); }
export function repositoryContext(cwd) {
  const root = canonical(gitText(cwd, ['rev-parse', '--show-toplevel']));
  const gitDir = canonical(gitText(root, ['rev-parse', '--absolute-git-dir']));
  const commonDir = canonical(path.resolve(root, gitText(root, ['rev-parse', '--git-common-dir'])));
  const worktrees = parseWorktrees(runGit(root, ['worktree', 'list', '--porcelain', '-z']).stdout);
  const registered = worktrees.find(w => existsSync(w.path) && canonical(w.path) === root);
  if (!registered || registered.bare) fail('unregistered_worktree', '当前工作区不是有效的已登记检出');
  const branchRef = optionalGit(root, ['symbolic-ref', '-q', 'HEAD']);
  const sourceOid = optionalGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if ((registered.branch ?? null) !== branchRef || (sourceOid && registered.HEAD !== sourceOid)) fail('worktree_identity_changed', '工作区登记和实际引用不一致');
  return { root, gitDir, commonDir, identity: digest(commonDir), linked: gitDir !== commonDir,
    branch: branchRef?.startsWith('refs/heads/') ? branchRef.slice(11) : null, branchRef, sourceOid, worktrees };
}
export function validatePaths(root, paths = []) {
  if (!Array.isArray(paths) || paths.length > 10000) fail('invalid_paths', '范围必须为有限文件路径列表');
  const output = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p || p.length > 4096 || /[\\\x00-\x1f\x7f:]/.test(p) || path.posix.isAbsolute(p) || /^[a-z]:/i.test(p) || p.split('/').some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git')) fail('invalid_path', '路径必须是仓库内明确的普通相对文件路径');
    const segments = p.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const file = path.join(root, ...segments.slice(0, i));
      try {
        const stat = lstatSync(file);
        if (stat.isSymbolicLink() || (i === segments.length && !stat.isFile()) || (i < segments.length && (!stat.isDirectory() || existsSync(path.join(file, '.git'))))) fail('unsafe_path', '不允许符号链接、目录范围或嵌套仓库');
        const rel = path.relative(canonical(root), canonical(file));
        if (rel.startsWith('..') || path.isAbsolute(rel)) fail('unsafe_path', '路径越出仓库');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    output.push(p);
  }
  return [...new Set(output)].sort();
}
export function activeGitOperations(root) {
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START', 'index.lock', 'HEAD.lock'].filter(name => {
    const file = gitText(root, ['rev-parse', '--git-path', name]);
    return existsSync(path.resolve(root, file));
  });
}
export function readStatus(root) {
  const raw = runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout;
  const entries = []; const fields = raw.split('\0');
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    const status = fields[i].slice(0, 2); const file = fields[i].slice(3);
    const originalPath = /[RC]/.test(status) ? fields[++i] : null;
    entries.push({ status, path: file, originalPath });
  }
  return entries;
}
function snapshot(root) {
  const status = readStatus(root);
  const contents = status.flatMap(e => [e.path, e.originalPath].filter(Boolean)).sort().map(file => {
    const full = path.join(root, file);
    try {
      const stat = lstatSync(full);
      if (stat.isFile() && stat.size > 32 * 1024 * 1024) fail('preview_limit', '文件过大，无法安全冻结预览');
      const bytes = stat.isFile() ? readFileSync(full) : null;
      const untracked = status.some(e => e.path === file && e.status === '??');
      return { path: file, kind: stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other', mode: stat.mode,
        digest: bytes ? digest(bytes) : null, untrackedText: untracked && bytes && !bytes.includes(0) ? bytes.toString('utf8') : null };
    }
    catch (error) { if (error.code === 'ENOENT') return { path: file, kind: 'absent' }; throw error; }
  });
  const index = runGit(root, ['ls-files', '--stage', '-z']).stdout;
  const indexFlags = runGit(root, ['ls-files', '-v', '-z']).stdout;
  const restrictedIndex = indexFlags.split('\0').filter(Boolean).some(line => line[0] === 'S' || /[a-z]/.test(line[0])) || index.split('\0').some(line => line.startsWith('160000 '));
  const stagedDiff = runGit(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--']).stdout;
  const worktreeDiff = runGit(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--']).stdout;
  const indexPath = path.resolve(root, gitText(root, ['rev-parse', '--git-path', 'index']));
  return { status, contents, restrictedIndex, indexFlagsDigest: digest(indexFlags), indexDigest: digest(index), indexFileDigest: existsSync(indexPath) ? digest(readFileSync(indexPath)) : null,
    stagedDiff, worktreeDiff, operations: activeGitOperations(root) };
}
function history(root, range) {
  if (!range) return [];
  return gitText(root, ['log', '--format=%H%x00%P%x00%s', range, '--']).split('\n').filter(Boolean).map(line => {
    const [oid, parents, subject] = line.split('\0'); return { oid, parents: parents ? parents.split(' ') : [], subject };
  });
}
/** Protocol v1: JSON-only deeply frozen preview. Digest binds every field except digest itself.
 * Input: targetBranch?,remote?,remoteBranch?,paths?:string[],message?:string,push?:boolean.
 * Unknown orchestration fields are ignored here; write primitives never trust preview without reinspection.
 * state.blockers are stable codes; ready means local scope/checkout readiness, NOT push authority.
 */
export function inspectDelivery(cwd, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_input', '预览输入必须为 JSON 对象');
  for (const key of ['targetBranch', 'remote', 'remoteBranch', 'message']) if (key in input && typeof input[key] !== 'string') fail('invalid_input', '分支、远端和消息必须为文本');
  if ('push' in input && typeof input.push !== 'boolean') fail('invalid_input', '推送选择必须为布尔值');
  const context = repositoryContext(cwd);
  // Project configuration belongs to the physical primary checkout, not an arbitrary linked directory.
  const primary = context.worktrees.find(w => !w.bare && path.resolve(w.path, '.git') === path.resolve(context.commonDir));
  const config = loadDeliveryConfig(primary?.path ?? context.root);
  const resolution = resolveDelivery(context.root, config, input);
  const paths = validatePaths(context.root, input.paths ?? []);
  const source = snapshot(context.root);
  const targets = resolution.targetBranch ? context.worktrees.filter(w => w.branch === `refs/heads/${resolution.targetBranch}`) : [];
  const target = targets.length === 1 && existsSync(targets[0].path) ? targets[0] : null;
  const targetOid = resolution.targetBranch ? optionalGit(context.root, ['rev-parse', '--verify', `refs/heads/${resolution.targetBranch}^{commit}`]) : null;
  const mode = !context.branch ? 'detached' : context.branch === resolution.targetBranch ? 'primary' : context.linked ? 'worktree' : 'unsupported';
  const blockers = [];
  if (!context.sourceOid) blockers.push('unborn_head');
  if (!resolution.targetBranch) blockers.push('target_ambiguous');
  if (!target || !targetOid) blockers.push('target_not_checked_out');
  if (mode === 'unsupported' || mode === 'detached') blockers.push('unsupported_source');
  if (resolution.remoteAmbiguous) blockers.push('remote_url_ambiguous');
  if (source.operations.length) blockers.push('source_git_operation');
  if (source.restrictedIndex) blockers.push('unsupported_index');
  const unrelated = source.status.filter(e => !paths.includes(e.path) || (e.originalPath && !paths.includes(e.originalPath)));
  if (unrelated.length) blockers.push('unrelated_changes');
  if (source.status.some(e => /U|AA|DD/.test(e.status))) blockers.push('unmerged_index');
  if (source.status.length && !paths.length) blockers.push('scope_required');
  let targetState = null;
  if (target && canonical(target.path) !== context.root) {
    const targetContext = repositoryContext(target.path);
    targetState = snapshot(target.path);
    if (targetContext.commonDir !== context.commonDir || targetContext.branch !== resolution.targetBranch || targetContext.sourceOid !== targetOid) blockers.push('target_identity_changed');
    if (targetState.status.length) blockers.push('target_dirty');
    if (targetState.operations.length) blockers.push('target_git_operation');
    if (targetState.restrictedIndex) blockers.push('unsupported_target_index');
  }
  const trackingRef = resolution.remote && resolution.remoteBranch ? `refs/remotes/${resolution.remote}/${resolution.remoteBranch}` : null;
  const remoteTrackingOid = trackingRef ? optionalGit(context.root, ['rev-parse', '--verify', `${trackingRef}^{commit}`]) : null;
  const branchCommits = targetOid && context.sourceOid && mode === 'worktree' ? history(context.root, `${targetOid}..${context.sourceOid}`) : [];
  const targetUnpushedCommits = targetOid && remoteTrackingOid ? history(context.root, `${remoteTrackingOid}..${targetOid}`) : [];
  const branchDiff = targetOid && context.sourceOid && mode === 'worktree' ? runGit(context.root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', targetOid, context.sourceOid, '--']).stdout : '';
  const targetUnpushedDiff = targetOid && remoteTrackingOid ? runGit(context.root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', remoteTrackingOid, targetOid, '--']).stdout : null;
  const preview = { version: 2, context: { ...context, mode, targetRoot: target?.path ?? null, targetOid }, resolution, config,
    scope: { paths, message: input.message ?? null, push: input.push ?? (mode === 'worktree' ? config.pushFromWorktree ?? true : config.pushFromPrimary ?? true), unrelated, branchCommits, branchDiff, targetUnpushedCommits, targetUnpushedDiff, remoteTrackingOid, remoteHistoryKnown: Boolean(remoteTrackingOid) },
    state: { ready: blockers.length === 0, blockers: [...new Set(blockers)], source, target: targetState } };
  return freeze({ ...preview, digest: digest(preview) });
}
