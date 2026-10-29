import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { inspectDelivery, activeGitOperations, readStatus, validatePaths, repositoryContext } from './git-state.mjs';
import { runGit, gitText, digest, fail } from './git-run.mjs';

export function validateMessage(message) {
  if (typeof message !== 'string' || !message.trim() || !/[\u3400-\u9fff]/u.test(message) || /\0/.test(message) || Buffer.byteLength(message) > 65536 || message.includes('\ufffd')) fail('invalid_message', '提交消息必须为包含中文的有效 UTF-8 文本');
  return message;
}
function assertParent(cwd, expectedParentOid) {
  if (!/^[0-9a-f]{40,64}$/.test(expectedParentOid ?? '') || gitText(cwd, ['rev-parse', 'HEAD']) !== expectedParentOid) fail('parent_changed', '父提交已变化，请重新预览确认');
}
/** Stage ONLY confirmed literal file paths. No stage-all. Caller must hold common-dir delivery lock.
 * Returns {tree,parentOid,paths,previewDigest}; never creates a commit or resets on failure.
 */
export function stageSelectedPaths(cwd, { input = {}, expectedPreviewDigest } = {}) {
  const preview = inspectDelivery(cwd, input);
  if (!expectedPreviewDigest || preview.digest !== expectedPreviewDigest) fail('preview_changed', '预览已变化，请重新确认');
  if (!preview.state.ready || !preview.scope.paths.length) fail('scope_blocked', '范围或工作区状态不允许暂存', { blockers: preview.state.blockers });
  assertParent(cwd, preview.context.sourceOid);
  runGit(preview.context.root, ['add', '--', ...preview.scope.paths], { readOnly: false });
  const tree = gitText(cwd, ['write-tree'], { readOnly: false });
  assertParent(cwd, preview.context.sourceOid);
  if (readStatus(cwd).some(e => !preview.scope.paths.includes(e.path) || (e.originalPath && !preview.scope.paths.includes(e.originalPath)))) fail('scope_changed', '暂存后发现范围外变更，保留现场并停止');
  return { tree, parentOid: preview.context.sourceOid, paths: preview.scope.paths, previewDigest: preview.digest };
}
/** Low-level normal-hook commit primitive. Caller persists intent + owns delivery lock first.
 * Required: expectedParentOid, expectedTree, messageFile (outside checkout), expectedMessageDigest,
 * paths (exact allowed tracked files), expectedBranch (short name).
 * Does NOT stage, push, amend, reset or retry. Failure may be post-commit: details.resultOid is authoritative.
 */
export function commitIndex(cwd, { expectedParentOid, expectedTree, messageFile, expectedMessageDigest, paths, expectedBranch, expectedMergeParent, internalMessage } = {}) {
  const context = repositoryContext(cwd);
  if (!expectedBranch || context.branch !== expectedBranch) fail('branch_changed', '检出分支已变化');
  assertParent(cwd, expectedParentOid);
  const expectedParents = expectedMergeParent ? `${expectedParentOid} ${expectedMergeParent}` : expectedParentOid;
  const assertMerge = () => {
    const operations = activeGitOperations(cwd);
    if (expectedMergeParent) {
      if (operations.some(op => op !== 'MERGE_HEAD') || !operations.includes('MERGE_HEAD') || gitText(cwd, ['rev-parse', 'MERGE_HEAD']) !== expectedMergeParent) fail('merge_identity_changed', '合并父提交或操作已变化');
    } else if (operations.length) fail('git_operation', '存在活动 Git 操作，不能提交');
  };
  assertMerge();
  const allowed = validatePaths(context.root, paths);
  if (!allowed.length && !expectedMergeParent) fail('scope_required', '提交必须有明确文件范围');
  if (!/^[0-9a-f]{40,64}$/.test(expectedTree ?? '')) fail('invalid_tree', '缺少预期树');
  if (gitText(cwd, ['write-tree'], { readOnly: false }) !== expectedTree) fail('tree_changed', '索引树已变化，请重新确认');
  if (!expectedMergeParent && gitText(cwd, ['rev-parse', `${expectedParentOid}^{tree}`]) === expectedTree) fail('empty_commit', '没有可提交变更');
  const changed = runGit(cwd, ['diff', '--cached', '--name-only', '--no-renames', '-z', '--']).stdout.split('\0').filter(Boolean);
  if (changed.some(p => !allowed.includes(p)) || readStatus(cwd).some(e => !allowed.includes(e.path) || (e.originalPath && !allowed.includes(e.originalPath)))) fail('unrelated_changes', '存在范围外索引或工作区变更');
  let message;
  if (internalMessage !== undefined) {
    message = validateMessage(internalMessage);
    if (digest(Buffer.from(message)) !== expectedMessageDigest) fail('message_changed', '内部同步消息摘要变化');
  } else {
    if (typeof messageFile !== 'string' || !path.isAbsolute(messageFile) || !lstatSync(messageFile).isFile() || lstatSync(messageFile).isSymbolicLink()) fail('invalid_message_file', '消息必须为外部普通 UTF-8 文件');
    const messagePath = realpathSync.native(messageFile);
    const relative = path.relative(context.root, messagePath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) fail('invalid_message_file', '消息文件不能位于提交工作区内');
    const bytes = readFileSync(messagePath);
    message = validateMessage(bytes.toString('utf8'));
    if (!bytes.equals(Buffer.from(message, 'utf8')) || !expectedMessageDigest || digest(bytes) !== expectedMessageDigest) fail('message_changed', '消息文件编码或摘要不匹配');
  }
  // Revalidate immediately before Git; native hooks run normally (no --no-verify).
  assertParent(cwd, expectedParentOid);
  assertMerge();
  const result = runGit(cwd, ['-c', 'i18n.commitEncoding=UTF-8', 'commit', '--cleanup=verbatim', '-F', '-'], { readOnly: false, allowFailure: true, input: message });
  const resultOid = gitText(cwd, ['rev-parse', 'HEAD']);
  if (resultOid === expectedParentOid) fail('commit_failed', '提交未完成；保留索引现场，请检查 hooks', { status: result.status });
  const parents = gitText(cwd, ['show', '-s', '--format=%P', resultOid]);
  const tree = gitText(cwd, ['rev-parse', `${resultOid}^{tree}`]);
  const actualMessage = runGit(cwd, ['cat-file', 'commit', resultOid]).stdout.split('\n\n').slice(1).join('\n\n');
  const normalize = s => s.replace(/\n?$/, '\n');
  const clean = readStatus(cwd).length === 0;
  if (result.status !== 0 || parents !== expectedParents || tree !== expectedTree || normalize(actualMessage) !== normalize(message) || !clean || repositoryContext(cwd).branch !== expectedBranch || activeGitOperations(cwd).length) fail('commit_requires_review', '提交可能已创建，但 hooks 或并发操作改变了确认状态；禁止自动继续或重复提交', { resultOid, tree, expectedTree, clean });
  return { resultOid, parentOid: expectedParentOid, tree, messageDigest: expectedMessageDigest, clean: true };
}
/** Main-branch-only wrapper; staging is deliberately a separate intent boundary. */
export function commitPrimary(cwd, options = {}) {
  const preview = inspectDelivery(cwd, options.input ?? {});
  if (!options.expectedPreviewDigest || preview.digest !== options.expectedPreviewDigest) fail('preview_changed', '预览已变化，请重新确认');
  if (preview.context.mode !== 'primary' || !preview.state.ready) fail('primary_blocked', '当前不是可提交的目标主分支');
  if (options.expectedParentOid !== preview.context.sourceOid) fail('parent_changed', '父提交不匹配');
  return commitIndex(cwd, { ...options, paths: preview.scope.paths, expectedBranch: preview.context.branch });
}
