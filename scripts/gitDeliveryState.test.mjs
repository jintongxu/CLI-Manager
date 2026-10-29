import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectDelivery, validatePaths, digest, runGit } from '../.pi/skills/deliver/scripts/git-state.mjs';
import { stageSelectedPaths, commitPrimary, commitIndex } from '../.pi/skills/deliver/scripts/git-commit.mjs';
function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(cwd, '.git', 'test-no-global-config'), GIT_CONFIG_NOSYSTEM: '1' } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'delivery-state-')); const root = path.join(dir, 'repo'); mkdirSync(root);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(root, 'init', '-b', 'trunk'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', '测试'); git(root, 'config', 'core.autocrlf', 'false'); git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(root, 'a.txt'), 'base\n'); writeFileSync(path.join(root, 'b.txt'), 'base\n'); git(root, 'add', '--', 'a.txt', 'b.txt'); git(root, 'commit', '-m', '初始'); return { dir, root };
}
const input = { targetBranch: 'trunk', paths: ['a.txt'], message: '修复中文消息 $(echo 危险)' };
function stage(root, data = input) { const p = inspectDelivery(root, data); const staged = stageSelectedPaths(root, { input: data, expectedPreviewDigest: p.digest }); return { p: inspectDelivery(root, data), staged }; }
function options(dir, p, staged) { const file = path.join(dir, '消息.txt'); writeFileSync(file, input.message); return { input, expectedPreviewDigest: p.digest, expectedParentOid: staged.parentOid, expectedTree: staged.tree, messageFile: file, expectedMessageDigest: digest(input.message) }; }
test('只读冻结预览，无 journal/ref/index 写入，主提交不 push', t => {
  const { dir, root } = fixture(t); writeFileSync(path.join(root, 'a.txt'), 'change\n');
  const index = path.join(root, '.git/index'); const before = readFileSync(index); const head = git(root, 'rev-parse', 'HEAD');
  const p = inspectDelivery(root, input); assert.equal(p.context.mode, 'primary'); assert.equal(p.scope.push, true); assert.equal(p.state.ready, true); assert.ok(Object.isFrozen(p.state.source));
  assert.deepEqual(readFileSync(index), before); assert.equal(git(root, 'rev-parse', 'HEAD'), head); assert.equal(existsSync(path.join(root, '.git/git-delivery')), false); assert.equal(inspectDelivery(root, input).digest, p.digest);
  const { p: stagedPreview, staged } = stage(root); const result = commitPrimary(root, options(dir, stagedPreview, staged)); assert.equal(result.parentOid, head); assert.equal(git(root, 'log', '-1', '--format=%B'), input.message); assert.equal(git(root, 'status', '--porcelain'), '');
});
test('拒绝无关暂存、未选 dirty、过期预览及恶意路径', t => {
  const { root } = fixture(t); writeFileSync(path.join(root, 'b.txt'), 'other'); git(root, 'add', '--', 'b.txt');
  const p = inspectDelivery(root, input); assert.ok(p.state.blockers.includes('unrelated_changes')); assert.throws(() => stageSelectedPaths(root, { input, expectedPreviewDigest: p.digest }), /范围/);
  for (const p of ['../escape', '/absolute', ':!a.txt', 'a/../b', '.git/config', 'a\\b', '.', 'a\n']) assert.throws(() => validatePaths(root, [p]));
  assert.throws(() => stageSelectedPaths(root, { input, expectedPreviewDigest: 'stale' }), /预览/);
});
test('中文、引号、空格、以横线开头文件均为字面参数', t => {
  const { root } = fixture(t); const name = process.platform === 'win32' ? "-中文 ' $(not-shell).txt" : '-中文 " $(not-shell).txt'; writeFileSync(path.join(root, name), 'text');
  const data = { targetBranch: 'trunk', paths: [name] }; const p = inspectDelivery(root, data); assert.equal(p.state.ready, true); stageSelectedPaths(root, { input: data, expectedPreviewDigest: p.digest }); assert.equal(git(root, 'diff', '--cached', '--name-only', '-z'), name + '\0');
});
test('不猜 main/master/origin；单远端纳入确认，upstream 与远端 HEAD 明确解析和脱敏', t => {
  const { root } = fixture(t); git(root, 'branch', 'main'); git(root, 'branch', 'master');
  assert.ok(inspectDelivery(root).state.blockers.includes('target_ambiguous'));
  git(root, 'remote', 'add', 'private', 'https://user:secret@example.invalid/team/repo?token=hidden');
  let p = inspectDelivery(root, { targetBranch: 'trunk' }); assert.equal(p.resolution.remote, 'private'); assert.deepEqual(p.resolution.remoteCandidates, ['private']);
  git(root, 'update-ref', 'refs/remotes/private/trunk', git(root, 'rev-parse', 'HEAD')); git(root, 'symbolic-ref', 'refs/remotes/private/HEAD', 'refs/remotes/private/trunk');
  p = inspectDelivery(root); assert.equal(p.resolution.targetBranch, 'trunk');
  git(root, 'config', 'branch.trunk.remote', 'private'); git(root, 'config', 'branch.trunk.merge', 'refs/heads/custom');
  p = inspectDelivery(root); assert.equal(p.resolution.remote, 'private'); assert.equal(p.resolution.remoteBranch, 'custom'); assert.ok(!JSON.stringify(p).includes('secret')); assert.ok(!JSON.stringify(p).includes('hidden'));
  git(root, 'remote', 'add', 'second', 'https://example.invalid/repo'); git(root, 'update-ref', 'refs/remotes/second/main', git(root, 'rev-parse', 'HEAD')); git(root, 'symbolic-ref', 'refs/remotes/second/HEAD', 'refs/remotes/second/main'); assert.equal(inspectDelivery(root).resolution.targetBranch, null);
});
test('linked 身份、已有分支提交、目标 dirty、primary feature/detached 停止', t => {
  const { dir, root } = fixture(t); const linked = path.join(dir, 'task 空格'); git(root, 'worktree', 'add', '-b', 'task', linked);
  writeFileSync(path.join(linked, 'a.txt'), 'branch'); git(linked, 'add', '--', 'a.txt'); git(linked, 'commit', '-m', '任务提交');
  let p = inspectDelivery(linked, { targetBranch: 'trunk' }); assert.equal(p.context.mode, 'worktree'); assert.equal(p.context.targetRoot.replaceAll('\\', '/').toLowerCase(), root.replaceAll('\\', '/').toLowerCase()); assert.equal(p.scope.branchCommits.length, 1); assert.equal(p.state.ready, true);
  writeFileSync(path.join(root, 'b.txt'), 'dirty'); p = inspectDelivery(linked, { targetBranch: 'trunk' }); assert.ok(p.state.blockers.includes('target_dirty'));
  git(root, 'checkout', '-b', 'feature'); assert.equal(inspectDelivery(root, { targetBranch: 'trunk' }).context.mode, 'unsupported');
  git(linked, 'checkout', '--detach'); assert.equal(inspectDelivery(linked, { targetBranch: 'trunk' }).context.mode, 'detached');
});
test('hooks 正常运行；改 tree 后暴露已创建 OID，不能自动后续', t => {
  const { dir, root } = fixture(t); writeFileSync(path.join(root, 'a.txt'), 'change'); const { p, staged } = stage(root);
  const hook = path.join(root, '.git/hooks/pre-commit'); writeFileSync(hook, '#!/bin/sh\nprintf "hook" > b.txt\ngit add -- b.txt\n', { mode: 0o755 });
  assert.throws(() => commitPrimary(root, options(dir, p, staged)), error => error.code === 'commit_requires_review' && Boolean(error.details.resultOid));
  assert.equal(git(root, 'show', 'HEAD:b.txt'), 'hook');
});
test('拒绝 hook failure、活动操作、父/tree变化及非中文消息', t => {
  const { dir, root } = fixture(t); writeFileSync(path.join(root, 'a.txt'), 'change'); const { p, staged } = stage(root); const opts = options(dir, p, staged);
  assert.throws(() => commitPrimary(root, { ...opts, expectedParentOid: '0'.repeat(40) }), /父/);
  assert.throws(() => commitPrimary(root, { ...opts, expectedTree: '0'.repeat(40) }), /索引树/);
  writeFileSync(opts.messageFile, 'English only'); assert.throws(() => commitPrimary(root, { ...opts, expectedMessageDigest: digest('English only') }), /中文/); writeFileSync(opts.messageFile, input.message);
  writeFileSync(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 }); assert.throws(() => commitPrimary(root, opts), e => e.code === 'commit_failed');
  writeFileSync(path.join(root, '.git/MERGE_HEAD'), staged.parentOid); assert.ok(inspectDelivery(root, input).state.blockers.includes('source_git_operation'));
});
test('配置只接受已知策略、target 必须检出、未推送历史完整展示', t => {
  const { root } = fixture(t); mkdirSync(path.join(root, '.pi')); writeFileSync(path.join(root, '.pi/git-delivery.json'), JSON.stringify({ targetBranch: 'trunk', remote: 'publish', cleanup: 'never' }));
  git(root, 'remote', 'add', 'publish', 'https://example.invalid/repo'); git(root, 'update-ref', 'refs/remotes/publish/trunk', git(root, 'rev-parse', 'HEAD'));
  git(root, 'add', '--', '.pi/git-delivery.json'); git(root, 'commit', '-m', '配置'); assert.equal(inspectDelivery(root).scope.targetUnpushedCommits.length, 1);
  git(root, 'branch', 'unoccupied'); assert.ok(inspectDelivery(root, { targetBranch: 'unoccupied' }).state.blockers.includes('target_not_checked_out'));
  writeFileSync(path.join(root, '.pi/git-delivery.json'), '{"cleanup":"always"}'); assert.throws(() => inspectDelivery(root), /策略/);
});
test('空提交被拒绝，skip-worktree 与 gitlink 索引不冒称 clean', t => {
  const { dir, root } = fixture(t); const parent = git(root, 'rev-parse', 'HEAD'); const tree = git(root, 'rev-parse', 'HEAD^{tree}'); const messageFile = path.join(dir, 'message'); writeFileSync(messageFile, '禁止空提交');
  assert.throws(() => commitIndex(root, { expectedBranch: 'trunk', expectedParentOid: parent, expectedTree: tree, paths: ['a.txt'], messageFile, expectedMessageDigest: digest('禁止空提交') }), e => e.code === 'empty_commit');
  git(root, 'update-index', '--skip-worktree', '--', 'a.txt'); assert.ok(inspectDelivery(root, input).state.blockers.includes('unsupported_index'));
});
test('内容变化绑定 digest；hooks 修改消息同样阻断后续', t => {
  const { dir, root } = fixture(t); writeFileSync(path.join(root, 'a.txt'), 'one'); const p = inspectDelivery(root, input); writeFileSync(path.join(root, 'a.txt'), 'two'); assert.notEqual(inspectDelivery(root, input).digest, p.digest);
  const { p: stagedPreview, staged } = stage(root); writeFileSync(path.join(root, '.git/hooks/commit-msg'), '#!/bin/sh\nprintf "钩子替换消息\n" > "$1"\n', { mode: 0o755 });
  assert.throws(() => commitPrimary(root, options(dir, stagedPreview, staged)), e => e.code === 'commit_requires_review' && Boolean(e.details.resultOid));
});
