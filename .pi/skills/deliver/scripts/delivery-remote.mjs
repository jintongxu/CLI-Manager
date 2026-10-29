import { digest, fail, gitText, runGit, optionalGit } from './git-run.mjs';
import { resolveDelivery } from './git-config.mjs';

export function assertRemote(j) {
  const r = resolveDelivery(j.sourceRoot, {}, j.input);
  if (r.remote !== j.preview.resolution.remote || r.remoteBranch !== j.preview.resolution.remoteBranch || r.targetBranch !== j.targetBranch || r.remoteUrlDigest !== j.preview.resolution.remoteUrlDigest || r.remoteAmbiguous) fail('remote_changed', '远端绑定已变化，需要新预览确认');
  if (!r.remote) fail('remote_required', '没有明确远端；仅能本地完成');
  const push = gitText(j.sourceRoot, ['remote', 'get-url', '--push', r.remote]);
  const fetch = gitText(j.sourceRoot, ['remote', 'get-url', r.remote]);
  if (push !== fetch) fail('split_remote_unsupported', '首版要求 fetch/push 地址相同，禁止按不同端点推断历史');
  return r;
}
export function finalTip(j) { return j.finalTargetOid ?? j.targetResult?.resultOid ?? j.integrationBaseOid ?? j.targetOid; }
function ancestor(root, a, b) { return runGit(root, ['merge-base', '--is-ancestor', a, b], { allowFailure: true }).status === 0; }
export { ancestor };
/** Explicit authorized network write to tracking ref; never called by inspect/status. */
export function fetchRemote(j) {
  const r = assertRemote(j); const ref = `refs/heads/${r.remoteBranch}`;
  const listing = runGit(j.sourceRoot, ['ls-remote', '--refs', r.remote, ref]);
  const lines = listing.stdout.trim().split('\n').filter(Boolean);
  if (lines.length > 1 || (lines.length && !new RegExp(`^[a-f0-9]{40,64}\\t`).test(lines[0]))) fail('remote_ref_invalid', '远端引用响应不明确');
  if (!lines.length) return { ...(j.version === 2 ? { relation: 'missing' } : {}), oid: null, ref, remote: r.remote, targetOid: finalTip(j), unpushedCommits: gitText(j.targetRoot, ['log', '--format=%H%x00%P%x00%s', finalTip(j), '--']), unpushedDiff: null };
  runGit(j.sourceRoot, ['fetch', '--no-tags', '--no-write-fetch-head', r.remote, `${ref}:refs/remotes/${r.remote}/${r.remoteBranch}`], { readOnly: false });
  assertRemote(j);
  const oid = optionalGit(j.sourceRoot, ['rev-parse', '--verify', `refs/remotes/${r.remote}/${r.remoteBranch}^{commit}`]);
  const targetOid = finalTip(j);
  if (!oid) fail('remote_ref_invalid', '无法读取远端提交');
  const relation = oid === targetOid ? 'equal' : ancestor(j.sourceRoot, oid, targetOid) ? 'local-ahead' : ancestor(j.sourceRoot, targetOid, oid) ? 'remote-ahead' : 'diverged';
  if (j.version === 1 && !['equal', 'local-ahead'].includes(relation)) fail('remote_ahead_or_diverged', '目标落后或与远端分叉；不自动 pull/rebase/force');
  return { ...(j.version === 2 ? { relation } : {}), oid, ref, remote: r.remote, targetOid,
    unpushedCommits: gitText(j.targetRoot, ['log', '--format=%H%x00%P%x00%s', `${oid}..${targetOid}`, '--']),
    unpushedDiff: runGit(j.targetRoot, ['diff', '--binary', '--no-ext-diff', '--no-textconv', oid, targetOid, '--']).stdout };
}
export function remoteSnapshotDigest(state) { return digest(state); }
export function verifyRemoteContains(j) {
  const r = assertRemote(j); const ref = `refs/heads/${r.remoteBranch}`;
  const listed = runGit(j.sourceRoot, ['ls-remote', '--refs', r.remote, ref]);
  const lines = listed.stdout.trim().split('\n').filter(Boolean);
  if (lines.length !== 1 || !/^[a-f0-9]{40,64}\t/.test(lines[0])) return false;
  const remoteOid = lines[0].split('\t')[0];
  if (remoteOid === finalTip(j)) return true;
  // Fetch exact advertised branch before ancestry proof. Requires the caller's fetch authorization.
  runGit(j.sourceRoot, ['fetch', '--no-tags', '--no-write-fetch-head', r.remote, `${ref}:refs/remotes/${r.remote}/${r.remoteBranch}`], { readOnly: false });
  const fetched = gitText(j.sourceRoot, ['rev-parse', `refs/remotes/${r.remote}/${r.remoteBranch}`]);
  return fetched === remoteOid && ancestor(j.sourceRoot, finalTip(j), fetched);
}
