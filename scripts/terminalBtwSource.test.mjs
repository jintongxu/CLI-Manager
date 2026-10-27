import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/features/terminal/lib/btwSource.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { resolveBtwSource } = exports;

test('contradictory or incomplete live identity never inherits stale persisted Pi identity', () => {
  const sessions = [{ id: 't', cliTool: 'pi', cliSessionId: 'old-pi' }];
  for (const identity of [{ source: 'codex', sessionId: 'codex-now' }, { source: 'pi' }, { source: 'pi', sessionId: '  ' }]) {
    const result = resolveBtwSource('t', sessions, { t: { agentIdentity: identity } });
    assert.equal(result.sessionId, null);
    assert.equal(result.reason, 'no_source_session');
  }
  assert.equal(resolveBtwSource('t', sessions, {}).sessionId, 'old-pi');
  assert.equal(resolveBtwSource('t', sessions, { t: { agentIdentity: { source: 'pi', sessionId: 'new-pi' } } }).sessionId, 'new-pi');
});
