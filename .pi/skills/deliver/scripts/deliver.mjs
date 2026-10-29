#!/usr/bin/env node
import { readFileSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DeliveryError, fail } from './git-run.mjs';
import { inspectDelivery, prepareDelivery, commitDelivery, integrateDelivery, pushDelivery, statusDelivery, resumeDelivery, syncDelivery } from './delivery.mjs';

const commands = { inspect: inspectDelivery, prepare: prepareDelivery, commit: commitDelivery, integrate: integrateDelivery, push: pushDelivery, status: statusDelivery, resume: resumeDelivery, sync: syncDelivery };
export function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  if (!Object.hasOwn(commands, action)) fail('unknown_command', '操作必须是 inspect/prepare/commit/integrate/push/status/resume/sync');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]; const value = rest[i + 1];
    if (!['--cwd', '--id', '--input'].includes(key) || Object.hasOwn(flags, key) || !value || value.startsWith('--')) fail('invalid_arguments', '未知、重复或缺值的参数');
    flags[key] = value;
  }
  if (!flags['--cwd'] || (['inspect', 'prepare'].includes(action) ? flags['--id'] !== undefined : !flags['--id'])) fail('invalid_arguments', '需要 --cwd；写入/状态操作需要 --id（inspect/prepare 禁止 id）');
  if (action === 'prepare' && !flags['--input']) fail('invalid_arguments', 'prepare 需要 --input JSON 文件');
  let input = {};
  if (flags['--input']) {
    const s = lstatSync(flags['--input']);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 4 * 1024 * 1024) fail('invalid_input', '输入必须是有限普通 JSON 文件');
    try { input = JSON.parse(readFileSync(flags['--input'], 'utf8')); } catch { fail('invalid_input', '输入不是有效 JSON'); }
  }
  return ['inspect', 'prepare'].includes(action) ? commands[action](flags['--cwd'], input) : commands[action](flags['--cwd'], flags['--id'], input);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify({ ok: true, result: main() }, null, 2) + '\n'); }
  catch (e) {
    // Never print native exception messages/paths/stderr: transport errors may include credentials.
    process.stdout.write(JSON.stringify({ ok: false, error: { code: e instanceof DeliveryError ? e.code : 'operation_failed', message: e instanceof DeliveryError ? e.message : '操作失败，保留现场；请核查输入、权限与仓库状态', ...(e instanceof DeliveryError ? { details: e.details } : {}) } }, null, 2) + '\n');
    process.exitCode = 1;
  }
}
