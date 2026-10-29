import test from 'node:test';
import { createRequire } from 'node:module';
globalThis.self=globalThis;
const {Terminal}=createRequire(import.meta.url)('@xterm/xterm');
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = mkdtempSync(join(tmpdir(), 'hidden-renderer-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const seam = join(dir, 'seam.mjs');
writeFileSync(seam, `
export const refs=[]; let cursor=0; export function render(){cursor=0;}
export function useRef(value){return refs[cursor++] ?? (refs[cursor-1]={current:value});}
export const addons=[];
export class WebglAddon { constructor(){this.disposed=0;addons.push(this);} onContextLoss(){} dispose(){this.disposed++;} }
export function watchTerminalWebglLoss(){return ()=>{};}
export function isLightTerminalTheme(){return false;}
export function logWarn(){} export function logError(){throw Error('unexpected error');}
export function markTerminalSnapshotDirty(){} export function refreshTerminalViewport(){}
export const TERMINAL_FONT_SIZE_MAX=40,TERMINAL_FONT_SIZE_MIN=8;
export const useSettingsStore={getState:()=>({})};
export const useTerminalStore={getState:()=>({recordPtyOutputActivity(){}})};
export const callbacks={};
export const terminalProcessManager={subscribeDisconnect(){return ()=>{};},async subscribeOutput(id,fn){callbacks.output=fn;return ()=>{callbacks.output=null;};},consumeInteractivePriority(){return false;}};
`);
writeFileSync(join(dir,'entry.ts'), ['src/features/terminal/hooks/useTerminalDisplay.ts','src/shared/lib/terminalHistoricalParser.ts'].map(p => 'export * from '+JSON.stringify(resolve(p))+';').join(' '));
await build({ entryPoints:[join(dir,'entry.ts')], bundle:true, platform:'node', format:'esm', outfile:join(dir,'hook.mjs'), plugins:[{name:'seams',setup(b){b.onResolve({filter:/.*/},a=>{
 if (a.path==='react'||a.path==='@xterm/addon-webgl'||/\/(terminalWebglLoss|terminalThemes|logger|sessionSnapshotPersistence|TerminalProcessManager|settingsStore|state|terminalVisibility)$/.test(a.path)) return {path:pathToFileURL(seam).href,external:true};
});}}] });
const {useTerminalDisplay,installTerminalHistoricalParser}=await import(pathToFileURL(join(dir,'hook.mjs')));
const seams=await import(pathToFileURL(seam));
const timers=new Map(); let now=0,id=0;
globalThis.window={setTimeout(fn,delay){timers.set(++id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);}};
function advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}
const ref=current=>({current});
test('production hook releases only GPU at 60s, parses hidden output, revives once, cancels stale callbacks',async()=>{
 const visible=ref(true), terminal=new Terminal({allowProposedApi:true,cols:80,rows:24});
 terminal.loadAddon=()=>{};
 const parser=installTerminalHistoricalParser(terminal,()=>true);
 const options={sessionId:'same-pty',containerRef:ref(null),terminalRef:ref(terminal),fitAddonRef:ref(null),isVisibleRef:visible,isComposingRef:ref(false),lowMemoryMode:true,disableHardwareAcceleration:false,disableWebglForSessionRef:ref(false),linuxGraphicsDisableWebgl:false,isTransparentRef:ref(false),normalizeOutputRef:ref(x=>x),transformOutputRef:ref(x=>x),afterTerminalWriteRef:ref(null),onPtyOutputListenError:assert.fail};
 const render=()=>{seams.render();return useTerminalDisplay(options);};
 let display=render();display.syncWebglRenderer(terminal,{});assert.equal(seams.addons.length,1);
 const output=display.attachPtyOutput();await output.ready;
 visible.current=false;display.scheduleHiddenWebglDispose(true);advance(30000);display.scheduleHiddenWebglDispose(true);advance(29999);assert.equal(seams.addons[0].disposed,0);
 advance(1);assert.equal(seams.addons[0].disposed,1);
 let commits=0;seams.callbacks.output({frame:{kind:'output',sequence:1,data:new TextEncoder().encode('hidden output'),cols:80,rows:24},commit(){commits++;}});
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(terminal.buffer.active.getLine(0).translateToString(true),'hidden output');assert.equal(commits,1);
 visible.current=true;display.clearHiddenWebglDisposeTimer();display.syncWebglRenderer(terminal,{});display.syncWebglRenderer(terminal,{});assert.equal(seams.addons.length,2);assert.equal(options.terminalRef.current,terminal);
 visible.current=false;display.scheduleHiddenWebglDispose(true);const stale=[...timers.values()][0].fn;display.clearHiddenWebglDisposeTimer();visible.current=true;stale();assert.equal(seams.addons[1].disposed,0);
 visible.current=false;display.scheduleHiddenWebglDispose(true);advance(60000);assert.equal(seams.addons[1].disposed,1);
 options.lowMemoryMode=false;display=render();display.syncWebglRenderer(terminal,{});display.scheduleHiddenWebglDispose(false);assert.equal(seams.addons.length,3,'setting-off restores even while hidden');
 options.lowMemoryMode=true;display=render();display.scheduleHiddenWebglDispose(true);const afterUnmount=[...timers.values()][0].fn;display.clearHiddenWebglDisposeTimer();display.disposeWebglRenderer();output.dispose();afterUnmount();assert.equal(seams.addons[2].disposed,1);assert.equal(seams.callbacks.output,null);parser.dispose();terminal.dispose();
});
