import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectDelivery, prepareDelivery, commitDelivery, integrateDelivery, pushDelivery, statusDelivery, resumeDelivery } from '../.pi/skills/deliver/scripts/delivery.mjs';
import { repositoryContext } from '../.pi/skills/deliver/scripts/git-state.mjs';
import { digest } from '../.pi/skills/deliver/scripts/git-run.mjs';
import { recoverCommit } from '../.pi/skills/deliver/scripts/delivery-protocol.mjs';
import { withDeliveryLock, readJournal, writeJournal } from '../.pi/skills/deliver/scripts/journal.mjs';
const cli = path.resolve('.pi/skills/deliver/scripts/deliver.mjs');
function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(cwd, 'nonexistent-global'), GIT_CONFIG_NOSYSTEM: '1' } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function fixture(t, { linked = true, remote = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'delivery-flow-')); const root = path.join(dir, 'repo'); mkdirSync(root);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(root, 'init', '-b', 'trunk'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', '测试'); git(root, 'config', 'core.autocrlf', 'false'); git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(root, 'a.txt'), 'base\n'); writeFileSync(path.join(root, 'b.txt'), 'base\n'); git(root, 'add', '--', 'a.txt', 'b.txt'); git(root, 'commit', '-m', '初始');
  const bare = path.join(dir, 'remote.git');
  if (remote) { mkdirSync(bare); git(bare, 'init', '--bare'); git(root, 'remote', 'add', 'publish', bare); git(root, 'push', '-u', 'publish', 'HEAD:refs/heads/trunk'); }
  const source = linked ? path.join(dir, 'task 空格') : root;
  if (linked) git(root, 'worktree', 'add', '-b', 'task', source);
  const messageFile = path.join(dir, '消息.txt'); writeFileSync(messageFile, '修复中文任务 $(not-shell)\n');
  const input = { targetBranch: 'trunk', paths: ['a.txt'], messageFile, push: linked && remote, ...(remote ? { remote: 'publish', remoteBranch: 'trunk' } : {}) };
  writeFileSync(path.join(source, 'a.txt'), 'task\n'); return { dir, root, source, bare, input };
}
function prep(f, options) { const p = inspectDelivery(f.source, f.input); return prepareDelivery(f.source, { ...f.input, expectedPreviewDigest: p.digest, confirmation: p.digest, allowFetch: true }, options); }
function commit(f, j, options) { return commitDelivery(f.source, j.id, { confirmation: j.confirmation }, options); }
function integrate(f, j, options) { return integrateDelivery(f.source, j.id, { confirmation: j.confirmation }, options); }
function finalCommit(f, j, options) { return integrateDelivery(f.source, j.id, { confirmation: j.confirmation, evidence: { tree: j.squash.tree, attestation: 'user-confirmed', checks: [{ command: 'test relevant tree', result: 'pass', outputDigest: digest('fixture verified') }] } }, options); }
function resume(f, j, options) { return resumeDelivery(f.source, j.id, { confirmation: j.confirmation, allowFetch: true }, options); }
function push(f, j, options) { return pushDelivery(f.source, j.id, { confirmation: j.confirmation, allowFetch: true }, options); }
function faultAt(point) { return { fault(p) { if (p === point) throw new Error(`injected ${point}`); } }; }
function status(f, id) { return statusDelivery(f.source, id); }

test('主分支只提交、inspect/status只读、中文消息、重复resume幂等', t => {
  const f = fixture(t, { linked: false }); const index = path.join(f.root, '.git/index'); const before = readFileSync(index);
  assert.equal(inspectDelivery(f.source, { targetBranch: 'trunk' }).context.mode, 'primary');
  inspectDelivery(f.source, f.input); assert.equal(existsSync(path.join(f.root, '.git/pi-delivery')), false); assert.deepEqual(readFileSync(index), before);
  let j = prep(f); const file = path.join(f.root, '.git/pi-delivery', `${j.id}.json`); const bytes = readFileSync(file); status(f, j.id); assert.deepEqual(bytes, readFileSync(file));
  j = commit(f, j); assert.equal(j.phase, 'complete'); assert.equal(git(f.root, 'log', '-1', '--format=%B'), '修复中文任务 $(not-shell)'); assert.equal(resume(f, j).sourceResult.resultOid, j.sourceResult.resultOid);
});
test('linked多源提交->一个squash->明确refspec bare push；保留源，拒绝已交付源新历史', t => {
  const f = fixture(t, { remote: true }); git(f.source, 'add', 'a.txt'); git(f.source, 'commit', '-m', '第一源提交'); writeFileSync(path.join(f.source, 'a.txt'), 'second\n');
  const old = git(f.root, 'rev-parse', 'HEAD'); let j = commit(f, prep(f)); const source = j.sourceResult.resultOid; j = integrate(f, j);
  assert.equal(j.requiresFinalConfirmation, true); assert.equal(git(f.root, 'rev-parse', 'HEAD'), old); assert.throws(() => integrate(f, j), e => e.code === 'evidence_required');
  j = finalCommit(f, j); assert.equal(git(f.root, 'rev-list', '--count', `${old}..HEAD`), '1'); assert.equal(git(f.root, 'show', 'HEAD:a.txt'), 'second');
  j = push(f, j); assert.equal(j.requiresPushConfirmation, true); assert.ok(j.remoteState.unpushedCommits.includes(j.targetResult.resultOid)); j = push(f, j);
  assert.equal(j.phase, 'pushed'); assert.equal(git(f.bare, 'rev-parse', 'refs/heads/trunk'), j.targetResult.resultOid); assert.equal(git(f.source, 'rev-parse', 'HEAD'), source); assert.ok(existsSync(f.source)); assert.equal(resume(f, j).phase, 'pushed');
  writeFileSync(path.join(f.source, 'a.txt'), 'new'); assert.throws(() => prep(f), e => e.code === 'source_already_delivered');
});
test('no remote本地完成；最终树变化须重新确认/验证，越界拒绝', t => {
  const f = fixture(t); let j = integrate(f, commit(f, prep(f))); writeFileSync(path.join(f.root, 'b.txt'), 'manual'); git(f.root, 'add', 'b.txt');
  assert.throws(() => finalCommit(f, j), e => e.code === 'resolution_scope_changed');
  git(f.root, 'restore', '--staged', '--worktree', 'b.txt');
  writeFileSync(path.join(f.root, 'a.txt'), 'manual'); git(f.root, 'add', 'a.txt');
  const updated = finalCommit(f, j); assert.equal(updated.requiresFinalConfirmation, true); assert.notEqual(updated.squash.digest, j.squash.digest); j = finalCommit(f, updated); assert.equal(j.phase, 'complete');
});
test('dirty/staged/refs/message变化阻断且不清理', t => {
  const f = fixture(t); const j = prep(f); writeFileSync(path.join(f.source, 'a.txt'), 'again'); assert.throws(() => commit(f, j), e => e.code === 'scope_changed');
  writeFileSync(path.join(f.root, 'b.txt'), 'dirty'); assert.ok(inspectDelivery(f.source, f.input).state.blockers.includes('target_dirty'));
  writeFileSync(path.join(f.source, 'b.txt'), 'unrelated'); git(f.source, 'add', 'b.txt'); assert.ok(inspectDelivery(f.source, f.input).state.blockers.includes('unrelated_changes')); assert.equal(git(f.source, 'diff', '--cached', '--name-only'), 'b.txt');
  writeFileSync(f.input.messageFile, '消息变化'); assert.throws(() => commit(f, j), e => e.code === 'message_changed');
});
test('hooks篡改tree后充分恢复证明失败，禁止重复提交', t => {
  const f = fixture(t); let j = prep(f); writeFileSync(path.join(f.root, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf hook > b.txt\ngit add -- b.txt\n', { mode: 0o755 });
  assert.throws(() => commit(f, j), e => e.code === 'commit_requires_review'); j = status(f, j.id); const oid = git(f.source, 'rev-parse', 'HEAD'); assert.throws(() => resume(f, j), e => e.code === 'commit_recovery_ambiguous'); assert.equal(git(f.source, 'rev-parse', 'HEAD'), oid);
});
for (const target of [false, true]) test(`${target ? 'target' : 'source'} commit后receipt丢失：parent/tree/message/clean核验恢复`, t => {
  const f = fixture(t); let j = target ? integrate(f, commit(f, prep(f))) : prep(f);
  assert.throws(() => target ? finalCommit(f, j, faultAt('after_target_commit')) : commit(f, j, faultAt('after_source_commit')), /injected/);
  const oid = git(target ? f.root : f.source, 'rev-parse', 'HEAD'); j = resume(f, status(f, j.id)); assert.equal((target ? j.targetResult : j.sourceResult).resultOid, oid); assert.equal(resume(f, j).phase, j.phase);
});
for (const descendant of [false, true]) test(`push响应丢失${descendant ? '+远端新后代' : ''}：包含关系证明不重复commit`, t => {
  const f = fixture(t, { remote: true }); let j = push(f, finalCommit(f, integrate(f, commit(f, prep(f))))); assert.throws(() => push(f, j, faultAt('after_push')), /injected/);
  const oid = git(f.root, 'rev-parse', 'HEAD');
  if (descendant) { const other = path.join(f.dir, 'other'); git(f.dir, 'clone', '--branch', 'trunk', f.bare, other); git(other, 'config', 'user.email', 'test@example.invalid'); git(other, 'config', 'user.name', '测试'); writeFileSync(path.join(other, 'b.txt'), 'later'); git(other, 'add', 'b.txt'); git(other, 'commit', '-m', '远端后代'); git(other, 'push', 'origin', 'HEAD:refs/heads/trunk'); }
  j = resume(f, status(f, j.id)); assert.equal(j.phase, 'pushed'); assert.equal(j.targetResult.resultOid, oid); assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), '2');
});
test('push拒绝保留intent，核验后新确认再重试', t => {
  const f = fixture(t, { remote: true }); let j = push(f, finalCommit(f, integrate(f, commit(f, prep(f))))); const hook = path.join(f.bare, 'hooks/pre-receive'); writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => push(f, j), e => e.code === 'push_unverified'); j = status(f, j.id); assert.equal(j.intent.kind, 'push'); rmSync(hook); j = resume(f, j); assert.equal(j.requiresPushConfirmation, true); assert.equal(push(f, j).phase, 'pushed');
});
test('squash冲突保留现场；解决暂存resume预览后重新验证提交', t => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'a.txt'), 'target different'); git(f.root, 'add', 'a.txt'); git(f.root, 'commit', '-m', '目标变化');
  let j = commit(f, prep(f)); assert.throws(() => integrate(f, j), e => e.code === 'squash_conflict'); assert.ok(git(f.root, 'status', '--porcelain').includes('UU')); assert.ok(readFileSync(path.join(f.root, 'a.txt'), 'utf8').includes('<<<<<<<'));
  j = status(f, j.id); assert.throws(() => resume(f, j), e => e.code === 'squash_conflict'); j = status(f, j.id); assert.equal(j.operationContext.resolutionAttempts, 2); writeFileSync(path.join(f.root, 'a.txt'), 'resolved'); git(f.root, 'add', 'a.txt'); j = resume(f, j); assert.equal(j.requiresFinalConfirmation, true); assert.equal(finalCommit(f, j).phase, 'complete');
});
test('同common-dir锁不抢陈旧锁；id/schema/确认fail closed', t => {
  const f = fixture(t); const c = repositoryContext(f.source); withDeliveryLock(c.commonDir, () => assert.throws(() => prep(f), e => e.code === 'delivery_locked'));
  const lock = path.join(c.commonDir, 'pi-delivery/lock'); mkdirSync(lock); assert.throws(() => prep(f), e => e.code === 'delivery_locked'); rmSync(lock, { recursive: true });
  const j = prep(f); assert.throws(() => commitDelivery(f.source, j.id, { confirmation: 'wrong' }), e => e.code === 'confirmation_required'); assert.throws(() => status(f, '../escape'), e => e.code === 'invalid_id');
  const raw = readJournal(c.commonDir, j.id); assert.throws(() => writeJournal(c.commonDir, { ...raw, version: 3 }), e => e.code === 'invalid_journal'); assert.throws(() => writeJournal(c.commonDir, { ...raw, intent: { kind: 'arbitrary' } }), e => e.code === 'invalid_journal');
});
test('remote ahead冻结并要求sync，不pull/rebase/force', t => {
  const f = fixture(t, { remote: true }); const other = path.join(f.dir, 'other'); git(f.dir, 'clone', '--branch', 'trunk', f.bare, other); git(other, 'config', 'user.email', 'test@example.invalid'); git(other, 'config', 'user.name', '测试'); writeFileSync(path.join(other, 'b.txt'), 'ahead'); git(other, 'add', 'b.txt'); git(other, 'commit', '-m', '远端领先'); git(other, 'push', 'origin', 'HEAD:refs/heads/trunk');
  assert.equal(prep(f).remoteState.relation, 'remote-ahead'); assert.equal(git(f.root, 'show', 'HEAD:b.txt'), 'base');
});
test('CLI JSON严格未知参数/schema，无credential stderr；inspect无需message', t => {
  const f = fixture(t); const file = path.join(f.dir, 'input.json'); writeFileSync(file, JSON.stringify(f.input));
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); let r = invoke(['inspect', '--cwd', f.source, '--input', file]); assert.equal(r.status, 0, r.stdout); assert.equal(JSON.parse(r.stdout).ok, true); assert.equal(r.stderr, '');
  for (const args of [['inspect', '--cwd', f.source, '--force', 'yes'], ['inspect', '--cwd', f.source, '--cwd', f.root], ['bad', '--cwd', f.source]]) { r = invoke(args); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).ok, false); assert.equal(r.stderr, ''); }
  writeFileSync(file, JSON.stringify({ ...f.input, arbitrary: 'secret' })); r = invoke(['inspect', '--cwd', f.source, '--input', file]); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).error.code, 'unknown_field'); assert.equal(r.stdout.includes('secret'), false);
});
test('暂存后故障恢复仅冻结内容；提交前故障可显式resume原意图', t => {
  const f = fixture(t); let j = prep(f); assert.throws(() => commit(f, j, faultAt('after_stage')), /injected/); j = resume(f, status(f, j.id)); assert.equal(j.requiresCommitConfirmation, true); assert.equal(j.intent.kind, 'source_commit'); j = resume(f, j); assert.equal(j.phase, 'source_committed');
});
test('commit意图写入后、Git commit前故障：显式resume精确重试', t => {
  const f = fixture(t); let j = prep(f); assert.throws(() => commit(f, j, faultAt('before_source_commit')), /injected/); j = resume(f, status(f, j.id)); assert.equal(j.phase, 'source_committed'); assert.equal(git(f.source, 'rev-list', '--count', 'HEAD'), '2');
});
test('target原本未push历史必须展示，push不受followTags配置扩大范围', t => {
  const f = fixture(t, { remote: true }); writeFileSync(path.join(f.root, 'b.txt'), 'local history'); git(f.root, 'add', 'b.txt'); git(f.root, 'commit', '-m', '目标原本未推送');
  git(f.root, 'tag', '-a', 'must-not-push', '-m', '本地tag'); git(f.root, 'config', 'push.followTags', 'true');
  let j = prep(f); assert.ok(j.remoteState.unpushedCommits.includes('目标原本未推送')); j = push(f, finalCommit(f, integrate(f, commit(f, j)))); j = push(f, j); assert.equal(j.phase, 'pushed'); assert.equal(git(f.bare, 'tag', '--list'), '');
});
test('fetch授权缺失会保存receipt后停止，resume显式授权；之后URL变化阻断', t => {
  const f = fixture(t, { remote: true }); const p = inspectDelivery(f.source, f.input); let id;
  assert.throws(() => prepareDelivery(f.source, { ...f.input, expectedPreviewDigest: p.digest, confirmation: p.digest }), e => { id = e.details.id; return e.code === 'fetch_authorization_required'; });
  let j = status(f, id); j = resume(f, j); assert.ok(j.remoteState); j = finalCommit(f, integrate(f, commit(f, j)));
  git(f.root, 'remote', 'set-url', 'publish', path.join(f.dir, 'different.git')); assert.throws(() => push(f, j), e => e.code === 'remote_changed');
});
test('source新OID、目标新OID不能复用已准备确认', t => {
  const f = fixture(t); const j = prep(f); git(f.root, 'commit', '--allow-empty', '-m', '目标引用移动'); assert.throws(() => commit(f, j), e => e.code === 'head_changed');
});
test('squash前后journal故障可恢复最终预览，不重复target提交', t => {
  const f = fixture(t); let j = commit(f, prep(f)); assert.throws(() => integrate(f, j, faultAt('before_squash')), /injected/); j = resume(f, status(f, j.id)); assert.equal(j.requiresFinalConfirmation, true); assert.equal(finalCommit(f, j).phase, 'complete');
});
test('source已全部commit且clean时不造新source提交；目标已有相同树不冒称交付', t => {
  const f = fixture(t); git(f.source, 'add', 'a.txt'); git(f.source, 'commit', '-m', '已有任务提交'); const oid = git(f.source, 'rev-parse', 'HEAD');
  let j = commit(f, prep(f)); assert.equal(j.sourceResult.existing, true); assert.equal(j.sourceResult.resultOid, oid); j = integrate(f, j); assert.equal(finalCommit(f, j).phase, 'complete');
});

for (const linked of [false, true]) for (const interrupted of [false, true]) test(`remote HEAD默认target：${linked ? 'linked' : 'primary'} ${interrupted ? 'stage恢复' : 'commit'}不因解析来源变化阻断`, t => {
  const f = fixture(t, { linked, remote: true }); delete f.input.targetBranch;
  git(f.root, 'symbolic-ref', 'refs/remotes/publish/HEAD', 'refs/remotes/publish/trunk');
  let j = prep(f); assert.equal(j.preview.resolution.targetResolution, 'remote-head');
  if (interrupted) {
    assert.throws(() => commit(f, j, faultAt('after_stage')), /injected/);
    j = resume(f, status(f, j.id)); j = resume(f, j);
  } else j = commit(f, j);
  assert.equal(j.phase, linked ? 'source_committed' : 'complete');
  if (linked) assert.equal(finalCommit(f, integrate(f, j)).phase, 'target_committed');
});
for (const target of [false, true]) for (const after of [false, true]) for (const field of ['root', 'parent']) test(`拒绝篡改${target ? 'target' : 'source'} commit ${after ? 'after' : 'before'} ${field}`, t => {
  const f = fixture(t); const foreign = fixture(t, { linked: false });
  let j = target ? integrate(f, commit(f, prep(f))) : prep(f);
  const point = `${after ? 'after' : 'before'}_${target ? 'target' : 'source'}_commit`;
  assert.throws(() => target ? finalCommit(f, j, faultAt(point)) : commit(f, j, faultAt(point)), /injected/);
  const c = repositoryContext(f.source); const file = path.join(c.commonDir, 'pi-delivery', `${j.id}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const before = [f.source, f.root, foreign.root].map(root => [git(root, 'rev-parse', 'HEAD'), git(root, 'status', '--porcelain')]);
  raw.intent[field] = field === 'root' ? foreign.root : 'f'.repeat(40);
  writeFileSync(file, JSON.stringify(raw)); const bytes = readFileSync(file);
  assert.throws(() => status(f, j.id), e => e.code === 'invalid_journal');
  assert.throws(() => resumeDelivery(f.source, j.id, { confirmation: digest(raw) }), e => e.code === 'invalid_journal');
  assert.deepEqual(readFileSync(file), bytes);
  assert.deepEqual([f.source, f.root, foreign.root].map(root => [git(root, 'rev-parse', 'HEAD'), git(root, 'status', '--porcelain')]), before);
});
for (const mutation of ['url', 'fetch-url', 'remote-ref', 'target']) for (const staged of [false, true]) test(`冻结目的地仍拒绝${mutation}变化${staged ? '（stage恢复）' : ''}`, t => {
  const f = fixture(t, { remote: true }); delete f.input.targetBranch;
  git(f.root, 'symbolic-ref', 'refs/remotes/publish/HEAD', 'refs/remotes/publish/trunk');
  // Config drift must be detected as a binding change, not merely target dirtiness.
  writeFileSync(path.join(f.root, '.git/info/exclude'), '.pi/\n');
  const j = prep(f);
  if (staged) assert.throws(() => commit(f, j, faultAt('after_stage')), /injected/);
  if (mutation === 'url') git(f.root, 'remote', 'set-url', '--push', 'publish', path.join(f.dir, 'other.git'));
  if (mutation === 'fetch-url') git(f.root, 'remote', 'set-url', 'publish', path.join(f.dir, 'other.git'));
  if (mutation === 'remote-ref' || mutation === 'target') {
    mkdirSync(path.join(f.root, '.pi')); writeFileSync(path.join(f.root, '.pi/git-delivery.json'), JSON.stringify({ [mutation === 'target' ? 'targetBranch' : 'remoteBranch']: 'other' }));
  }
  const oid = git(f.source, 'rev-parse', 'HEAD');
  assert.throws(() => staged ? resume(f, status(f, j.id)) : commit(f, j), e => e.code === (staged ? 'stage_recovery_required' : 'scope_changed'));
  assert.equal(git(f.source, 'rev-parse', 'HEAD'), oid);
});

test('recoverCommit直接调用也拒绝任意root、冻结parent和其他common身份', t => {
  const f = fixture(t); const foreign = fixture(t, { linked: false }); const j = prep(f);
  assert.throws(() => commit(f, j, faultAt('before_source_commit')), /injected/);
  const raw = readJournal(repositoryContext(f.source).commonDir, j.id);
  assert.throws(() => recoverCommit(raw, { ...raw.intent, root: foreign.root }), e => e.code === 'invalid_journal');
  assert.throws(() => recoverCommit(raw, { ...raw.intent, parent: 'f'.repeat(40) }), e => e.code === 'invalid_journal');
  const forged = { ...raw, sourceRoot: foreign.root };
  assert.throws(() => recoverCommit(forged, { ...raw.intent, root: foreign.root }), e => e.code === 'identity_changed');
  const targetForged = { ...raw, targetRoot: foreign.root, targetBranch: 'trunk' };
  assert.throws(() => recoverCommit(targetForged, { ...raw.intent, kind: 'target_commit', root: foreign.root, parent: raw.targetOid }), e => e.code === 'identity_changed');
  assert.equal(git(foreign.root, 'rev-list', '--count', 'HEAD'), '1');
});
