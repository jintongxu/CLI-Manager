import { mkdirSync, lstatSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, fail } from './git-run.mjs';
import { validateInput } from './delivery-protocol.mjs';

const phases = new Set(['prepared', 'source_committed', 'squash_pending', 'target_committed', 'push_pending', 'pushed', 'complete', 'blocked', 'sync_pending']);
const keys = new Set(['version', 'id', 'revision', 'phase', 'identity', 'sourceRoot', 'targetRoot', 'sourceBranch', 'targetBranch', 'mode', 'input', 'preview', 'sourceOid', 'targetOid', 'sourceResult', 'targetResult', 'intent', 'remoteState', 'squash', 'evidence', 'createdAt', 'updatedAt', 'sync', 'syncAttempts', 'pushAttempts', 'syncHistory', 'integrationBaseOid', 'finalTargetOid', 'operationContext']);
export function journalDirectory(commonDir, create = false) {
  const dir = path.join(commonDir, 'pi-delivery');
  if (create) { try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  try { const stat = lstatSync(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_journal', '交付目录必须是普通目录'); }
  catch (e) { if (e.code === 'ENOENT' && !create) return dir; throw e; }
  return dir;
}
function filename(commonDir, id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) fail('invalid_id', '交付 id 无效');
  return path.join(journalDirectory(commonDir), `${id}.json`);
}
export function validateJournal(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j) || Object.keys(j).some(k => !keys.has(k)) || ![1, 2].includes(j.version) || !phases.has(j.phase) || !Number.isSafeInteger(j.revision) || j.revision < 1 || !/^[a-f0-9-]{36}$/.test(j.id ?? '') || !j.preview || j.preview.version !== j.version || !j.input || !j.identity || !j.sourceRoot || !j.targetRoot) fail('invalid_journal', '不支持或损坏的交付收据');
  const exact = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
  const oid = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!['primary', 'worktree'].includes(j.mode) ||
      !hash(j.identity) ||
      !oid(j.sourceOid) ||
      !oid(j.targetOid) ||
      typeof j.sourceBranch !== 'string' ||
      typeof j.targetBranch !== 'string' ||
      !path.isAbsolute(j.sourceRoot) ||
      !path.isAbsolute(j.targetRoot) ||
      !exact(j.input, ['targetBranch', 'remote', 'remoteBranch', 'paths', 'push', 'message', 'messageFile', 'messageDigest', 'targetMessageFile', 'targetMessageDigest', 'targetMessage']) ||
      !Array.isArray(j.input.paths) ||
      j.input.paths.some(p => typeof p !== 'string') ||
      typeof j.input.push !== 'boolean' ||
      !hash(j.input.messageDigest) ||
      !hash(j.input.targetMessageDigest) ||
      typeof j.input.message !== 'string' ||
      typeof j.input.targetMessage !== 'string' ||
      !path.isAbsolute(j.input.messageFile ?? '') ||
      !path.isAbsolute(j.input.targetMessageFile ?? '')) fail('invalid_journal', '收据身份或冻结输入 schema 无效');
  if (j.version === 1 && (['sync', 'syncAttempts', 'pushAttempts', 'syncHistory', 'integrationBaseOid', 'finalTargetOid', 'operationContext'].some(k => k in j) || j.phase === 'sync_pending')) fail('invalid_journal', 'v1 不允许扩展同步授权');
  const contextValid = c => exact(c, ['operation', 'base', 'ours', 'theirs', 'paths', 'conflictPaths', 'review', 'returnPhase', 'kind', 'message', 'resolutionAttempts', 'commitAttempts', 'writeAttempts', 'evidence']) &&
    Number.isInteger(c.resolutionAttempts) && c.resolutionAttempts >= 0 && c.resolutionAttempts <= 3 &&
    ['remote_merge', 'squash'].includes(c.operation) && oid(c.base) && oid(c.ours) && oid(c.theirs) &&
    Array.isArray(c.paths) && c.paths.every(p => typeof p === 'string') &&
    Array.isArray(c.conflictPaths) && c.conflictPaths.every(p => c.paths.includes(p));
  if (j.version === 2) {
    if (!Number.isInteger(j.syncAttempts) || j.syncAttempts < 0 || j.syncAttempts > 3 || !Number.isInteger(j.pushAttempts) || j.pushAttempts < 0 || j.pushAttempts > 3 || !Array.isArray(j.syncHistory) || (j.integrationBaseOid !== null && !oid(j.integrationBaseOid)) || (j.finalTargetOid !== null && !oid(j.finalTargetOid))) fail('invalid_journal', '同步计数/基线无效');
    if (j.sync !== null && (!contextValid(j.sync) || j.sync.operation !== 'remote_merge' || !['ff', 'merge'].includes(j.sync.kind) ||
      !Number.isInteger(j.sync.commitAttempts) || j.sync.commitAttempts < 0 || j.sync.commitAttempts > 3 ||
      !Number.isInteger(j.sync.writeAttempts) || j.sync.writeAttempts < 0 || j.sync.writeAttempts > 3 ||
      !['source_committed', 'target_committed'].includes(j.sync.returnPhase) || j.sync.message !== '同步远端交付变更\n' || j.phase !== 'sync_pending')) fail('invalid_journal', '同步上下文无效');
    if (j.sync && (j.sync.ours !== (j.finalTargetOid ?? j.targetResult?.resultOid ?? j.integrationBaseOid ?? j.targetOid) || j.sync.theirs !== j.remoteState?.oid || (j.sync.returnPhase === 'source_committed' && (j.mode !== 'worktree' || j.targetResult !== null)))) fail('invalid_journal', '同步父提交必须绑定目标基线和冻结远端');
    if (j.remoteState && !['equal', 'local-ahead', 'remote-ahead', 'diverged', 'missing'].includes(j.remoteState.relation)) fail('invalid_journal', '远端关系无效');
    if (j.operationContext !== null && (!contextValid(j.operationContext) || j.operationContext.operation !== 'squash')) fail('invalid_journal', 'squash 上下文无效');
    if (j.sync?.evidence !== null && j.sync?.evidence !== undefined) validateInput('sync', { evidence: j.sync.evidence });
    for (const entry of j.syncHistory) {
      if (!exact(entry, ['operation', 'ours', 'theirs', 'resultOid', 'review', 'evidence']) || entry.operation !== 'remote_merge' || !oid(entry.ours) || !oid(entry.theirs) || !oid(entry.resultOid)) fail('invalid_journal', '同步历史 schema 无效');
      if (entry.evidence !== null) validateInput('sync', { evidence: entry.evidence });
    }
    if (j.sync?.review) {
      const r = j.sync.review;
      if (!exact(r, ['operation', 'base', 'ours', 'theirs', 'paths', 'tree', 'diff', 'digest']) || !oid(r.tree) || !hash(r.digest) || r.operation !== j.sync.operation || r.base !== j.sync.base || r.ours !== j.sync.ours || r.theirs !== j.sync.theirs || digest(r.paths) !== digest(j.sync.paths) || typeof r.diff !== 'string') fail('invalid_journal', '同步最终树预览无效');
      const { digest: expected, ...value } = r; if (digest(value) !== expected) fail('invalid_journal', '同步预览摘要无效');
    }
  }
  const intentFields = {
    ...(j.version === 2 ? { sync: ['kind'], sync_commit: ['kind'] } : {}),
    stage: ['kind', 'parent', 'paths', 'previewDigest'],
    source_commit: ['kind', 'root', 'parent', 'tree', 'paths', 'message', 'messageDigest', 'commitAttempts'],
    target_commit: ['kind', 'root', 'parent', 'tree', 'paths', 'message', 'messageDigest', 'commitAttempts'],
    squash: ['kind', 'source', 'parent'], fetch: ['kind'], push_fetch: ['kind'],
    push: ['kind', 'oid', 'remote', 'refspec', 'remoteDigest', 'remoteOid'],
  };
  if (j.intent !== null) {
    if (!intentFields[j.intent?.kind] || !exact(j.intent, intentFields[j.intent.kind])) fail('invalid_journal', '未知写入意图 schema');
    if (['source_commit', 'target_commit'].includes(j.intent.kind)) {
      const target = j.intent.kind === 'target_commit';
      if ('commitAttempts' in j.intent && (!Number.isInteger(j.intent.commitAttempts) || j.intent.commitAttempts < 0 || j.intent.commitAttempts > 3)) fail('invalid_journal', '提交尝试计数无效');
      if (!oid(j.intent.parent) || !oid(j.intent.tree) || !hash(j.intent.messageDigest) || !Array.isArray(j.intent.paths) || j.intent.paths.some(p => typeof p !== 'string') || typeof j.intent.message !== 'string' ||
          j.intent.root !== (target ? j.targetRoot : j.sourceRoot) || j.intent.parent !== (target ? (j.integrationBaseOid ?? j.targetOid) : j.sourceOid)) fail('invalid_journal', '提交恢复意图必须绑定冻结工作区和父 OID');
    }
  }
  for (const result of [j.sourceResult, j.targetResult]) if (result !== null && (!exact(result, ['resultOid', 'parentOid', 'tree', 'messageDigest', 'clean', 'existing']) || !oid(result.resultOid) || !oid(result.tree))) fail('invalid_journal', '提交结果 schema 无效');
  if (j.squash !== null && (!exact(j.squash, ['parent', 'sourceOid', 'tree', 'paths', 'diff', 'digest']) || !oid(j.squash.parent) || !oid(j.squash.sourceOid) || !oid(j.squash.tree) || !hash(j.squash.digest) || !Array.isArray(j.squash.paths) || typeof j.squash.diff !== 'string')) fail('invalid_journal', '最终树预览 schema 无效');
  if (j.remoteState !== null && (!exact(j.remoteState, ['oid', 'ref', 'remote', 'targetOid', 'unpushedCommits', 'unpushedDiff', ...(j.version === 2 ? ['relation'] : [])]) || (j.remoteState.oid !== null && !oid(j.remoteState.oid)) || !oid(j.remoteState.targetOid))) fail('invalid_journal', '远端历史 schema 无效');
  if (j.intent && ['sync', 'sync_commit'].includes(j.intent.kind) && (!j.sync || (j.intent.kind === 'sync_commit' && (!j.sync.review || !j.sync.evidence || j.sync.evidence.tree !== j.sync.review.tree)))) fail('invalid_journal', '同步意图缺少冻结上下文');
  return j;
}
export function readJournal(commonDir, id) {
  const file = filename(commonDir, id);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) fail('unsafe_journal', '收据必须是有限普通文件');
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { fail('invalid_journal', '收据不是有效 JSON'); }
  return validateJournal(j);
}
export function listJournals(commonDir) {
  const dir = journalDirectory(commonDir);
  try { return readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => readJournal(commonDir, n.slice(0, -5))); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
/** Lock is never stolen, including stale locks. Human inspection is required after a crash. */
export function withDeliveryLock(commonDir, operation) {
  const dir = journalDirectory(commonDir, true); const lock = path.join(dir, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') fail('delivery_locked', '同仓库交付锁已存在；包括陈旧锁均不自动抢占'); throw e; }
  try { writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); return operation(); }
  finally { unlinkSync(path.join(lock, 'owner.json')); rmdirSync(lock); }
}
/** Same-directory atomic replacement; intent is durable before any Git mutation. */
export function writeJournal(commonDir, journal) {
  journalDirectory(commonDir, true);
  const j = validateJournal({ ...journal, revision: (journal.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
  const file = filename(commonDir, j.id); const tmp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try { fd = openSync(tmp, 'wx', 0o600); writeFileSync(fd, JSON.stringify(j, null, 2) + '\n', 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(tmp, file); }
  finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  // Directory fsync is unsupported on Windows; file fsync + atomic rename still apply there.
  if (process.platform !== 'win32') { const d = openSync(path.dirname(file), 'r'); try { fsyncSync(d); } finally { closeSync(d); } }
  return j;
}
export function journalDigest(j) { return digest(j); }
export { randomUUID as newDeliveryId };
