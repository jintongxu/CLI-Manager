import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export class DeliveryError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'DeliveryError'; this.code = code; this.details = details; }
}
export function fail(code, message, details) { throw new DeliveryError(code, message, details); }
export function digest(value) { return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex'); }
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// Always argv, never shell. Do not expose Git stderr (it may contain credential URLs).
export function runGit(cwd, args, { readOnly = true, allowFailure = false, input } = {}) {
  if (!Array.isArray(args) || args.some(x => typeof x !== 'string' || x.includes('\0'))) fail('invalid_arguments', 'Git 参数无效');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|PREFIX|SHALLOW_FILE|REPLACE_REF_BASE)$/i.test(key)) delete env[key];
  env.GIT_OPTIONAL_LOCKS = readOnly ? '0' : '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_LITERAL_PATHSPECS = '1';
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd, env, shell: false, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000, input,
  });
  if (result.error || (result.status !== 0 && !allowFailure)) fail('git_failed', 'Git 操作失败；请检查仓库状态（不要盲目重试写操作）', { command: args[0], status: result.status });
  return { status: result.status, stdout: result.stdout || '', stderr: '' };
}
export function gitText(cwd, args, options) { return runGit(cwd, args, options).stdout.trim(); }
export function optionalGit(cwd, args) { const r = runGit(cwd, args, { allowFailure: true }); return r.status === 0 ? r.stdout.trim() : null; }
