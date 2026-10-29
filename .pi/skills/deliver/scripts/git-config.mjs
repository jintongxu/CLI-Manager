import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fail, optionalGit, gitText, digest } from './git-run.mjs';

const keys = new Set(['targetBranch', 'remote', 'remoteBranch', 'pushFromPrimary', 'pushFromWorktree', 'mergeStrategy', 'cleanup', 'language', 'checks', 'conflictResolution']);
export function validateBranch(cwd, name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.startsWith('refs/') || name.includes('\0') || optionalGit(cwd, ['check-ref-format', `refs/heads/${name}`]) === null) fail('invalid_branch', '分支名称无效');
  return name;
}
export function loadDeliveryConfig(root) {
  const filename = path.join(root, '.pi', 'git-delivery.json');
  let raw;
  try { if (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()) fail('invalid_config', '配置必须是普通文件'); raw = readFileSync(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  let config;
  try { config = JSON.parse(raw); } catch { fail('invalid_config', '交付配置不是有效 JSON'); }
  if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(k => !keys.has(k))) fail('invalid_config', '交付配置包含未知字段');
  for (const k of ['targetBranch', 'remote', 'remoteBranch']) if (k in config && (typeof config[k] !== 'string' || !config[k] || /[\x00-\x1f]/.test(config[k]))) fail('invalid_config', '配置分支或远端字段无效');
  for (const k of ['pushFromPrimary', 'pushFromWorktree']) if (k in config && typeof config[k] !== 'boolean') fail('invalid_config', '配置推送策略无效');
  if ('conflictResolution' in config && !['agent', 'manual'].includes(config.conflictResolution)) fail('invalid_config', '冲突策略必须是 agent/manual');
  for (const [k, v] of [['mergeStrategy', 'squash'], ['cleanup', 'never'], ['language', 'zh-CN']]) if (k in config && config[k] !== v) fail('invalid_config', '不支持该交付策略');
  if ('checks' in config && (!Array.isArray(config.checks) || config.checks.some(x => typeof x !== 'string'))) fail('invalid_config', '检查命令必须是文本列表；不会自动执行');
  return config;
}
export function redactRemote(url) {
  // URLs and scp-like paths may contain credentials or secret query parameters.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try { const u = new URL(url); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`; } catch { return '[已隐藏远端地址]'; }
  }
  return url.replace(/^[^/@\s]+@/, '[用户]@').split(/[?#]/)[0];
}
export function resolveDelivery(cwd, config, input) {
  const remotes = gitText(cwd, ['remote']).split('\n').filter(Boolean);
  const requestedRemote = input.remote ?? config.remote;
  if (requestedRemote !== undefined && (typeof requestedRemote !== 'string' || !remotes.includes(requestedRemote) || requestedRemote.startsWith('-'))) fail('invalid_remote', '指定远端不存在或无效');
  let targetBranch = input.targetBranch ?? config.targetBranch ?? null;
  let targetResolution = targetBranch ? 'explicit' : null;
  if (!targetBranch) {
    const heads = (requestedRemote ? [requestedRemote] : remotes).map(remote => {
      const ref = optionalGit(cwd, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`]);
      return ref?.startsWith(`refs/remotes/${remote}/`) ? ref.slice(`refs/remotes/${remote}/`.length) : null;
    }).filter(Boolean);
    const candidates = [...new Set(heads)];
    if (candidates.length === 1) { targetBranch = candidates[0]; targetResolution = 'remote-head'; }
  }
  if (targetBranch) validateBranch(cwd, targetBranch);
  const upstreamRemote = targetBranch ? optionalGit(cwd, ['config', '--get', `branch.${targetBranch}.remote`]) : null;
  const remote = requestedRemote ?? (remotes.includes(upstreamRemote) ? upstreamRemote : remotes.length === 1 ? remotes[0] : null);
  const upstreamMerge = targetBranch ? optionalGit(cwd, ['config', '--get', `branch.${targetBranch}.merge`]) : null;
  let remoteBranch = input.remoteBranch ?? config.remoteBranch ?? (upstreamMerge?.startsWith('refs/heads/') && remote === upstreamRemote ? upstreamMerge.slice(11) : targetBranch);
  if (remoteBranch) validateBranch(cwd, remoteBranch);
  const urls = remote ? gitText(cwd, ['remote', 'get-url', '--push', '--all', remote]).split('\n').filter(Boolean) : [];
  const fetchUrls = remote ? gitText(cwd, ['remote', 'get-url', '--all', remote]).split('\n').filter(Boolean) : [];
  return { targetBranch, targetResolution, remote, remoteBranch, remoteCandidates: remotes,
    remoteUrls: urls.map(redactRemote), remoteUrlDigest: remote ? digest({ urls, fetchUrls }) : null,
    remoteAmbiguous: (!remote && remotes.length > 1) || urls.length > 1 || fetchUrls.length > 1 };
}
