import { digest, fail, gitText, runGit, optionalGit } from './git-run.mjs';
import { readStatus, validatePaths } from './git-state.mjs';
import { head, tree, assertCheckout } from './delivery-protocol.mjs';
import { commitIndex } from './git-commit.mjs';
import { assertRemote, finalTip, ancestor } from './delivery-remote.mjs';
import { writeJournal } from './journal.mjs';

const save = writeJournal;
const needsSync = j => ['remote-ahead', 'diverged'].includes(j.remoteState?.relation);
export { needsSync };
export function operationContext(j, operation, ours, theirs) {
  const base = optionalGit(j.targetRoot, ['merge-base', '--all', ours, theirs]);
  if (!base || base.includes('\n')) fail('unrelated_history', '缺少唯一共同祖先，保留现场停止');
  const files = rev => runGit(j.targetRoot, ['diff', '--name-only', '--no-renames', '-z', base, rev, '--']).stdout.split('\0').filter(Boolean);
  const paths = validatePaths(j.targetRoot, [...files(ours), ...files(theirs)]);
  return { operation, base, ours, theirs, paths, conflictPaths: [], resolutionAttempts: 0, review: null };
}
export function conflictContext(j, context) {
  const conflictPaths = runGit(j.targetRoot, ['diff', '--name-only', '--diff-filter=U', '-z', '--']).stdout.split('\0').filter(Boolean);
  return { ...context, conflictPaths };
}
export function assertOperationScope(j, context) {
  assertContext(j, context);
  const status = readStatus(j.targetRoot);
  if (status.some(e => !context.paths.includes(e.path) || (e.originalPath && !context.paths.includes(e.originalPath)))) fail('resolution_scope_changed', '解决内容超出冻结操作范围，保留现场');
  validatePaths(j.targetRoot, context.paths);
  if (status.some(e => /U|AA|DD/.test(e.status))) fail('unresolved_conflicts', '仍有未解决冲突', { context: conflictContext(j, context) });
  if (status.some(e => e.status === '??' || e.status[1] !== ' ')) fail('unstaged_resolution', '必须明确暂存解决路径；脚本不自动暂存');
}
function assertContext(j, context) {
  const expected = operationContext(j, context.operation, context.ours, context.theirs);
  if (expected.base !== context.base || digest(expected.paths) !== digest(context.paths)) fail('operation_context_changed', '操作共同祖先或文件范围不匹配冻结提交');
}
function mergeCheckout(j, s, clean = false) {
  assertRemote(j);
  assertCheckout(j, true, clean, ['MERGE_HEAD']);
  if (j.mode === 'worktree') {
    assertCheckout(j, false);
    if (head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '同步期间源提交变化');
  }
  if (head(j.targetRoot) !== s.ours) fail('target_changed', '同步父提交变化');
  const m = optionalGit(j.targetRoot, ['rev-parse', '--verify', 'MERGE_HEAD']);
  if (m !== s.theirs) fail('merge_identity_changed', 'MERGE_HEAD 不匹配冻结远端提交');
}
function review(j, s) {
  mergeCheckout(j, s); assertOperationScope(j, s);
  const value = { operation: s.operation, base: s.base, ours: s.ours, theirs: s.theirs, paths: s.paths,
    tree: tree(j.targetRoot), diff: runGit(j.targetRoot, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--']).stdout };
  return { ...value, digest: digest(value) };
}
function finish(common, j, oid) {
  j.finalTargetOid = oid;
  if (!j.targetResult && j.mode === 'worktree') j.integrationBaseOid = oid;
  j.syncHistory.push({ operation: j.sync.operation, ours: j.sync.ours, theirs: j.sync.theirs, resultOid: oid, review: j.sync.review, evidence: j.sync.evidence });
  j.remoteState = { ...j.remoteState, targetOid: oid, relation: oid === j.remoteState.oid ? 'equal' : 'local-ahead',
    unpushedCommits: gitText(j.targetRoot, ['log', '--format=%H%x00%P%x00%s', `${j.remoteState.oid}..${oid}`, '--']),
    unpushedDiff: runGit(j.targetRoot, ['diff', '--binary', '--no-ext-diff', '--no-textconv', j.remoteState.oid, oid, '--']).stdout };
  j.phase = j.sync.returnPhase; j.sync = null; j.intent = null;
  return save(common, j);
}
function recoverMerge(j, s) {
  const oid = head(j.targetRoot);
  if (oid === s.ours) return null;
  assertRemote(j); assertCheckout(j, true);
  const message = runGit(j.targetRoot, ['cat-file', 'commit', oid]).stdout.split('\n\n').slice(1).join('\n\n');
  if (!s.review || gitText(j.targetRoot, ['show', '-s', '--format=%P', oid]) !== `${s.ours} ${s.theirs}` || gitText(j.targetRoot, ['rev-parse', `${oid}^{tree}`]) !== s.review.tree || message.replace(/\n?$/, '\n') !== s.message.replace(/\n?$/, '\n')) fail('sync_recovery_ambiguous', '同步提交父/树/消息不匹配，禁止重复合并');
  if (j.mode === 'worktree') { assertCheckout(j, false); if (head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '源提交变化'); }
  return oid;
}
/** Intent precedes merge. No stage/reset/rebase/abort; resolution is supplied by Pi/manual caller. */
export function syncStep(common, j, input, options = {}) {
  if (j.version !== 2) fail('new_authorization_required', 'v1 收据不授权远端同步；需要新授权且原收据保持不变');
  if (!j.input.push || !j.preview.resolution.remote || !['source_committed', 'target_committed', 'sync_pending'].includes(j.phase)) fail('sync_not_allowed', '当前状态不允许远端同步');
  if (input.allowFetch !== true) fail('fetch_authorization_required', '同步需要明确 fetch 授权');
  if (!j.sync) {
    if (!needsSync(j)) return j;
    if (j.intent) fail('pending_intent', '先恢复已有写入意图');
    assertRemote(j); assertCheckout(j, true);
    if (j.mode === 'worktree') { assertCheckout(j, false); if (head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '源变化'); }
    if (head(j.targetRoot) !== finalTip(j)) fail('target_changed', '目标变化');
    if (j.syncAttempts >= 3) fail('sync_attempts_exhausted', '同步最多 3 次，保留现场并停止');
    const context = operationContext(j, 'remote_merge', finalTip(j), j.remoteState.oid);
    j.sync = { ...context, returnPhase: j.phase, kind: ancestor(j.targetRoot, context.ours, context.theirs) ? 'ff' : 'merge', commitAttempts: 0, writeAttempts: 0, evidence: null, message: '同步远端交付变更\n' };
    j.syncAttempts++; j.phase = 'sync_pending'; j.intent = { kind: 'sync' }; j = save(common, j);
    options.fault?.('before_sync');
  }
  let s = j.sync;
  if (j.mode === 'worktree') { assertCheckout(j, false); if (head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '恢复同步前源变化'); }
  assertRemote(j); assertCheckout(j, true, false, s.kind === 'merge' ? ['MERGE_HEAD'] : []);
  assertContext(j, s);
  if ((s.kind === 'ff') !== ancestor(j.targetRoot, s.ours, s.theirs)) fail('sync_identity_changed', '同步类型不匹配冻结父提交');
  if (s.kind === 'ff') {
    assertRemote(j); assertCheckout(j, true);
    if (j.mode === 'worktree') { assertCheckout(j, false); if (head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '快进期间源变化'); }
    const actual = head(j.targetRoot);
    if (actual !== s.ours && actual !== s.theirs) fail('sync_recovery_ambiguous', '快进恢复目标变化');
    if (actual === s.ours) {
      if (s.writeAttempts >= 3) fail('sync_attempts_exhausted', '快进写入最多 3 次，保留现场停止');
      s.writeAttempts++; j = save(common, j);
      runGit(j.targetRoot, ['-c', 'merge.autoStash=false', '-c', `branch.${j.targetBranch}.mergeOptions=`, 'merge', '--ff-only', '--no-edit', s.theirs], { readOnly: false });
    }
    options.fault?.('after_sync_ff');
    assertCheckout(j, true); if (head(j.targetRoot) !== s.theirs) fail('target_changed', '快进结果变化');
    if (j.mode === 'worktree') { assertCheckout(j, false); if (head(j.sourceRoot) !== j.sourceResult.resultOid) fail('source_changed', '快进后源变化'); }
    return finish(common, j, s.theirs);
  }
  if (j.intent?.kind === 'sync_commit') {
    const recovered = recoverMerge(j, s);
    if (recovered) return finish(common, j, recovered);
    mergeCheckout(j, s); assertOperationScope(j, s);
    if (review(j, s).digest !== s.review.digest) fail('sync_recovery_ambiguous', '同步索引与提交意图不符');
    if (s.commitAttempts >= 3) fail('sync_attempts_exhausted', '同步提交最多 3 次，保留现场停止');
    s.commitAttempts++; j = save(common, j);
    const result = commitIndex(j.targetRoot, { expectedBranch: j.targetBranch, expectedParentOid: s.ours, expectedMergeParent: s.theirs, expectedTree: s.review.tree, paths: s.paths, internalMessage: s.message, expectedMessageDigest: digest(Buffer.from(s.message)) });
    options.fault?.('after_sync_commit');
    return finish(common, j, result.resultOid);
  }
  if (!optionalGit(j.targetRoot, ['rev-parse', '--verify', 'MERGE_HEAD'])) {
    assertRemote(j); assertCheckout(j, true);
    if (head(j.targetRoot) !== s.ours) fail('target_changed', '同步前目标变化');
    if (s.writeAttempts >= 3) fail('sync_attempts_exhausted', '合并写入最多 3 次，保留现场停止');
    s.writeAttempts++; j = save(common, j);
    runGit(j.targetRoot, ['-c', 'merge.autoStash=false', '-c', 'rerere.enabled=false', '-c', `branch.${j.targetBranch}.mergeOptions=`, 'merge', '--no-ff', '--no-commit', s.theirs], { readOnly: false, allowFailure: true });
    options.fault?.('after_sync_merge');
  }
  mergeCheckout(j, s);
  s = conflictContext(j, s); j.sync = s;
  if (s.conflictPaths.length) {
    if (readStatus(j.targetRoot).some(e => !s.paths.includes(e.path) || (e.originalPath && !s.paths.includes(e.originalPath)))) fail('resolution_scope_changed', '冲突现场存在范围外变更，保留现场');
    if (s.resolutionAttempts >= 3) fail('resolution_attempts_exhausted', '冲突解决最多 3 次，保留现场停止', { context: s });
    s.resolutionAttempts++; return save(common, j);
  }
  const r = review(j, s);
  if (!s.review || r.digest !== s.review.digest) {
    if (s.review) {
      if (s.resolutionAttempts >= 3) fail('resolution_attempts_exhausted', '最终树修改最多 3 次，保留现场停止');
      s.resolutionAttempts++;
    }
    j.sync.review = r; j.sync.evidence = null; return save(common, j);
  }
  const e = input.evidence;
  if (!e || e.tree !== r.tree) fail('evidence_required', '同步最终树需要新验证证据与摘要确认');
  if ((j.preview.config.checks ?? []).some(command => !e.checks.some(c => c.command === command))) fail('checks_missing', '缺少同步最终树验证证据');
  j.sync.evidence = e; j.intent = { kind: 'sync_commit' }; j = save(common, j);
  options.fault?.('before_sync_commit');
  return syncStep(common, j, input, options);
}
