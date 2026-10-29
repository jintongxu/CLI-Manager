import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { digest, fail, gitText, runGit } from './git-run.mjs';
import { repositoryContext, readStatus, activeGitOperations } from './git-state.mjs';
import { validateMessage } from './git-commit.mjs';

const base = ['targetBranch', 'remote', 'remoteBranch', 'paths', 'messageFile', 'targetMessageFile', 'push'];
const extra = { inspect: [], prepare: ['expectedPreviewDigest', 'confirmation', 'allowFetch'], commit: ['confirmation'], integrate: ['confirmation', 'evidence'], push: ['confirmation', 'allowFetch'], sync: ['confirmation', 'allowFetch', 'evidence'], resume: ['confirmation', 'allowFetch', 'evidence'], status: [] };
export function validateInput(action, input = {}) {
  if (!extra[action] || !input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_input', '输入必须为已知操作的 JSON 对象');
  const allowed = action === 'inspect' || action === 'prepare' ? [...base, ...extra[action]] : extra[action];
  if (Object.keys(input).some(k => !allowed.includes(k))) fail('unknown_field', 'JSON 包含未知字段');
  for (const k of ['targetBranch', 'remote', 'remoteBranch', 'messageFile', 'targetMessageFile', 'expectedPreviewDigest', 'confirmation']) if (k in input && (typeof input[k] !== 'string' || !input[k])) fail('invalid_input', '文本字段无效');
  for (const k of ['push', 'allowFetch']) if (k in input && typeof input[k] !== 'boolean') fail('invalid_input', '授权必须为布尔值');
  if ('paths' in input && (!Array.isArray(input.paths) || input.paths.some(p => typeof p !== 'string'))) fail('invalid_input', 'paths 必须为文本列表');
  if ('evidence' in input) {
    const e = input.evidence;
    if (!e ||
      typeof e !== 'object' ||
      Array.isArray(e) ||
      Object.keys(e).some(k => !['tree', 'checks', 'attestation'].includes(k)) ||
      !/^[a-f0-9]{40,64}$/.test(e.tree ?? '') ||
      e.attestation !== 'user-confirmed' ||
      !Array.isArray(e.checks) ||
      !e.checks.length ||
      e.checks.some(c => !c ||
      Object.keys(c).some(k => !['command', 'result', 'outputDigest'].includes(k)) ||
      typeof c.command !== 'string' ||
      !c.command.trim() ||
      c.result !== 'pass' ||
      !/^[a-f0-9]{64}$/.test(c.outputDigest ?? ''))) fail('invalid_evidence', '验证证据需包含实际树、命令、通过结果、输出摘要及用户确认；脚本不执行命令');
  }
  return input;
}
export function externalMessage(root, filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('invalid_message_file', '需要外部绝对路径 UTF-8 消息文件');
  const s = lstatSync(filename); const real = realpathSync.native(filename); const rel = path.relative(root, real);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 65536 || (!rel.startsWith('..') && !path.isAbsolute(rel))) fail('invalid_message_file', '消息文件必须是 checkout 外的普通文件');
  const bytes = readFileSync(real); const text = validateMessage(bytes.toString('utf8'));
  if (!bytes.equals(Buffer.from(text))) fail('invalid_message_file', '消息不是有效 UTF-8');
  return { file: real, text, digest: digest(bytes) };
}
export function frozenInput(cwd, input) {
  const root = repositoryContext(cwd).root;
  const message = externalMessage(root, input.messageFile);
  const targetMessage = externalMessage(root, input.targetMessageFile ?? input.messageFile);
  return Object.fromEntries(Object.entries({ targetBranch: input.targetBranch, remote: input.remote, remoteBranch: input.remoteBranch, paths: input.paths ?? [], push: input.push, message: message.text,
    messageFile: message.file, messageDigest: message.digest, targetMessageFile: targetMessage.file, targetMessageDigest: targetMessage.digest, targetMessage: targetMessage.text }).filter(([, value]) => value !== undefined));
}
export function head(root) { return gitText(root, ['rev-parse', 'HEAD']); }
export function tree(root) { return gitText(root, ['write-tree'], { readOnly: false }); }
export function assertCheckout(j, target = false, clean = true, allowedOperations = []) {
  const root = target ? j.targetRoot : j.sourceRoot; const c = repositoryContext(root);
  if (c.root !== realpathSync.native(root) || c.identity !== j.identity || c.branch !== (target ? j.targetBranch : j.sourceBranch)) fail('identity_changed', '仓库身份或检出分支已变化');
  if (activeGitOperations(root).some(op => !allowedOperations.includes(op))) fail('git_operation', '存在活动 Git 操作，保留现场停止');
  const flags = runGit(root, ['ls-files', '-v', '-z']).stdout.split('\0').filter(Boolean);
  const entries = runGit(root, ['ls-files', '--stage', '-z']).stdout.split('\0');
  if (flags.some(line => line[0] === 'S' || /[a-z]/.test(line[0])) || entries.some(line => line.startsWith('160000 '))) fail('unsupported_index', '拒绝 skip-worktree/assume-unchanged/gitlink 索引');
  if (clean && readStatus(root).length) fail('dirty_checkout', '工作区或索引不干净，保留现场停止');
  return c;
}
export function confirmation(input, expected) { if (!input.confirmation || input.confirmation !== expected) fail('confirmation_required', '需要针对当前摘要的显式确认', { expectedConfirmation: expected }); }
export function changedPaths(root) { return runGit(root, ['diff', '--cached', '--name-only', '--no-renames', '-z', '--']).stdout.split('\0').filter(Boolean); }
/** Use the bound checkout, never an arbitrary path supplied by a receipt. */
export function commitIntentRoot(j, intent) {
  if (!intent || !['source_commit', 'target_commit'].includes(intent.kind)) fail('invalid_journal', '不是提交恢复意图');
  const target = intent.kind === 'target_commit'; const root = target ? j.targetRoot : j.sourceRoot;
  if (intent.root !== root || intent.parent !== (target ? (j.integrationBaseOid ?? j.targetOid) : j.sourceOid)) fail('invalid_journal', '提交意图与冻结工作区或父 OID 不符');
  assertCheckout(j, target, false);
  return root;
}
/** Resolution provenance is informative; only the concrete destination is frozen. */
export function resolutionBinding(resolution) {
  const { targetResolution, ...binding } = resolution;
  return binding;
}
export function recoverCommit(j, intent) {
  const root = commitIntentRoot(j, intent); const actual = head(root);
  if (actual === intent.parent) return null;
  const parent = gitText(root, ['show', '-s', '--format=%P', actual]);
  const actualTree = gitText(root, ['rev-parse', `${actual}^{tree}`]);
  const message = runGit(root, ['cat-file', 'commit', actual]).stdout.split('\n\n').slice(1).join('\n\n');
  const normalize = s => s.replace(/\n?$/, '\n');
  if (parent !== intent.parent || actualTree !== intent.tree || normalize(message) !== normalize(intent.message)) fail('commit_recovery_ambiguous', '提交后收据缺失且父/树/消息不匹配，禁止重复提交');
  assertCheckout(j, intent.kind === 'target_commit');
  return { resultOid: actual, parentOid: parent, tree: actualTree, messageDigest: intent.messageDigest, clean: true };
}
