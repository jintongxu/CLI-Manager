import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
globalThis.self = globalThis;
const require = createRequire(import.meta.url);
const {Terminal} = require('@xterm/xterm');
const {SerializeAddon} = require('@xterm/addon-serialize');
const dir = mkdtempSync(join(tmpdir(), 'terminal-snapshot-'));
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
await build({entryPoints:['src/features/terminal/lib/terminalSnapshotCapture.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'capture.mjs')});
const capture = await import(pathToFileURL(join(dir,'capture.mjs')));
const write = (t,text)=>new Promise(resolve=>t.write(text,resolve));
function terminal(cols,rows) {const t=new Terminal({cols,rows,scrollback:5000,allowProposedApi:true});const addon=new SerializeAddon();t.loadAddon(addon);return {t,addon};}
function cells(t) {
  const b=t.buffer.active;
  return {x:b.cursorX,y:b.cursorY,base:b.baseY,lines:Array.from({length:b.length},(_,i)=>{
    const line=b.getLine(i);
    return {wrap:line.isWrapped,cells:Array.from({length:t.cols},(_,j)=>{const c=line.getCell(j);return [c.getChars(),c.getWidth(),c.getFgColor(),c.getBgColor(),c.isBold(),c.isUnderline(),c.isInverse()];})};
  })};
}
for (const [cols,rows,targetCols,targetRows] of [[80,24,40,8],[40,8,100,30],[72,10,45,22],[42,30,95,8]]) {
  test(`actual serialize restore ${cols}x${rows} at source size then fit ${targetCols}x${targetRows}`,async()=>{
    const a=terminal(cols,rows), b=terminal(targetCols,targetRows);
    try {
      await write(a.t,'\x1b[38;2;120;40;90m\x1b[1;4m中文😀 '+ 'wrapped text '.repeat(24)+'\r\n\x1b[7mLAST\x1b[0m');
      const snapshot=capture.captureTerminalSnapshot(a.t,a.addon);
      assert.deepEqual(snapshot.size,{cols,rows});
      assert.equal(capture.restoreTerminalSnapshotSize(b.t,snapshot.size),true);
      await write(b.t,snapshot.text);
      assert.deepEqual(cells(b.t),cells(a.t));
      a.t.resize(targetCols,targetRows); b.t.resize(targetCols,targetRows);
      assert.deepEqual(cells(b.t),cells(a.t));
    } finally {a.t.dispose();b.t.dispose();}
  });
}
test('bounded addon scrollback retains leading SGR cells beyond 2000 lines and full checkpoint is separate',async()=>{
  const a=terminal(80,12),b=terminal(80,12),full=terminal(80,12);
  try {
    await write(a.t,'\x1b[31;44;1m'+Array.from({length:2505},(_,i)=>`row-${i} 中文😀`).join('\r\n'));
    const snap=capture.captureTerminalSnapshot(a.t,a.addon);
    assert.ok(snap.text.length<snap.checkpointText.length);
    await write(b.t,snap.text);await write(full.t,snap.checkpointText);
    assert.ok(b.t.buffer.active.length<=2012);
    const offset=a.t.buffer.active.length-b.t.buffer.active.length;
    assert.ok(offset>0);
    const actual=cells(b.t),expected=cells(a.t);
    assert.deepEqual(actual.lines,expected.lines.slice(offset));
    assert.equal(actual.x,expected.x);assert.equal(actual.y,expected.y);
    assert.deepEqual(cells(full.t),cells(a.t));
  } finally {a.t.dispose();b.t.dispose();full.t.dispose();}
});
test('legacy string without geometry remains compatible and invalid geometry is ignored',async()=>{
  const a=terminal(80,24);
  try {
    for(const size of [undefined,null,{cols:0,rows:24},{cols:40.5,rows:8},{cols:80,rows:NaN}]) assert.equal(capture.restoreTerminalSnapshotSize(a.t,size),false);
    assert.equal(a.t.cols,80);assert.equal(a.t.rows,24);
    await write(a.t,'\x1b[31mlegacy');
    assert.equal(a.t.buffer.active.getLine(0).translateToString(true),'legacy');
  } finally {a.t.dispose();}
});

// Execute production persistence with only its platform/store seams replaced.
writeFileSync(join(dir,'state.mjs'),`export const updates=[];export const sessions=[{id:'identity',projectId:'project',worktreeId:'wt',cwd:'original',hidden:true}];export const useTerminalStore={getState:()=>({sessions,updateSessionTerminalSnapshot(id,text,size,sequence){updates.push({id,text,size,sequence});Object.assign(sessions.find(s=>s.id===id),{initialTerminalOutput:text,initialTerminalSize:size,initialTerminalSequence:sequence});}})};`);
writeFileSync(join(dir,'session.mjs'),`export const saved=[];export const useSessionStore={getState:()=>({async saveSessions(sessions){saved.push(JSON.parse(JSON.stringify(sessions)));}})};`);
writeFileSync(join(dir,'logger.mjs'),'export function logError() {}');
await build({entryPoints:['src/features/terminal/api/sessionSnapshotPersistence.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'persistence.mjs'),plugins:[{name:'seams',setup(b){b.onResolve({filter:/^\.\.\/state$/},()=>({path:'./state.mjs',external:true}));b.onResolve({filter:/^\.\/sessionStore$/},()=>({path:'./session.mjs',external:true}));b.onResolve({filter:/logger$/},()=>({path:'./logger.mjs',external:true}));}}]});
const persistence=await import(pathToFileURL(join(dir,'persistence.mjs')));
const state=await import(pathToFileURL(join(dir,'state.mjs')));
const session=await import(pathToFileURL(join(dir,'session.mjs')));
test('persisted optional geometry, source identity, full checkpoint, legacy API and replacement capture fencing',async()=>{
  const checkpoint=[];
  const value={text:'\x1b[31mbounded',size:{cols:80,rows:24},checkpointText:'complete',sequence:7};
  let dispose=persistence.registerTerminalSnapshotSource('identity',()=>value,async(text,snapshot)=>checkpoint.push({text,size:snapshot.size}));
  await persistence.flushTerminalSnapshotsNow();
  assert.deepEqual(checkpoint,[{text:'complete',size:value.size}]);
  assert.deepEqual(session.saved.at(-1)[0],{id:'identity',projectId:'project',worktreeId:'wt',cwd:'original',hidden:true,initialTerminalOutput:value.text,initialTerminalSize:value.size,initialTerminalSequence:7});
  dispose();
  dispose=persistence.registerTerminalSnapshotSource('identity',()=> 'legacy string');
  await persistence.flushTerminalSnapshotsNow();assert.equal(state.updates.at(-1).text,'legacy string');assert.equal(state.updates.at(-1).size,undefined);dispose();
  let resolve;
  const oldDispose=persistence.registerTerminalSnapshotSource('identity',()=>new Promise(r=>{resolve=r;}));
  const pending=persistence.flushTerminalSnapshotsNow();
  const newDispose=persistence.registerTerminalSnapshotSource('identity',()=>({...value,text:'replacement'}));
  oldDispose();resolve({...value,text:'stale'});await pending;
  assert.notEqual(state.updates.at(-1).text,'stale');
  await persistence.flushTerminalSnapshotsNow();assert.equal(state.updates.at(-1).text,'replacement');newDispose();
});
test('session save retains whole objects; shell restore geometry only accompanies image; CLI resume never gets image',()=>{
  const store=readFileSync('src/features/terminal/store/terminalStore.ts','utf8');
  const sessionStore=readFileSync('src/features/terminal/api/sessionStore.ts','utf8');
  assert.match(store,/initialTerminalSize: initialTerminalOutput \? ps\.initialTerminalSize : undefined/);
  assert.match(store,/CLI 会话：[\s\S]*?initialTerminalOutput = restoredStartupCmd/);
  assert.match(sessionStore,/s\.set\("sessions", persistable\)/);
});

writeFileSync(join(dir,'manager.mjs'),`export const checkpoints=[];export let committed=7;export const setCommitted=n=>{committed=n;};export const terminalProcessManager={getCommittedSequence:()=>committed,async checkpoint(id,cols,rows,text,sequence){checkpoints.push({id,cols,rows,text,sequence});}};`);
await build({entryPoints:['src/shared/lib/terminalHistoricalParser.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'origin.mjs')});
const origin=await import(pathToFileURL(join(dir,'origin.mjs')));
await build({entryPoints:['src/features/terminal/lib/terminalSnapshotLifecycle.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'lifecycle.mjs'),plugins:[{name:'lifecycle-seams',setup(b){
  b.onResolve({filter:/terminalHistoricalParser$/},()=>({path:'./origin.mjs',external:true}));
  b.onResolve({filter:/sessionSnapshotPersistence$/},()=>({path:'./persistence.mjs',external:true}));
  b.onResolve({filter:/TerminalProcessManager$/},()=>({path:'./manager.mjs',external:true}));
  b.onResolve({filter:/^\.\.\/state$/},()=>({path:'./state.mjs',external:true}));
}}]});
const {createTerminalSnapshotLifecycle}=await import(pathToFileURL(join(dir,'lifecycle.mjs')));
const manager=await import(pathToFileURL(join(dir,'manager.mjs')));
test('real lifecycle exit and unmount use bounded committed capture, resize-only geometry, full same-state checkpoint',async()=>{
  const a=terminal(80,24);const owner=origin.installTerminalHistoricalParser(a.t);const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
  try {
    await write(a.t,'\x1b[31m'+Array.from({length:2200},(_,i)=>'line'+i).join('\r\n'));
    a.t.resize(42,8);
    await persistence.flushTerminalSnapshotsNow();
    const exit=state.updates.at(-1); const cp=manager.checkpoints.at(-1);
    assert.deepEqual(exit.size,{cols:42,rows:8});assert.equal(cp.cols,42);assert.equal(cp.rows,8);
    assert.ok(cp.text.length>exit.text.length);
    lifecycle.snapshotBeforeUnmount();
    assert.deepEqual(state.updates.at(-1),exit);
    const deferred=persistence.flushTerminalSnapshotsNow();
    lifecycle.dispose();await deferred;
    const count=state.updates.length;
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(state.updates.length,count,'disposed source write callback cannot update persisted replacement');
  } finally {lifecycle.dispose();owner.dispose();a.t.dispose();}
});

test('parsed writes are cheap; unmount serializes once, pending parse falls back to whole committed image, cancelled flush cannot publish',async()=>{
  const a=terminal(80,24);const owner=origin.installTerminalHistoricalParser(a.t);
  let captures=0;const serialize=a.addon.serialize.bind(a.addon);a.addon.serialize=(options)=>{captures++;return serialize(options);};
  const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
  try {
    assert.equal(captures,1,'initial whole fallback only');
    for(let i=0;i<25;i++)await write(a.t,'row'+i+String.fromCharCode(13,10));    a.t.resize(42,8);assert.equal(captures,1,'no serialize in parse/resize hot path');
    lifecycle.snapshotBeforeUnmount();assert.equal(captures,2);
    const whole=state.updates.at(-1);assert.deepEqual(whole.size,{cols:42,rows:8});
    let resume,enteredResolve;const entered=new Promise(r=>{enteredResolve=r;});
    a.t.parser.registerCsiHandler({final:'z'},()=>new Promise(r=>{resume=r;enteredResolve();}));
    a.t.write('PARTIAL[zTAIL');await entered;
    lifecycle.snapshotBeforeUnmount();assert.deepEqual(state.updates.at(-1),{...whole,sequence:undefined},'no half-parsed image or trusted continuation baseline');assert.equal(captures,2);
    const flush=persistence.flushTerminalSnapshotsNow();lifecycle.dispose();await flush;
    const count=state.updates.length;resume(true);await new Promise(r=>setTimeout(r,20));
    assert.equal(state.updates.length,count);assert.equal(captures,2);
  } finally {lifecycle.dispose();owner.dispose();a.t.dispose();}
});
test('coalesced concurrent exit flushes share bounded/full same-state capture',async()=>{
  const a=terminal(80,24);const owner=origin.installTerminalHistoricalParser(a.t);
  let captures=0;const serialize=a.addon.serialize.bind(a.addon);a.addon.serialize=o=>{captures++;return serialize(o);};
  const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
  try {
    await write(a.t,'committed');a.t.resize(42,8);
    await Promise.all([persistence.flushTerminalSnapshotsNow(),persistence.flushTerminalSnapshotsNow()]);
    assert.equal(captures,3,'initial plus one bounded and one full serialization');
    const cp=manager.checkpoints.at(-1);assert.deepEqual({cols:cp.cols,rows:cp.rows},state.updates.at(-1).size);
    assert.equal(cp.text,state.updates.at(-1).text);
  } finally {lifecycle.dispose();owner.dispose();a.t.dispose();}
});

test('resize-only dirty state triggers throttled capture; idle round does not serialize',async(t)=>{
  t.mock.timers.enable({apis:['setInterval']});
  const a=terminal(80,24);const owner=origin.installTerminalHistoricalParser(a.t);
  let captures=0;const serialize=a.addon.serialize.bind(a.addon);a.addon.serialize=o=>{captures++;return serialize(o);};
  const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
  try {
    t.mock.timers.tick(10000);await new Promise(r=>setTimeout(r,20));assert.equal(captures,1);
    a.t.resize(42,8);assert.equal(captures,1);
    t.mock.timers.tick(10000);await new Promise(r=>setTimeout(r,20));assert.equal(captures,3);
    assert.deepEqual(state.updates.at(-1).size,{cols:42,rows:8});
  } finally {lifecycle.dispose();owner.dispose();a.t.dispose();t.mock.timers.reset();}
});
test('exit barrier waits actual async parse and captures full checkpoint, not partial initial fallback',async()=>{
  const a=terminal(80,24);const owner=origin.installTerminalHistoricalParser(a.t);
  const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
  try {
    let resume,enteredResolve;const entered=new Promise(r=>{enteredResolve=r;});
    a.t.parser.registerCsiHandler({final:'z'},()=>new Promise(r=>{resume=r;enteredResolve();}));
    a.t.write('PREFIX\x1b[zTAIL');await entered;
    lifecycle.snapshotBeforeUnmount();assert.equal(state.updates.at(-1).text,'','initial whole fallback, not partial PREFIX');
    let done=false;const flush=persistence.flushTerminalSnapshotsNow().then(()=>{done=true;});
    await Promise.resolve();assert.equal(done,false);
    resume(true);await flush;
    const saved=state.updates.at(-1);const cp=manager.checkpoints.at(-1);
    assert.ok(saved.text.includes('PREFIXTAIL'));assert.ok(cp.text.includes('PREFIXTAIL'));
    assert.deepEqual(saved.size,{cols:80,rows:24});assert.equal(cp.cols,80);assert.equal(cp.rows,24);
  } finally {lifecycle.dispose();owner.dispose();a.t.dispose();}
});
for (const alternate of [false,true]) test(`live continuation modes and incremental drawing (alternate=${alternate})`,async()=>{
  const a=terminal(80,24),b=terminal(80,24);
  a.t.options.vtExtensions={kittyKeyboard:true};b.t.options.vtExtensions={kittyKeyboard:true};
  try {
    await write(a.t,'\x1b[=3u\x1b[>7u'+(alternate?'\x1b[?1049h\x1b[=9u\x1b[>11u':'')+'\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25l\x1b[3;18r\x1b[?6h\x1b[5;9H\x1b[31;44;1mHELLO');
    const snap=capture.captureTerminalSnapshot(a.t,a.addon,true,17);
    assert.equal(snap.sequence,17);
    await write(b.t,snap.text);
    assert.deepEqual(b.t.modes,a.t.modes);
    assert.equal(b.t._core.mouseStateService.activeEncoding,'SGR');
    assert.deepEqual(b.t._core.coreService.kittyKeyboard,a.t._core.coreService.kittyKeyboard);
    assert.equal(b.t._core._bufferService.buffer.scrollTop,a.t._core._bufferService.buffer.scrollTop);
    assert.equal(b.t._core._bufferService.buffer.scrollBottom,a.t._core._bufferService.buffer.scrollBottom);
    assert.deepEqual(cells(b.t),cells(a.t));
    await write(a.t,'\x1b[2C+\r\nNEXT\x1b[<u');await write(b.t,'\x1b[2C+\r\nNEXT\x1b[<u');
    assert.deepEqual(cells(b.t),cells(a.t));
    assert.deepEqual(b.t._core.coreService.kittyKeyboard,a.t._core.coreService.kittyKeyboard);
    a.t.resize(56,16);b.t.resize(56,16);
    await write(a.t,'\x1b[2A++');await write(b.t,'\x1b[2A++');assert.deepEqual(cells(b.t),cells(a.t));
  } finally {a.t.dispose();b.t.dispose();}
});
test('actual parser commit microtask fences unmount and capture sequence',async()=>{
 const a=terminal(80,24),owner=origin.installTerminalHistoricalParser(a.t);
 const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
 try {
  manager.setCommitted(7);
  let observed;
  // Parser callback commits AFTER xterm returns: layout cleanup in that gap must
  // reject the image even though xterm's FIFO token was already shifted.
  const parsed=a.t.onWriteParsed(()=>{lifecycle.snapshotBeforeUnmount();observed=state.updates.at(-1);});
  await new Promise(resolve=>origin.writeTerminalOutput(a.t,'new-prefix','live',()=>{manager.setCommitted(8);resolve();}));
  parsed.dispose();assert.equal(observed.sequence,undefined);
  await persistence.flushTerminalSnapshotsNow();assert.equal(state.updates.at(-1).sequence,8);
  const cp=manager.checkpoints.at(-1);assert.equal(cp.sequence,8);assert.ok(cp.text.includes('new-prefix'));
 }finally{manager.setCommitted(7);lifecycle.dispose();owner.dispose();a.t.dispose();}
});
test('alternate exit and right-margin incremental output retain normal cursor/style',async()=>{
 const a=terminal(80,24),b=terminal(80,24);
 try {
  await write(a.t,'\x1b[32mnormal\x1b[?1049h\x1b[34mALT');
  await write(b.t,capture.captureTerminalSnapshot(a.t,a.addon).text);
  await write(a.t,'\x1b[?1049l+');await write(b.t,'\x1b[?1049l+');assert.deepEqual(cells(b.t),cells(a.t));
  await write(a.t,'\x1b[1;1H'+'x'.repeat(80));
  const c=terminal(80,24);try{
   await write(c.t,capture.captureTerminalSnapshot(a.t,a.addon).text);
   await write(a.t,'WRAP');await write(c.t,'WRAP');assert.deepEqual(cells(c.t),cells(a.t));
  }finally{c.t.dispose();}
 }finally{a.t.dispose();b.t.dispose();}
});

for (const [prefix,suffix] of [['\x1b[31','mB'],['\x1b]2;title','\x07B'],['\x1bP$q','m\x1b\\B']]) test('incomplete VT carry retains prior safe checkpoint: '+JSON.stringify(prefix),async()=>{
 const a=terminal(10,8),b=terminal(10,8),owner=origin.installTerminalHistoricalParser(a.t);
 const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon);
 try {
  manager.setCommitted(20);await write(a.t,'SAFE');await persistence.flushTerminalSnapshotsNow();
  const safe=state.updates.at(-1),cp=manager.checkpoints.at(-1);
  manager.setCommitted(21);await write(a.t,'A'+prefix);
  await persistence.flushTerminalSnapshotsNow();assert.deepEqual(state.updates.at(-1),safe);assert.deepEqual(manager.checkpoints.at(-1),cp);
  lifecycle.snapshotBeforeUnmount();assert.deepEqual(state.updates.at(-1),safe);
  await write(b.t,safe.text);await write(b.t,'A'+prefix);await write(b.t,suffix);await write(a.t,suffix);
  assert.deepEqual(cells(b.t),cells(a.t));
  manager.setCommitted(22);await persistence.flushTerminalSnapshotsNow();assert.equal(state.updates.at(-1).sequence,22);
 } finally {manager.setCommitted(7);lifecycle.dispose();owner.dispose();a.t.dispose();b.t.dispose();}
});
test('nondefault region plus pending right-margin wrap continues on next row',async()=>{
 const a=terminal(10,8),b=terminal(10,8);
 try {await write(a.t,'\x1b[2;6r\x1b[2;1H\x1b[32m'+'x'.repeat(10)+'\x1b[34m');await write(b.t,capture.captureTerminalSnapshot(a.t,a.addon).text);
 assert.deepEqual(cells(b.t),cells(a.t));await write(a.t,'Y');await write(b.t,'Y');assert.deepEqual(cells(b.t),cells(a.t));
 }finally{a.t.dispose();b.t.dispose();}
});
test('alternate exit retains inactive normal scroll region and saved cursor attributes',async()=>{
 const a=terminal(10,8),b=terminal(10,8);
 try {await write(a.t,'\x1b[2;6r\x1b[5;3H\x1b[32;44mnormal\x1b[?1049h\x1b[3;7r\x1b[34mALT');await write(b.t,capture.captureTerminalSnapshot(a.t,a.addon).text);
 await write(a.t,'\x1b[?1049l+\r\nNEXT');await write(b.t,'\x1b[?1049l+\r\nNEXT');
 assert.equal(b.t._core._bufferService.buffer.scrollTop,1);assert.equal(b.t._core._bufferService.buffer.scrollBottom,5);assert.deepEqual(cells(b.t),cells(a.t));
 }finally{a.t.dispose();b.t.dispose();}
});
test('nondefault scroll region does not affect serialization of existing normal scrollback',async()=>{
 const a=terminal(10,8),b=terminal(10,8);
 try {await write(a.t,Array.from({length:30},(_,i)=>'row'+i).join('\r\n')+'\x1b[2;6r\x1b[2;1H'+'x'.repeat(10));await write(b.t,capture.captureTerminalSnapshot(a.t,a.addon).text);assert.deepEqual(cells(b.t),cells(a.t));}
 finally{a.t.dispose();b.t.dispose();}
});
test('normalizer-held prefix also retains prior baseline even when xterm itself is ground',async()=>{
 const a=terminal(10,8),owner=origin.installTerminalHistoricalParser(a.t);
 let normalizerComplete=true;
 const lifecycle=createTerminalSnapshotLifecycle('identity',a.t,a.addon,()=>true,()=>normalizerComplete);
 try {
  manager.setCommitted(30);await write(a.t,'safe');await persistence.flushTerminalSnapshotsNow();const safe=state.updates.at(-1);
  normalizerComplete=false;manager.setCommitted(31);
  await new Promise(r=>origin.writeTerminalOutput(a.t,'\x1b]52;c;','live',r,()=>''));
  assert.equal(a.t._core._inputHandler._parser.currentState,0);
  await persistence.flushTerminalSnapshotsNow();assert.deepEqual(state.updates.at(-1),safe);
  lifecycle.snapshotBeforeUnmount();assert.deepEqual(state.updates.at(-1),safe);
 } finally {manager.setCommitted(7);lifecycle.dispose();owner.dispose();a.t.dispose();}
});
for (const alternate of [false,true]) test(`region right-margin wide cell/style/origin continuation (alternate=${alternate})`,async()=>{
 const a=terminal(10,8),b=terminal(10,8);
 try {await write(a.t,(alternate?'\x1b[?1049h':'')+'\x1b[2;6r\x1b[?6h\x1b[1;1H\x1b[38;2;15;20;25;44;1;4m'+'x'.repeat(8)+'中\x1b[35;0m');await write(b.t,capture.captureTerminalSnapshot(a.t,a.addon).text);
 assert.deepEqual(cells(b.t),cells(a.t));await write(a.t,'Y');await write(b.t,'Y');assert.deepEqual(cells(b.t),cells(a.t));
 }finally{a.t.dispose();b.t.dispose();}
});
test('direct capture rejects an unsafe committed VT baseline',async()=>{
 const a=terminal(10,8),owner=origin.installTerminalHistoricalParser(a.t);
 try {await write(a.t,'A\x1b[31');assert.throws(()=>capture.captureTerminalSnapshot(a.t,a.addon,true,1),/VT ground/);}
 finally{owner.dispose();a.t.dispose();}
});
