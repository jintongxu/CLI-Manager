import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = path => ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { BtwThreadModel } = await import(url(compile('src/features/terminal/lib/btwThreadModel.ts')));
const tick = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const source = terminalId => ({ terminalId, sessionId: null, reason: 'no_source_session' });
function transport() {
  let progress, finish;
  const cancels = [];
  return { cancels, progress: text => progress(text), finish: text => finish(text), api: {
    context: async () => { throw Error('must not infer while hydrating'); },
    ask: () => new Promise(resolve => { finish = resolve; }),
    cancel: async id => { cancels.push(id); },
    listen: async cb => { progress = cb; return () => {}; },
  } };
}
function storage() {
  const rows = new Map(), deleted = [], lists = [];
  return { rows, deleted, lists, api: {
    list: async (options = {}) => { lists.push(options); return [...rows.values()].filter(t => options.terminalId === undefined || t.source.terminalId === options.terminalId).map(t => structuredClone(t)); },
    save: async t => { rows.set(t.id, structuredClone(t)); },
    remove: async id => { deleted.push(id); rows.delete(id); },
  } };
}
function submit(model, terminal = 'old-pty') {
  model.stage('quote', source(terminal)); model.setQuestion('question'); return model.submitEmbedded();
}

test('native ESM model: submit/stream/save/dispose/recreate retains records; terminal closure never deletes; explicit delete only target', async () => {
  const db = storage(), wire = transport(), model = new BtwThreadModel(wire.api, db.api);
  await model.start(); const first = submit(model); await tick();
  const req = model.getSnapshot().entries[0];
  wire.progress({ requestId: req.requestId, threadId: first, text: 'partial' });
  await model.flushPersistence(); assert.equal(db.rows.get(first).answer, 'partial');
  wire.finish('complete'); await tick(); model.setDraft(first, 'follow-up draft');
  await model.flushPersistence(); const second = submit(model, 'other-pty'); await tick();
  model.reconcileTerminals([]); await model.flushPersistence(); assert.equal(db.rows.size, 2); assert.deepEqual(db.deleted, []);
  model.dispose(); wire.finish('late'); await tick(); await model.flushPersistence(); assert.deepEqual(db.deleted, []);
  const restored = new BtwThreadModel(transport().api, db.api); await restored.start();
  assert.equal(restored.getSnapshot().entries.find(t => t.id === first).messages[1].content, 'complete');
  assert.equal(restored.getSnapshot().entries.find(t => t.id === first).draft, 'follow-up draft');
  assert.equal(restored.getSnapshot().entries.find(t => t.id === second).status, 'stopped');
  restored.activateTerminal('new-runtime-pty'); await restored.loadHistory('', true);
  assert.equal(db.lists.at(-1).terminalId, undefined);
  restored.selectEmbedded(first); assert.equal(restored.getSnapshot().terminalId, 'new-runtime-pty');
  assert.equal(restored.getSnapshot().entries.find(t => t.id === first).source.terminalId, 'old-pty');
  assert.equal(restored.getSnapshot().openVersion, 0);
  restored.remove(second); await restored.flushPersistence();
  assert.deepEqual(db.deleted, [second]); assert.equal(db.rows.has(first), true); restored.dispose();
});

test('hydration never suppresses writes; stale queries cannot resurrect explicit deletion', async () => {
  const db = storage(), wire = transport(); let hydrate;
  db.api.list = () => new Promise(resolve => { hydrate = resolve; });
  const model = new BtwThreadModel(wire.api, db.api), starting = model.start(); await tick();
  const id = submit(model); await tick(); await model.flushPersistence();
  assert.equal(db.rows.has(id), true);
  const stale = structuredClone(db.rows.get(id)); model.remove(id); await model.flushPersistence();
  hydrate([stale]); await starting;
  assert.equal(model.getSnapshot().entries.length, 0); assert.equal(db.rows.size, 0); model.dispose();
});

test('save failures remain visible, retry ordered deletion rather than resurrecting failed snapshots', async () => {
  const db = storage(), wire = transport(); let broken = true;
  const save = db.api.save; db.api.save = async t => { if (broken) throw Error('disk full'); await save(t); };
  const model = new BtwThreadModel(wire.api, db.api); const id = submit(model); await tick(); await model.flushPersistence();
  assert.match(model.getSnapshot().persistenceError, /disk full/);
  broken = false; await model.retryPersistence(); assert.equal(db.rows.has(id), true); assert.equal(model.getSnapshot().persistenceError, null);
  db.api.remove = async () => { throw Error('delete denied'); }; model.remove(id); await model.flushPersistence();
  assert.match(model.getSnapshot().persistenceError, /delete denied/);
  db.api.remove = async key => { db.rows.delete(key); }; await model.retryPersistence();
  assert.equal(db.rows.size, 0); assert.equal(model.getSnapshot().persistenceError, null); model.dispose();
});

test('queued saves are coalesced and final snapshot wins before explicit delete', async () => {
  let release; const db = storage(), wire = transport(), saved = [];
  const save = db.api.save; db.api.save = async t => { saved.push(t); if (saved.length === 1) await new Promise(r => { release = r; }); await save(t); };
  const model = new BtwThreadModel(wire.api, db.api), id = submit(model); await tick();
  const req = model.getSnapshot().entries[0];
  for (let n = 0; n < 1000; n++) wire.progress({ requestId: req.requestId, threadId: id, text: `chunk-${n}` });
  wire.finish('final'); await tick(); release(); await model.flushPersistence();
  assert.ok(saved.length <= 3); assert.equal(db.rows.get(id).messages.at(-1).content, 'final');
  model.remove(id); await model.flushPersistence(); assert.equal(db.rows.size, 0); model.dispose();
});

// Native import of the actual ESM repository + hook with only platform/UI boundaries injected.
// No CommonJS require fallback and no real user database access.
test('actual ESM hook loads real repository and preserves complete message ordering through fake SQL', async () => {
  const rows = new Map(), messages = new Map();
  const db = {
    select: async (sql, args) => {
      if (sql.includes('FROM btw_messages')) return [...messages.values()].filter(m => args.includes(m.thread_id)).sort((a,b) => a.ordinal-b.ordinal);
      if (sql.includes('WHERE id=')) return rows.has(args[0]) ? [rows.get(args[0])] : [];
      return [...rows.values()];
    },
    execute: async (sql, args) => {
      if (sql.startsWith('INSERT INTO btw_threads')) {
        assert.equal(rows.has(args[0]), false, 'concurrent save must not duplicate INSERT');
        rows.set(args[0], Object.fromEntries(['id','source_terminal_id','source_session_id','source_reason','quote','title','inherit','context_snapshot','context_reason','context_truncated','status','draft','error'].map((k,i) => [k,args[i]])));
      } else if (sql.startsWith('INSERT INTO btw_messages')) {
        messages.set(`${args[0]}:${args[1]}`, { thread_id: args[0], ordinal: args[1], role: args[2], content: args[3] });
      } else if (sql.startsWith('UPDATE btw_threads')) {
        const row = rows.get(args.at(-1));
        for (const [, key, n] of sql.matchAll(/(\w+)=\$(\d+)/g)) if (key !== 'id') row[key] = args[Number(n)-1];
      } else if (sql.startsWith('DELETE FROM btw_messages')) {
        for (const [key,m] of messages) if (m.thread_id === args[0] && m.ordinal >= args[1]) messages.delete(key);
      } else if (sql.startsWith('DELETE FROM btw_threads')) rows.delete(args[0]);
      else throw Error(sql);
    },
  };
  globalThis.__btwTestDb = db;
  try {
    const dbUrl = url('export const getDb = async () => globalThis.__btwTestDb;');

    const repoUrl = url(compile('src/features/terminal/lib/btwThreadRepository.ts').replace('"../../../shared/platform/db"', JSON.stringify(dbUrl)));
    const repo = await import(repoUrl);
    const modelUrl = url(compile('src/features/terminal/lib/btwThreadModel.ts'));
    const stubs = {
      './useBtwNativeWindow': 'export const useBtwNativeWindow = () => {};',
      '../state': 'export const useTerminalStore = { getState: () => ({}) };',
      '../lib/btwSource': 'export const resolveBtwSource = () => ({});',
      '@tauri-apps/api/core': 'export const invoke = async () => "ESM answer";',
      '@tauri-apps/api/event': 'export const listen = async () => () => {};',
      react: 'export const useEffect = () => {}; export const useMemo = f => f(); export const useRef = v => ({current:v}); export const useSyncExternalStore = (_,get) => get();',
    };
    let hookCode = compile('src/features/terminal/hooks/useBtwSideQuestion.ts');
    for (const [specifier, code] of Object.entries(stubs)) hookCode = hookCode.replace(JSON.stringify(specifier), JSON.stringify(url(code)));
    hookCode = hookCode.replace('"../lib/btwThreadModel"', JSON.stringify(modelUrl)).replace('"../lib/btwThreadRepository"', JSON.stringify(repoUrl));
    assert.doesNotMatch(hookCode, /require\(/);
    const { useBtwSideQuestion } = await import(url(hookCode));
    const { model } = useBtwSideQuestion(); const id = submit(model); await tick(); await model.flushPersistence();
    assert.equal((await repo.getBtwThread(id)).messages[1].content, 'ESM answer');
    const saved = model.getSnapshot().entries[0];
    await Promise.all([repo.saveBtwThread({...saved, id:'concurrent'}),repo.saveBtwThread({...saved, id:'concurrent'})]);
    await repo.saveBtwThread({...saved, id:'interrupted', status:'pending', messages:[{role:'user',content:'q'}], answer:'partial'});
    const recovered = await repo.getBtwThread('interrupted');
    assert.equal(recovered.status, 'stopped'); assert.equal(recovered.answer, 'partial'); assert.equal(recovered.messages.length,1);
    model.dispose(); assert.equal(rows.has(id), true);
  } finally { delete globalThis.__btwTestDb; }
});

test('read failure is actionable, recovery is display-only, latest query wins and paging never deletes', async () => {
  const db = storage(), model = new BtwThreadModel(transport().api, db.api);
  db.api.list = async () => { throw Error('read denied'); };
  await model.start(); assert.match(model.getSnapshot().persistenceError, /read denied/);
  db.api.list = async () => [];
  await model.retryPersistence(); assert.equal(model.getSnapshot().persistenceError, null);
  const pending = [];
  db.api.list = options => new Promise(resolve => pending.push({ options, resolve }));
  const a = model.loadHistory('first'); await tick(); const b = model.loadHistory('second', true, undefined, 100); await tick();
  pending[1].resolve([]); await b; pending[0].resolve([{ id:'stale' }]); await a;
  assert.equal(model.getSnapshot().entries.length,0);
  assert.equal(pending[1].options.offset,100); assert.deepEqual(db.deleted,[]); model.dispose();
});

test('confirmed clear only uses deliberate deletion path, including during initial hydration', async () => {
  const db = storage(), model = new BtwThreadModel(transport().api, db.api);
  let hydrate; db.api.list = () => new Promise(resolve => { hydrate = resolve; });
  const starting = model.start(); await tick(); const id = submit(model); await tick();
  model.clear(); await model.flushPersistence(); hydrate([]); await starting;
  assert.deepEqual(db.deleted,[id]); assert.equal(db.rows.size,0); model.dispose();
});
