import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectDelivery, prepareDelivery, commitDelivery, integrateDelivery, pushDelivery, statusDelivery, resumeDelivery, syncDelivery } from '../.pi/skills/deliver/scripts/delivery.mjs';
import { digest } from '../.pi/skills/deliver/scripts/git-run.mjs';
const cli = path.resolve('.pi/skills/deliver/scripts/deliver.mjs');
function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(cwd, 'no-global'), GIT_CONFIG_NOSYSTEM: '1' } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function change(root, file, text) { if (text === null) rmSync(path.join(root, file)); else writeFileSync(path.join(root, file), text); git(root, 'add', '--', file); git(root, 'commit', '-m', '模拟变更'); }
function fixture(t, linked = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'delivery-sync-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo'); mkdirSync(root); git(root, 'init', '-b', 'trunk');
  for (const [k, v] of [['user.name', '测试'], ['user.email', 'test@example.invalid'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(root, 'config', k, v);
  for (const file of ['a', 'b', 'c']) writeFileSync(path.join(root, file), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-m', '初始');
  const bare = path.join(dir, 'remote.git'); mkdirSync(bare); git(bare, 'init', '--bare'); git(root, 'remote', 'add', 'publish', bare); git(root, 'push', 'publish', 'HEAD:refs/heads/trunk');
  const other = path.join(dir, 'other'); git(dir, 'clone', '--branch', 'trunk', bare, other); git(other, 'config', 'user.email', 'test@example.invalid'); git(other, 'config', 'user.name', '测试'); git(other, 'config', 'core.autocrlf', 'false'); git(other, 'config', 'commit.gpgsign', 'false');
  const source = linked ? path.join(dir, 'task') : root; if (linked) git(root, 'worktree', 'add', '-b', 'task', source);
  const messageFile = path.join(dir, 'message'); writeFileSync(messageFile, '任务交付\n'); writeFileSync(path.join(source, 'a'), 'task\n');
  return { dir, root, source, bare, other, input: { targetBranch: 'trunk', paths: ['a'], messageFile } };
}
function prep(f) { const p = inspectDelivery(f.source, f.input); return prepareDelivery(f.source, { ...f.input, expectedPreviewDigest: p.digest, confirmation: p.digest, allowFetch: true }); }
const args = j => ({ confirmation: j.confirmation, allowFetch: true });
const ev = tree => ({ tree, attestation: 'user-confirmed', checks: [{ command: 'fixture check', result: 'pass', outputDigest: digest('verified') }] });
const commit = (f, j) => commitDelivery(f.source, j.id, { confirmation: j.confirmation });
const sync = (f, j, extra = {}, options) => syncDelivery(f.source, j.id, { ...args(j), ...extra }, options);
const push = (f, j, options) => pushDelivery(f.source, j.id, args(j), options);
const status = (f, id) => statusDelivery(f.source, id);
const resume = (f, j, options) => resumeDelivery(f.source, j.id, args(j), options);
const fault = name => ({ fault(p) { if (p === name) throw new Error('injected'); } });
function advanceRemote(f, file = 'b', text = 'remote\n') { change(f.other, file, text); git(f.other, 'push', 'origin', 'HEAD:refs/heads/trunk'); return git(f.other, 'rev-parse', 'HEAD'); }
function squash(f, j) { j = integrateDelivery(f.source, j.id, { confirmation: j.confirmation }); return integrateDelivery(f.source, j.id, { confirmation: j.confirmation, evidence: ev(j.squash.tree) }); }
function finishPush(f, j) { j = push(f, j); if (j.requiresPushConfirmation && !j.requiresSync) j = push(f, j); return j; }

test('primary默认push、唯一无upstreamremote确认，task结果与最终tip分离', t => {
  const f = fixture(t); let j = prep(f); assert.equal(j.input.push, true); assert.equal(j.input.remote, 'publish'); assert.equal(j.version, 2);
  j = commit(f, j); assert.equal(j.phase, 'target_committed'); const task = j.sourceResult.resultOid;
  j = finishPush(f, j); assert.equal(j.phase, 'pushed'); assert.equal(git(f.bare, 'rev-parse', 'trunk'), task); assert.equal(resume(f, j).phase, 'pushed');
});
test('显式false/config false保持；多remote阻断，不冒称无remote；网络错误留fetch意图', t => {
  const f = fixture(t); f.input.push = false; let j = commit(f, prep(f)); assert.equal(j.phase, 'complete'); assert.equal(j.remoteState, null);
  git(f.root, 'remote', 'add', 'second', f.bare); assert.equal(inspectDelivery(f.source, f.input).state.ready, false);
  f.input.remote = 'publish'; assert.equal(inspectDelivery(f.source, f.input).resolution.remote, 'publish');
  const f2 = fixture(t); mkdirSync(path.join(f2.root, '.pi')); writeFileSync(path.join(f2.root, '.git/info/exclude'), '.pi/\n'); writeFileSync(path.join(f2.root, '.pi/git-delivery.json'), JSON.stringify({ pushFromPrimary: false, conflictResolution: 'manual' }));
  j = commit(f2, prep(f2)); assert.equal(j.phase, 'complete'); assert.equal(j.conflictResolution, 'manual');
  const f3 = fixture(t); git(f3.root, 'remote', 'set-url', 'publish', path.join(f3.dir, 'absent.git')); assert.throws(() => prep(f3), e => e.code === 'git_failed');
});
test('linked先FF远端再squash，不把sync结果覆盖source/target结果', t => {
  const f = fixture(t, true); const remote = advanceRemote(f); let j = commit(f, prep(f)); assert.equal(j.requiresSync, true);
  assert.equal(integrateDelivery(f.source, j.id, { confirmation: j.confirmation }).requiresSync, true);
  const source = j.sourceResult.resultOid; j = sync(f, j); assert.equal(j.integrationBaseOid, remote); assert.equal(j.syncAttempts, 1);
  j = squash(f, j); assert.equal(j.targetResult.parentOid, remote); assert.equal(j.squash.parent, remote); assert.equal(j.sourceResult.resultOid, source);
  j = finishPush(f, j); assert.equal(j.phase, 'pushed'); assert.equal(git(f.root, 'show', 'HEAD:b'), 'remote');
});
for (const conflict of [false, true]) test(`primary真实双父普通merge${conflict ? '+文本冲突Pi模拟' : '+无冲突'}、最终tree证据`, t => {
  const f = fixture(t); advanceRemote(f, conflict ? 'a' : 'b'); let j = commit(f, prep(f));
  const task = j.sourceResult.resultOid; j = push(f, j); assert.equal(j.requiresSync, true); j = sync(f, j);
  assert.equal(j.sync.operation, 'remote_merge'); assert.equal(j.sync.ours, task); assert.equal(git(f.root, 'rev-parse', 'MERGE_HEAD'), j.sync.theirs);
  if (conflict) { assert.deepEqual(j.sync.conflictPaths, ['a']); assert.ok(readFileSync(path.join(f.root, 'a'), 'utf8').includes('<<<<<<<')); writeFileSync(path.join(f.root, 'a'), 'task + remote\n'); git(f.root, 'add', '--', 'a'); j = resume(f, j); }
  assert.ok(j.sync.review); assert.equal(j.requiresFinalConfirmation, true);
  assert.throws(() => sync(f, j), e => e.code === 'evidence_required');
  assert.throws(() => sync(f, j, { evidence: ev('f'.repeat(40)) }), e => e.code === 'evidence_required');
  j = sync(f, j, { evidence: ev(j.sync.review.tree) }); assert.equal(git(f.root, 'show', '-s', '--format=%P', j.finalTargetOid).split(' ').length, 2);
  assert.equal(j.sourceResult.resultOid, task); assert.notEqual(j.finalTargetOid, task); assert.equal(git(f.root, 'log', '-1', '--format=%B'), '同步远端交付变更');
  j = finishPush(f, j); assert.equal(j.phase, 'pushed'); assert.equal(git(f.bare, 'rev-parse', 'trunk'), j.finalTargetOid);
});
test('modify/delete冲突Pi明确删除/暂存，未解决/越界/未暂存/证据失败保留现场', t => {
  const f = fixture(t); advanceRemote(f, 'a', null); let j = sync(f, push(f, commit(f, prep(f))));
  const before = git(f.root, 'rev-parse', 'HEAD'); assert.equal(j.sync.conflictPaths[0], 'a');
  let same = sync(f, j); assert.ok(same.sync.conflictPaths.length); j = same;
  writeFileSync(path.join(f.root, 'c'), 'unrelated'); git(f.root, 'add', 'c'); git(f.root, 'rm', '--', 'a');
  assert.throws(() => sync(f, j), e => e.code === 'resolution_scope_changed'); git(f.root, 'restore', '--staged', '--worktree', 'c');
  writeFileSync(path.join(f.root, 'a'), 'resolved'); assert.throws(() => sync(f, j), e => e.code === 'unstaged_resolution'); rmSync(path.join(f.root, 'a'));
  j = sync(f, j); const failed = { ...ev(j.sync.review.tree), checks: [{ command: 'bad', result: 'fail', outputDigest: digest('fail') }] };
  assert.throws(() => sync(f, j, { evidence: failed }), e => e.code === 'invalid_evidence'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), before);
  j = sync(f, j, { evidence: ev(j.sync.review.tree) }); assert.equal(j.phase, 'target_committed'); assert.equal(git(f.root, 'ls-files', 'a'), '');
});
for (const point of ['before_sync', 'after_sync_merge', 'before_sync_commit', 'after_sync_commit']) test(`sync故障${point}恢复不重复普通merge`, t => {
  const f = fixture(t); advanceRemote(f); let j = push(f, commit(f, prep(f)));
  if (point.endsWith('_commit')) { j = sync(f, j); assert.throws(() => sync(f, j, { evidence: ev(j.sync.review.tree) }, fault(point)), /injected/); }
  else assert.throws(() => sync(f, j, {}, fault(point)), /injected/);
  j = resume(f, status(f, j.id));
  if (j.phase === 'sync_pending') j = sync(f, j, { evidence: ev(j.sync.review.tree) });
  assert.equal(j.phase, 'target_committed'); assert.equal(git(f.root, 'rev-list', '--count', 'HEAD'), '4'); assert.equal(j.syncAttempts, 1);
  const tip = j.finalTargetOid; assert.equal(resume(f, j).finalTargetOid, tip);
});
test('FF写入后丢回执恢复不重复同步', t => {
  const f = fixture(t, true); const oid = advanceRemote(f); let j = commit(f, prep(f));
  assert.throws(() => sync(f, j, {}, fault('after_sync_ff')), /injected/); j = resume(f, status(f, j.id)); assert.equal(j.integrationBaseOid, oid); assert.equal(j.syncHistory.length, 1);
});
test('推前remote前进：先保留squash再同步，squash证明与finalpush分离', t => {
  const f = fixture(t, true); let j = squash(f, commit(f, prep(f))); const proof = JSON.stringify(j.squash); const squashEvidence = JSON.stringify(j.evidence); const result = j.targetResult.resultOid;
  advanceRemote(f); j = push(f, j); assert.equal(j.requiresSync, true); j = sync(f, j); assert.equal(j.sync.operation, 'remote_merge');
  j = sync(f, j, { evidence: ev(j.sync.review.tree) }); assert.equal(JSON.stringify(j.squash), proof); assert.equal(j.targetResult.resultOid, result); assert.notEqual(j.finalTargetOid, result); assert.equal(JSON.stringify(j.evidence), squashEvidence); assert.ok(j.syncHistory.at(-1).evidence);
  assert.throws(() => push(f, j, fault('after_push')), /injected/); j = resume(f, status(f, j.id)); assert.equal(j.phase, 'pushed'); assert.equal(j.targetResult.resultOid, result);
});
test('squash冲突不能叠remote同步，返回独立context且无MERGE_HEAD', t => {
  const f = fixture(t, true); change(f.root, 'a', 'target\n'); let j = commit(f, prep(f));
  assert.throws(() => integrateDelivery(f.source, j.id, { confirmation: j.confirmation }), e => e.code === 'squash_conflict' && e.details.context.operation === 'squash');
  j = status(f, j.id); assert.throws(() => sync(f, j), e => e.code === 'sync_not_allowed'); assert.equal(j.operationContext.ours, j.targetOid);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: f.root }).status, 128);
  advanceRemote(f); writeFileSync(path.join(f.root, 'a'), 'resolved\n'); git(f.root, 'add', 'a'); j = resume(f, j);
  j = integrateDelivery(f.source, j.id, { confirmation: j.confirmation, evidence: ev(j.squash.tree) }); assert.ok(j.targetResult); j = push(f, j); assert.equal(j.requiresSync, true);
});
test('三轮远端竞态同步上限持久化，拒绝第四轮且不清理', t => {
  const f = fixture(t); let j = commit(f, prep(f));
  for (let i = 0; i < 3; i++) { advanceRemote(f, 'b', `remote ${i}`); j = push(f, j); j = sync(f, j); j = sync(f, j, { evidence: ev(j.sync.review.tree) }); assert.equal(j.syncAttempts, i + 1); }
  advanceRemote(f, 'b', 'fourth'); j = push(f, j); const tip = git(f.root, 'rev-parse', 'HEAD'); assert.throws(() => sync(f, j), e => e.code === 'sync_attempts_exhausted'); assert.equal(status(f, j.id).syncAttempts, 3); assert.equal(git(f.root, 'rev-parse', 'HEAD'), tip);
});
test('v1明确拒需新授权，status可读且原receipt字节不变', t => {
  const f = fixture(t); let j = prep(f); const file = path.join(f.root, '.git/pi-delivery', `${j.id}.json`); const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.version = 1; raw.preview.version = 1; for (const key of ['sync', 'syncAttempts', 'pushAttempts', 'syncHistory', 'integrationBaseOid', 'finalTargetOid', 'operationContext']) delete raw[key]; delete raw.remoteState.relation;
  writeFileSync(file, JSON.stringify(raw)); const bytes = readFileSync(file); j = status(f, j.id); assert.equal(j.version, 1);
  for (const fn of [commitDelivery, integrateDelivery, pushDelivery, resumeDelivery, syncDelivery]) assert.throws(() => fn(f.source, j.id, args(j)), e => e.code === (fn === integrateDelivery ? 'unknown_field' : fn === commitDelivery ? 'unknown_field' : 'new_authorization_required'));
  assert.deepEqual(readFileSync(file), bytes);
});
test('sync CLI及严格schema，拒绝yes/额外参数', t => {
  const f = fixture(t); advanceRemote(f); let j = push(f, commit(f, prep(f))); const file = path.join(f.dir, 'input.json'); writeFileSync(file, JSON.stringify(args(j)));
  const run = input => spawnSync(process.execPath, [cli, 'sync', '--cwd', f.source, '--id', j.id, '--input', input], { encoding: 'utf8' }); let r = run(file); assert.equal(r.status, 0, r.stdout); assert.equal(JSON.parse(r.stdout).result.sync.operation, 'remote_merge');
  writeFileSync(file, JSON.stringify({ confirmation: 'yes', allowFetch: true, force: true })); r = run(file); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).error.code, 'unknown_field');
});

test('未解决冲突最多三次持久计数，第4次停止仍保留MERGE_HEAD/索引', t => {
  const f = fixture(t); advanceRemote(f, 'a'); let j = push(f, commit(f, prep(f)));
  for (let i = 1; i <= 3; i++) { j = sync(f, j); assert.equal(j.sync.resolutionAttempts, i); }
  const oid = git(f.root, 'rev-parse', 'HEAD'); const index = readFileSync(path.join(f.root, '.git/index'));
  assert.throws(() => resume(f, j), e => e.code === 'resolution_attempts_exhausted'); assert.equal(status(f, j.id).sync.resolutionAttempts, 3);
  assert.deepEqual(readFileSync(path.join(f.root, '.git/index')), index); assert.equal(git(f.root, 'rev-parse', 'HEAD'), oid);
});
for (const mutation of ['parent', 'theirs', 'url', 'branch', 'foreign-common']) test(`sync恢复拒绝${mutation}漂移，不写外部仓库`, t => {
  const f = fixture(t); advanceRemote(f); let j = push(f, commit(f, prep(f))); assert.throws(() => sync(f, j, {}, fault('before_sync')), /injected/);
  const file = path.join(f.root, '.git/pi-delivery', `${j.id}.json`); const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (mutation === 'parent') raw.sync.ours = 'f'.repeat(40);
  if (mutation === 'theirs') raw.sync.theirs = raw.sourceOid;
  if (mutation === 'url') git(f.root, 'remote', 'set-url', 'publish', path.join(f.dir, 'different.git'));
  if (mutation === 'branch') git(f.root, 'checkout', '-b', 'different');
  let foreign;
  if (mutation === 'foreign-common') { foreign = fixture(t); raw.targetRoot = foreign.root; }
  writeFileSync(file, JSON.stringify(raw)); const bytes = readFileSync(file); const oid = git(f.root, 'rev-parse', 'HEAD');
  if (['parent', 'theirs'].includes(mutation)) assert.throws(() => status(f, j.id), e => e.code === 'invalid_journal');
  else { j = status(f, j.id); assert.throws(() => sync(f, j), e => e.code === (mutation === 'url' ? 'remote_changed' : 'identity_changed')); }
  assert.deepEqual(readFileSync(file), bytes); assert.equal(git(f.root, 'rev-parse', 'HEAD'), oid); if (foreign) assert.equal(git(foreign.root, 'rev-list', '--count', 'HEAD'), '1');
});
for (const hook of ['pre-commit', 'commit-msg']) test(`普通merge正常${hook}篡改阻断且恢复不重merge`, t => {
  const f = fixture(t); advanceRemote(f); let j = sync(f, push(f, commit(f, prep(f))));
  writeFileSync(path.join(f.root, '.git/hooks', hook), hook === 'pre-commit' ? '#!/bin/sh\nprintf hook > c\ngit add -- c\n' : '#!/bin/sh\nprintf "篡改消息\n" > "$1"\n', { mode: 0o755 });
  assert.throws(() => sync(f, j, { evidence: ev(j.sync.review.tree) }), e => e.code === 'commit_requires_review');
  const oid = git(f.root, 'rev-parse', 'HEAD'); j = status(f, j.id); assert.throws(() => resume(f, j), e => e.code === 'sync_recovery_ambiguous'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), oid);
});
test('推送被拒最多三次持久计数，最终保留push intent', t => {
  const f = fixture(t); let j = push(f, commit(f, prep(f))); writeFileSync(path.join(f.bare, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  for (let i = 1; i <= 3; i++) { assert.throws(() => push(f, j), e => e.code === 'push_unverified'); j = status(f, j.id); assert.equal(j.pushAttempts, i); if (i < 3) j = resume(f, j); }
  assert.throws(() => resume(f, j), e => e.code === 'push_attempts_exhausted'); assert.equal(status(f, j.id).intent.kind, 'push');
});
test('无共同历史停止，不创建merge、不清理目标', t => {
  const f = fixture(t); git(f.other, 'checkout', '--orphan', 'unrelated'); git(f.other, 'rm', '-rf', '.'); writeFileSync(path.join(f.other, 'z'), 'unrelated'); git(f.other, 'add', 'z'); git(f.other, 'commit', '-m', '独立历史'); git(f.other, 'push', '--force', 'origin', 'HEAD:refs/heads/trunk');
  // Remove only the temporary fixture's stale tracking ref, so fetch can observe an unrelated tip.
  git(f.root, 'update-ref', '-d', 'refs/remotes/publish/trunk');
  let j = commit(f, prep(f)); j = push(f, j); assert.equal(j.remoteState.relation, 'diverged'); const before = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => sync(f, j), e => e.code === 'unrelated_history'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), before); assert.equal(status(f, j.id).syncAttempts, 0);
});

test('fetch后push前真实竞态拒绝，resume同步冻结新远端再正常push', t => {
  const f = fixture(t); let j = push(f, commit(f, prep(f))); const task = j.sourceResult.resultOid;
  assert.throws(() => push(f, j, { fault(point) { if (point === 'before_push') advanceRemote(f); } }), e => e.code === 'push_unverified');
  j = resume(f, status(f, j.id)); assert.equal(j.requiresSync, true); assert.equal(j.pushAttempts, 1);
  j = sync(f, j); assert.ok(Object.isFrozen(j.sync.review)); j = sync(f, j, { evidence: ev(j.sync.review.tree) });
  j = finishPush(f, j); assert.equal(j.phase, 'pushed'); assert.equal(j.pushAttempts, 2); assert.equal(j.sourceResult.resultOid, task);
});
test('配置checks需真实最终tree证据，review变更丢弃旧证据而非直接commit', t => {
  const f = fixture(t); mkdirSync(path.join(f.root, '.pi')); writeFileSync(path.join(f.root, '.git/info/exclude'), '.pi/\n');
  writeFileSync(path.join(f.root, '.pi/git-delivery.json'), JSON.stringify({ checks: ['required check'] })); advanceRemote(f, 'a');
  let j = sync(f, push(f, commit(f, prep(f)))); writeFileSync(path.join(f.root, 'a'), 'first resolution'); git(f.root, 'add', 'a'); j = sync(f, j);
  assert.throws(() => sync(f, j, { evidence: ev(j.sync.review.tree) }), e => e.code === 'checks_missing');
  const oldTree = j.sync.review.tree; writeFileSync(path.join(f.root, 'a'), 'second resolution'); git(f.root, 'add', 'a');
  j = sync(f, j, { evidence: ev(oldTree) }); assert.equal(j.phase, 'sync_pending'); assert.notEqual(j.sync.review.tree, oldTree); assert.equal(j.evidence, null);
  const evidence = ev(j.sync.review.tree); evidence.checks[0].command = 'required check'; j = sync(f, j, { evidence }); assert.equal(j.phase, 'target_committed');
});
test('同步commit hook拒绝三次后停止，intent和未提交索引可恢复核查', t => {
  const f = fixture(t); advanceRemote(f); let j = sync(f, push(f, commit(f, prep(f)))); const evidence = ev(j.sync.review.tree);
  writeFileSync(path.join(f.root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  for (let i = 1; i <= 3; i++) { assert.throws(() => sync(f, j, { evidence }), e => e.code === 'commit_failed'); j = status(f, j.id); assert.equal(j.sync.commitAttempts, i); }
  const tip = git(f.root, 'rev-parse', 'HEAD'); assert.throws(() => resume(f, j), e => e.code === 'sync_attempts_exhausted'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), tip); assert.equal(status(f, j.id).intent.kind, 'sync_commit');
});

test('RV001 linked worktreeConfig目标pushurl B不得写，冻结源A接收明确目标OID', t => {
  const f = fixture(t, true); const b = path.join(f.dir, 'unauthorized.git');
  git(f.dir, 'clone', '--bare', f.bare, b); const before = git(b, 'rev-parse', 'trunk');
  git(f.root, 'config', 'extensions.worktreeConfig', 'true');
  git(f.root, 'config', '--worktree', 'remote.publish.pushurl', b);
  assert.equal(git(f.source, 'remote', 'get-url', '--push', 'publish'), f.bare);
  assert.equal(git(f.root, 'remote', 'get-url', '--push', 'publish'), b);
  let j = squash(f, commit(f, prep(f)));
  try { j = finishPush(f, j); } finally { assert.equal(git(b, 'rev-parse', 'trunk'), before, '未授权B不得发生写入'); }
  assert.equal(j.phase, 'pushed'); assert.equal(git(f.bare, 'rev-parse', 'trunk'), j.finalTargetOid);
  assert.notEqual(j.finalTargetOid, j.sourceResult.resultOid);
});
function pendingCommit(f, target) {
  let j = prep(f);
  if (!target) return j;
  j = commit(f, j);
  assert.throws(() => integrateDelivery(f.source, j.id, { confirmation: j.confirmation }), e => e.code === 'squash_conflict');
  writeFileSync(path.join(f.root, 'a'), 'resolved\n'); git(f.root, 'add', 'a');
  return resume(f, status(f, j.id));
}
function startCommit(f, j, target, options) {
  return target ? integrateDelivery(f.source, j.id, { confirmation: j.confirmation, evidence: ev(j.squash.tree) }, options) : commitDelivery(f.source, j.id, { confirmation: j.confirmation }, options);
}
for (const target of [false, true]) test(`RV002 ${target ? 'squash冲突target' : 'source'} commit首次/resume持久上限3，第四次hook不运行且留intent/index`, t => {
  const f = fixture(t, target); if (target) change(f.root, 'a', 'target\n');
  let j = pendingCommit(f, target); const calls = path.join(f.dir, 'hook-calls');
  writeFileSync(path.join(f.root, '.git/hooks/pre-commit'), `#!/bin/sh\nprintf 'attempt\n' >> '${calls.split(path.sep).join('/')}'\nexit 1\n`, { mode: 0o755 });
  const root = target ? f.root : f.source; const before = git(root, 'rev-parse', 'HEAD');
  const indexPath = git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
  for (let i = 1; i <= 3; i++) {
    assert.throws(() => i === 1 ? startCommit(f, j, target) : resume(f, j), e => e.code === 'commit_failed');
    j = status(f, j.id); assert.equal(j.intent.commitAttempts, i); assert.equal(readFileSync(calls, 'utf8').split('\n').filter(Boolean).length, i);
  }
  const index = readFileSync(indexPath); const receipt = readFileSync(path.join(f.root, '.git/pi-delivery', `${j.id}.json`));
  assert.throws(() => resume(f, j), e => e.code === 'commit_attempts_exhausted');
  assert.equal(readFileSync(calls, 'utf8').split('\n').filter(Boolean).length, 3);
  assert.equal(git(root, 'rev-parse', 'HEAD'), before); assert.deepEqual(readFileSync(indexPath), index);
  assert.deepEqual(readFileSync(path.join(f.root, '.git/pi-delivery', `${j.id}.json`)), receipt);
  assert.equal(status(f, j.id).intent.kind, target ? 'target_commit' : 'source_commit');
});
for (const target of [false, true]) test(`RV002 ${target ? 'target' : 'source'}第三次commit成功丢回执恢复先证明，不消耗第四次`, t => {
  const f = fixture(t, target); if (target) change(f.root, 'a', 'target\n');
  let j = pendingCommit(f, target); const calls = path.join(f.dir, 'hook-calls');
  const hook = path.join(f.root, '.git/hooks/pre-commit');
  writeFileSync(hook, `#!/bin/sh\nprintf 'attempt\n' >> '${calls.split(path.sep).join('/')}'\nexit 1\n`, { mode: 0o755 });
  for (let i = 1; i <= 2; i++) { assert.throws(() => i === 1 ? startCommit(f, j, target) : resume(f, j), e => e.code === 'commit_failed'); j = status(f, j.id); }
  writeFileSync(hook, `#!/bin/sh\nprintf 'attempt\n' >> '${calls.split(path.sep).join('/')}'\n`, { mode: 0o755 });
  assert.throws(() => resume(f, j, fault(target ? 'after_target_commit' : 'after_source_commit')), /injected/);
  j = status(f, j.id); assert.equal(j.intent.commitAttempts, 3);
  const oid = git(target ? f.root : f.source, 'rev-parse', 'HEAD'); j = resume(f, j);
  assert.equal((target ? j.targetResult : j.sourceResult).resultOid, oid); assert.equal(j.intent, null);
  assert.equal(readFileSync(calls, 'utf8').split('\n').filter(Boolean).length, 3);
});
