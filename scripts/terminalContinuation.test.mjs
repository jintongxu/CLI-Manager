import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
globalThis.self=globalThis;
globalThis.window=globalThis;
const windowEvents=new EventTarget();
globalThis.addEventListener=windowEvents.addEventListener.bind(windowEvents);
globalThis.removeEventListener=windowEvents.removeEventListener.bind(windowEvents);
Object.defineProperty(globalThis,'navigator',{value:{platform:'Linux',userAgent:'node',language:'en-US'},configurable:true});
const require=createRequire(import.meta.url);
const {Terminal}=require('@xterm/xterm');
const dir=mkdtempSync(join(tmpdir(),'continuation-'));
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
writeFileSync(join(dir,'entry.ts'),`
export * from '${resolve('src/shared/lib/terminalContinuation.ts').replaceAll('\\','/')}';
export * from '${resolve('src/shared/lib/terminalHistoricalParser.ts').replaceAll('\\','/')}';
export * from '${resolve('src/features/terminal/hooks/useTerminalDisplay.ts').replaceAll('\\','/')}';
export * from '${resolve('src/features/terminal/hooks/useTerminalInput.ts').replaceAll('\\','/')}';
`);
writeFileSync(join(dir,'seams.mjs'),`
export const writes=[], binary=[], resizes=[], callbacks={output:null,disconnect:null}, session={id:'test'};
export const settings={terminalInputSuggestionsEnabled:false,terminalFontSize:14};
export const TERMINAL_FONT_SIZE_MAX=40,TERMINAL_FONT_SIZE_MIN=8;
export const useRef=current=>({current});
export const useSettingsStore={getState:()=>settings};
export const useTerminalStore={getState:()=>({sessions:[session],recordPtyOutputActivity(){},markAttentionInputHandled(){}})};
export const useCommandHistoryStore={getState:()=>({entries:[],addEntry(){}})};
export const useTemplateStore={getState:()=>({templates:[]})};
export const useProjectStore={getState:()=>({projects:[]})};
export const terminalProcessManager={
 async write(id,data){writes.push(data);},async writeBinary(id,data){binary.push(data);},async resize(id,cols,rows){resizes.push({id,cols,rows});},
 hasInteractivePriority:()=>false,consumeInteractivePriority:()=>false,
 subscribeDisconnect(fn){callbacks.disconnect=fn;return()=>{callbacks.disconnect=null;};},
 async subscribeOutput(id,fn){callbacks.output=fn;return()=>{callbacks.output=null;};}
};
export function markTerminalSnapshotDirty(){}
export function refreshTerminalViewport(){}
export function logError(...args){throw new Error(JSON.stringify(args));}
export function logWarn(){}
export function translateCurrent(){return '';}
export async function sshRemoteAttachFilesForSession(){return [];}
export async function invoke(command){return command==='clipboard_attach_image_files'?{paths:[],hadFiles:false,rejectedCount:0}:[];}
export const toast={error(){}};
export const clipboard={pending:null,reads:0};
export const readText=()=>{clipboard.reads++;return new Promise(resolve=>{clipboard.pending=resolve;});};
export const getCurrentWebview=()=>({onDragDropEvent:async()=>()=>{}});
export const getCurrentWindow=()=>({scaleFactor:async()=>1});
export class WebglAddon {}
`);
const seamNames=new Set(['react','@tauri-apps/api/core','@tauri-apps/api/webview','@tauri-apps/api/window','@tauri-apps/plugin-clipboard-manager','sonner','@xterm/addon-webgl']);
const seamSuffix=/\/(state|settingsStore|commandHistoryStore|templateStore|projectStore|TerminalProcessManager|sessionSnapshotPersistence|logger|terminalVisibility|sshRemoteFiles)$/;
await build({entryPoints:[join(dir,'entry.ts')],bundle:true,platform:'node',format:'esm',outfile:join(dir,'entry.mjs'),plugins:[{name:'platform-seams',setup(b){b.onResolve({filter:/.*/},args=>{
 if(seamNames.has(args.path)||seamSuffix.test(args.path)||args.path==='../../../shared/i18n/index')return {path:pathToFileURL(join(dir,'seams.mjs')).href,external:true};
});}}]});
const m=await import(pathToFileURL(join(dir,'entry.mjs')));
const seams=await import(pathToFileURL(join(dir,'seams.mjs')));
const ref=current=>({current});
const tick=()=>new Promise(r=>setTimeout(r,20));
const frames=new Map();let rafId=0;
globalThis.requestAnimationFrame=fn=>{const id=++rafId;frames.set(id,fn);return id;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
function raf(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(performance.now()));}
function fixture(width=800,height=400, pasteContainer=null, viewport={}){
 const t=new Terminal({allowProposedApi:true,cols:80,rows:24});t._core.textarea={value:'',focus(){}};
 t.select=()=>{}; // DOM selection painting only; real buffer, parser and input remain.

 m.beginTerminalContinuation(t);
 const parser=m.installTerminalHistoricalParser(t,()=>m.canAcceptTerminalInput(t));
 const container={offsetWidth:width,offsetHeight:height,addEventListener(){},removeEventListener(){}};
 const dimensions=viewport.dimensions??{cols:60,rows:16};
 const visible=ref(viewport.visible??false);
 const display=m.useTerminalDisplay({
  sessionId:'test',minTerminalCols:viewport.minTerminalCols,containerRef:ref(container),terminalRef:ref(t),
  fitAddonRef:ref({proposeDimensions:()=>dimensions}),isVisibleRef:visible,isComposingRef:ref(false),
  lowMemoryMode:false,disableHardwareAcceleration:true,disableWebglForSessionRef:ref(true),
  linuxGraphicsDisableWebgl:true,isTransparentRef:ref(false),normalizeOutputRef:ref(x=>x),
  transformOutputRef:ref(x=>x),afterTerminalWriteRef:ref(null),onPtyOutputListenError:err=>{throw err;},
 });
 const input=m.useTerminalInput({sessionId:'test',wrapperRef:ref(null),containerRef:ref(pasteContainer),isActiveRef:ref(true),isVisibleRef:ref(true),fontSize:14,canShowSuggestionAtCurrentInputEnd:()=>false,getTerminalRenderedCellSize:()=>({width:8,height:16}),setSuggestionGhost(){},getOsPlatformForPathQuoting:async()=> 'linux'});
 const selection=input.attachSelection(t,{markAttentionInputHandled(){},reportPtyWriteError(err){throw err;}});
 const forwarding=input.attachInputForwarding(t,{selection,osPlatformRef:ref('linux'),markAttentionInputHandled(){},reportPtyWriteError(err){throw err;},updateSessionCwdIfChanged(){},onInputForwarded(){}});
 return {t,container,dimensions,visible,display,input,selection,forwarding,parser,close(){forwarding.dispose();selection.dispose();display.resetOutputState();parser.dispose();m.disposeTerminalContinuation(t);t.dispose();frames.clear();}};
}
function frame(sequence,text,kind='output',end=false){return {frame:{sessionId:'test',sequence,kind,data:new TextEncoder().encode(text),cols:80,rows:24,replayBatchEnd:end},commit(){}};}
async function write(t,text,origin='live'){await new Promise(r=>m.writeTerminalOutput(t,text,origin,r));}
test('real input hook rejects keyboard/paste/IME/binary and local edits, live protocol replies bypass readiness',async()=>{
 const f=fixture();seams.writes.length=0;seams.binary.length=0;
 try{
  f.t._core.coreService.triggerDataEvent('keyboard',true);f.t.paste('paste');f.forwarding.forwardTerminalInput('IME','nativeTextInput');f.t._core.coreService.triggerBinaryEvent('mouse');
  assert.equal(f.selection.selectCurrentInputText(),false);assert.equal(f.selection.extendKeyboardInputSelection(1),false);assert.equal(f.selection.removeSelectedInputText(),false);
  await write(f.t,'\x1b[c\x1b[6n');assert.equal(seams.writes.length,2);assert.deepEqual(seams.binary,[]);
  await write(f.t,'\x1b[c\x1b[6n','history');assert.equal(seams.writes.length,2);
  for(const b of ['hydrated','output','fitted'])m.markTerminalContinuation(f.t,b);
  f.forwarding.forwardTerminalInput('abc','nativeTextInput');assert.equal(seams.writes.at(-1),'abc');
  const count=seams.writes.length;m.suspendTerminalContinuation(f.t);
  f.selection.removeSelectedInputText();f.input.pasteText(f.t,'new');assert.equal(seams.writes.length,count);
  for(const b of ['output','fitted'])m.markTerminalContinuation(f.t,b);
  f.selection.extendKeyboardInputSelection(-1);assert.equal(seams.writes.at(-1),'\x1b[D');
 }finally{f.close();}
});
test('replay-end waits for real hidden geometry fit; reconnect closes input until replay/fit',async()=>{
 const f=fixture(0,0);m.markTerminalContinuation(f.t,'hydrated');
 try{
  const output=f.display.attachPtyOutput({waitForReplay:true});await output.ready;
  const complete=output.completeReplay([]);
  seams.callbacks.output(frame(0,'','reset'));seams.callbacks.output(frame(1,'restored','replay'));seams.callbacks.output(frame(0,'','replay',true));
  for(let i=0;i<4;i++){raf();await tick();}
  assert.equal(m.canAcceptTerminalInput(f.t),false);
  f.container.offsetWidth=600;f.container.offsetHeight=300;f.display.scheduleFit(true);raf();await tick();assert.equal(await complete,true);
  assert.equal(m.canAcceptTerminalInput(f.t),true);assert.equal(f.t.cols,60);assert.equal(f.t.rows,16);
  const stalePaste=m.captureTerminalInputPermission(f.t);seams.callbacks.disconnect();assert.equal(m.canAcceptTerminalInput(f.t),false);
  // Pending old live output cannot reopen readiness while reconnect waits.
  seams.callbacks.output(frame(2,'tail'));raf();await tick();assert.equal(m.canAcceptTerminalInput(f.t),false);
  seams.callbacks.output(frame(0,'','replay',true));raf();await tick();assert.equal(m.canAcceptTerminalInput(f.t),true);assert.equal(stalePaste(),false);
  output.dispose();m.disposeTerminalContinuation(f.t);assert.equal(stalePaste(),false);
 }finally{f.close();}
});
test('async paste permission belongs to the original readiness generation and never queues rejected input',()=>{
 const f=fixture();
 try{
  const rejected=m.captureTerminalInputPermission(f.t);for(const b of ['hydrated','output','fitted'])m.markTerminalContinuation(f.t,b);assert.equal(rejected(),false);
  const accepted=m.captureTerminalInputPermission(f.t);assert.equal(accepted(),true);m.invalidateTerminalFit(f.t);m.markTerminalContinuation(f.t,'fitted');assert.equal(accepted(),false);
  const priorOwner=m.captureTerminalInputPermission(f.t);m.beginTerminalContinuation(f.t);for(const b of ['hydrated','output','fitted'])m.markTerminalContinuation(f.t,b);assert.equal(priorOwner(),false);
 }finally{f.close();}
});
test('reset arriving during async parse cancels old commit/protocol then replays at daemon prefix',async()=>{
 const f=fixture();m.markTerminalContinuation(f.t,'hydrated');seams.writes.length=0;
 try{
  const output=f.display.attachPtyOutput();await output.ready;
  f.display.scheduleFit(true);raf();await tick();
  let resume,enteredResolve,oldCommits=0;const entered=new Promise(r=>enteredResolve=r);
  f.t.parser.registerCsiHandler({final:'z'},()=>new Promise(r=>{resume=r;enteredResolve();}));
  const stale=frame(22,'PARTIAL\x1b[z\x1b[6nTAIL');stale.commit=()=>oldCommits++;
  seams.callbacks.output(stale);raf();await entered;
  seams.callbacks.output(frame(0,'','reset'));seams.callbacks.output(frame(5,'authoritative','replay'));seams.callbacks.output(frame(0,'','replay',true));
  resume(true);await tick();for(let i=0;i<4;i++){raf();await tick();}
  assert.equal(oldCommits,0);assert.deepEqual(seams.writes,[]);
  assert.equal(f.t.buffer.active.getLine(0).translateToString(true),'authoritative');assert.equal(m.canAcceptTerminalInput(f.t),true);
  output.dispose();
 }finally{f.close();}
});
test('actual async clipboard completion rejects old reconnect/owner and never defers rejected paste',async()=>{
 class Container extends EventTarget {getBoundingClientRect(){return {left:0,top:0,right:100,bottom:100};}}
 const container=new Container(),f=fixture(800,400,container);
 const detach=f.input.attachPasteAndDrop(f.t);seams.writes.length=0;seams.clipboard.reads=0;
 const paste=()=>{const e=new Event('paste',{cancelable:true});Object.defineProperty(e,'clipboardData',{value:{files:[],types:[],getData:()=>''}});container.dispatchEvent(e);};
 try{
  paste();for(const b of ['hydrated','output','fitted'])m.markTerminalContinuation(f.t,b);await tick();assert.equal(seams.clipboard.reads,0);
  paste();await tick();assert.equal(seams.clipboard.reads,1);m.suspendTerminalContinuation(f.t);for(const b of ['output','fitted'])m.markTerminalContinuation(f.t,b);
  seams.clipboard.pending('old-generation');await tick();assert.deepEqual(seams.writes,[]);
  paste();await tick();m.disposeTerminalContinuation(f.t);seams.clipboard.pending('old-owner');await tick();assert.deepEqual(seams.writes,[]);
 }finally{detach();f.close();}
});

test('sidebar narrow fit completes replay barrier and forwards narrow resize using the same minimum',async()=>{
 const previousDocument=globalThis.document,previousObserver=globalThis.ResizeObserver;
 globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 let observe;
 globalThis.ResizeObserver=class {constructor(fn){observe=fn;}observe(){}disconnect(){}};
 const f=fixture(300,400,null,{minTerminalCols:8,visible:true,dimensions:{cols:28,rows:16}});
 m.markTerminalContinuation(f.t,'hydrated');seams.resizes.length=0;
 const detach=f.display.attachViewport(f.t);
 try{
  const output=f.display.attachPtyOutput({waitForReplay:true});await output.ready;
  const complete=output.completeReplay([]);
  seams.callbacks.output(frame(0,'','replay',true));raf();await tick();
  assert.equal(await complete,true);
  assert.equal(m.canAcceptTerminalInput(f.t),true);
  assert.deepEqual(f.display.getPtyViewportSize(),{cols:28,rows:16});
  assert.deepEqual(seams.resizes.at(-1),{id:'test',cols:28,rows:16});
  f.dimensions.cols=20;
  observe([{contentRect:{width:220,height:400}}]);
  assert.equal(m.canAcceptTerminalInput(f.t),false);
  raf();assert.equal(f.t.cols,20);assert.equal(m.canAcceptTerminalInput(f.t),true);
  assert.deepEqual(seams.resizes.at(-1),{id:'test',cols:20,rows:16});
  f.dimensions.cols=7;f.display.scheduleFit(true);raf();
  assert.equal(f.t.cols,20);assert.equal(m.canAcceptTerminalInput(f.t),false);
  const count=seams.resizes.length;f.t.resize(7,16);assert.equal(seams.resizes.length,count);
  f.dimensions.cols=8;f.display.scheduleFit(true);raf();assert.equal(m.canAcceptTerminalInput(f.t),true);
  assert.deepEqual(seams.resizes.at(-1),{id:'test',cols:8,rows:16});
  output.dispose();
 }finally{detach();f.close();globalThis.document=previousDocument;globalThis.ResizeObserver=previousObserver;}
});

test('ordinary fit still requires 40 columns and sidebar retains the 8-row guard',()=>{
 for(const [minTerminalCols,cols,rows] of [[undefined,39,16],[8,28,7]]){
  const f=fixture(300,400,null,{minTerminalCols,dimensions:{cols,rows}});
  try{
   m.markTerminalContinuation(f.t,'hydrated');m.markTerminalContinuation(f.t,'output');
   f.display.scheduleFit(true);raf();assert.equal(m.canAcceptTerminalInput(f.t),false);assert.equal(f.t.cols,80);
   Object.assign(f.dimensions,{cols:minTerminalCols??40,rows:8});
   f.display.scheduleFit(true);raf();assert.equal(m.canAcceptTerminalInput(f.t),true);
  }finally{f.close();}
 }
});
