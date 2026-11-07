import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const root = "../src/features/terminal/";
function load(path, deps = {}) {
 const exports = {};
 const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:id=>{assert.ok(id in deps,id);return deps[id];}});
 return exports;
}
const gate=()=>{let release;return {promise:new Promise(r=>release=r),release:(v)=>release(v)};};
function fixture(extra={}) {
 const events=[], calls=[]; let session={id:"s",title:"source",createdAtMs:1,cwd:"/old"}; const busy={};
 const toast=Object.fromEntries(["info","success","error","loading","dismiss"].map(k=>[k,(...v)=>{events.push([k,...v]);return 1;}]));
 const module=load(root+"hooks/terminalRecoveryController.ts",{sonner:{toast}});
 const input={t:(key,values)=>key+JSON.stringify(values??{}),confirm:async()=>true,sessions:[session],setActive:()=>assert.fail("must not steal focus"),getSession:()=>session,
 isBusy:id=>busy[id],setBusy:(id,v)=>busy[id]=v,resolveContext:()=>({cwd:"/actual",environment:"wsl Ubuntu"}),
 probeSession:async()=>({attached:true,alive:true,cwd:"/actual"}),interruptSession:async()=>calls.push("interrupt"),openEmergencyTerminal:async()=>{calls.push("emergency");return "new";},rebuildSession:async()=>{calls.push("rebuild");return "new";},hardKillSession:async()=>calls.push("kill"),...extra};
 return {...module,input,handlers:module.createTerminalRecoveryHandlers(input),events,calls,busy,setSession:v=>session=v};
}
test("emergency uses one existing action, confirms real environment, retains normal activation ownership",async()=>{
 let confirmation;const f=fixture({confirm:async c=>{confirmation=c;return true;}});
 await f.handlers.emergency("s");assert.deepEqual(f.calls,["emergency"]);assert.match(confirmation.message,/actual/);assert.match(confirmation.message,/wsl Ubuntu/);assert.equal(confirmation.danger,false);assert.equal(f.busy.s,false);
});
test("pending confirmation disables duplicates across handler recreation; cancel clears busy",async()=>{
 const g=gate();const f=fixture({confirm:()=>g.promise});const first=f.handlers.rebuild("s");
 assert.equal(f.busy.s,true);await f.createTerminalRecoveryHandlers(f.input).hardKill("s");assert.deepEqual(f.calls,[]);
 g.release(false);await first;assert.equal(f.busy.s,false);
});
test("rebuild completes without post-commit focus change and gives feedback",async()=>{
 const f=fixture();await f.handlers.rebuild("s");assert.deepEqual(f.calls,["rebuild"]);assert.ok(f.events.some(e=>e[0]==="success"&&e[1].includes("rebuilt")));assert.ok(f.events.some(e=>e[0]==="dismiss"));
});
test("source changes during confirmation abort before invoking destructive action",async()=>{
 const g=gate();const f=fixture({confirm:()=>g.promise});const p=f.handlers.rebuild("s");await Promise.resolve();f.setSession({id:"s",createdAtMs:2});g.release(true);await p;assert.deepEqual(f.calls,[]);assert.ok(f.events.some(e=>String(e[1]).includes("sessionChanged")));
});
test("all core errors map specifically and ownership IDs survive cleanup/save failure",()=>{
 const f=fixture();for(const [code,key] of Object.entries({unsupported_remote:"unsupported",session_missing:"sessionMissing",session_changed:"sessionChanged",cwd_missing:"cwdMissing",worktree_missing:"worktreeMissing",wsl_environment_missing:"wslMissing",cleanup_failed:"cleanupFailed",persistence_failed:"persistenceFailed",close_failed:"closeFailed",create_failed:"createFailed"})){
 const error=Object.assign(new Error("terminal_recovery_"+code),{sessionId:code==="cleanup_failed"?"retained":undefined,committedSessionId:code==="persistence_failed"?"committed":undefined});
 const text=f.recoveryErrorMessage(f.input.t,error);assert.match(text,new RegExp(key));if(code==="cleanup_failed")assert.match(text,/retained/);if(code==="persistence_failed")assert.match(text,/committed/);
 }
});
test("SSH and nonPTY handlers explicitly reject without core actions",async()=>{
 for(const session of [{id:"s",environmentType:"ssh"},{id:"s",kind:"file-editor"}]){const f=fixture();f.setSession(session);await f.handlers.emergency("s");assert.deepEqual(f.calls,[]);assert.ok(f.events.some(e=>e[0]==="error"));}
});
test("shared menu risk groups, disabled reasons and navigation fallback execute",()=>{
 const nodes=[];const jsx=(type,props)=>{const n={type,props};nodes.push(n);return n;};
 const ui={ContextMenuItem:"item",ContextMenuLabel:"label",ContextMenuSeparator:"separator"};let state={recoveryBusy:{s:true}};
 const {TerminalRecoveryMenuItems}=load(root+"components/TerminalRecoveryMenuItems.tsx",{"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"fragment"},"../../../shared/i18n":{useI18n:()=>({t:k=>k})},"../../../shared/ui/context-menu":ui,"../state":{useTerminalStore:selector=>selector(state)}});
 TerminalRecoveryMenuItems({session:{id:"s"}});const items=nodes.filter(n=>n.type==="item");assert.equal(items.length,5);assert.ok(items.every(n=>n.props.disabled));assert.equal(items.filter(n=>n.props.danger).length,2);
 nodes.length=0;state={};TerminalRecoveryMenuItems({session:{id:"s",kind:"file-editor"}});assert.ok(nodes.some(n=>n.props.children==="terminal.recovery.nonPty"));
 nodes.length=0;TerminalRecoveryMenuItems({session:{id:"s"},project:{environment_type:"ssh"}});assert.ok(nodes.filter(n=>n.type==="item").every(n=>n.props.disabled));
 const adapter=readFileSync(new URL(root+"components/TerminalNavigationAdapter.tsx",import.meta.url),"utf8");assert.match(adapter,/const pane = panes\.find/);assert.match(adapter,/id: `navigation-\$\{entry.id\}`/);assert.match(adapter,/actionSessionId=\{entry.id\}/);
});
test("locales match all recovery keys and describe no replay / prepared replacement semantics",()=>{
 const en=readFileSync(new URL("../src/shared/i18n/messages/terminal.en-US.ts",import.meta.url),"utf8"),zh=readFileSync(new URL("../src/shared/i18n/messages/terminal.zh-CN.ts",import.meta.url),"utf8");
 const keys=s=>[...s.matchAll(/"(terminal\.recovery\.[^"]+)":/g)].map(m=>m[1]).sort();assert.deepEqual(keys(en),keys(zh));assert.match(en,/prepared first/);assert.match(en,/original terminal stays open/);assert.match(zh,/就绪后才/);assert.match(zh,/不启动 \/ 重放 CLI/);
});
test("store coordination publishes busy for programmatic operations and clears after failure",async()=>{
 const transitions=[];const {createTerminalRecoveryCoordination}=load(root+"store/terminalRecoveryCoordination.ts");
 const c=createTerminalRecoveryCoordination((id,busy)=>transitions.push([id,busy]));const g=gate();
 const p=c.run("s",async()=>{await g.promise;throw new Error("failure");});const duplicate=c.run("s",()=>assert.fail("deduplicated"));assert.equal(p,duplicate);
 assert.deepEqual(transitions,[["s",true]]);g.release();await assert.rejects(p,/failure/);assert.deepEqual(transitions,[["s",true],["s",false]]);
});
test("confirmation environment changes abort; committed failure reports ID without retry or focus",async()=>{
 const g=gate();let cwd="/before";const f=fixture({confirm:()=>g.promise,resolveContext:()=>({cwd,environment:"local"})});const p=f.handlers.rebuild("s");await Promise.resolve();cwd="/after";g.release(true);await p;assert.deepEqual(f.calls,[]);
 const failed=fixture({rebuildSession:async()=>{throw Object.assign(new Error("terminal_recovery_persistence_failed"),{committedSessionId:"ready-123"});}});await failed.handlers.rebuild("s");assert.ok(failed.events.some(e=>e[0]==="error"&&e[1].includes("ready-123")));assert.equal(failed.busy.s,false);
});

for (const scenario of ["missing worktree", "inactive worktree", "missing cwd", "missing WSL distro"]) test(`force end with real binding and strict close: ${scenario}`,async()=>{
 const source={id:"s",title:"source",createdAtMs:1,cwd:"/repo",...(scenario.includes("worktree")?{projectId:"p",worktreeId:"gone"}:{}),...(scenario==="missing cwd"?{cwd:undefined}:{}),...(scenario==="missing WSL distro"?{cwd:"/home/me",shell:"wsl",environmentType:"wsl"}:{})};
 const projectState={projects:[],groups:[],worktrees:scenario==="inactive worktree"?[{id:"gone",project_id:"p",status:"inactive",path:"/repo"}]:[]};
 const environment=load(root+"lib/terminalRecoveryEnvironment.ts",{"../../projects/api/groupPath":{resolveProjectPath:p=>p.path},"../../providers/api/providerSwitching":{parseProjectEnvVars:()=>undefined}});
 let state={sessions:[source],recoveryBusy:{}};const closes=[];
 const terminalStore={getState:()=>state,setState:v=>state={...state,...v}};
 const projectStore={getState:()=>projectState};
 const bindings=load(root+"hooks/terminalRecoveryBindings.ts",{"../lib/terminalRecoveryEnvironment":environment,"../lib/terminalLaunch":{resolveShellForPty:s=>s},"../../../shared/platform/shell":{getOsPlatform:async()=>"windows"},"../../projects/api/projectStore":{useProjectStore:projectStore},"../state":{useTerminalStore:terminalStore}}).terminalRecoveryBindings;
 await assert.rejects(bindings.resolveContext(source),/terminal_recovery_(worktree_missing|cwd_missing|wsl_environment_missing)/);
 const native={close:async(id,strict)=>closes.push([id,strict])};
 const candidate=load(root+"store/terminalSessionCandidate.ts",{"../api/TerminalProcessManager":{terminalProcessManager:native},"../api/terminalWorkspan":{createTerminalWorkspan:()=>{}},"../lib/terminalLaunch":{releaseProviderSnapshot:()=>{},releaseProjectExtensionSnapshot:()=>{}}});
 const actions=load(root+"store/terminalRecoveryActions.ts",{
  "../lib/terminalRecoveryEnvironment":environment,"./terminalSessionCandidate":candidate,
  "sonner":{toast:{}},"../../../shared/i18n/index":{translateCurrent:k=>k},
  "../../projects/api/projectStore":{useProjectStore:projectStore},"../api/currentWorkEvents":{},
  "../api/sessionStore":{},"../api/TerminalProcessManager":{terminalProcessManager:native},
  "../lib/terminalStoreLayout":{},"../lib/terminalRecoveryLayout":{},
 }).createTerminalRecoveryActions(()=>state,v=>state={...state,...v},async()=>{},async()=>assert.fail("must not prepare"),{});
 // Model the existing strict-close boundary with the real native source-close helper.
 state.closeSession=async(id,strict)=>{assert.equal(strict,true);await candidate.closeTerminalSource(state.sessions.find(s=>s.id===id));};
 let confirmation;
 const f=fixture({...bindings,hardKillSession:actions.hardKillSession,confirm:async c=>{confirmation=c;return true;}});
 await f.handlers.hardKill("s");
 assert.ok(confirmation);assert.equal(confirmation.danger,true);assert.deepEqual(closes,[["s",true]]);
 assert.ok(f.events.some(e=>e[0]==="success"&&e[1].includes("ended")));
 // The same invalid environment must still reject replacement creation.
 await f.handlers.rebuild("s");assert.deepEqual(f.calls,[]);
});
test("candidate death is explicit error feedback, never rebuild success",async()=>{
 const f=fixture({rebuildSession:async()=>{throw Object.assign(new Error("terminal_recovery_candidate_died_after_close"),{committedSessionId:"dead-123"});}});
 await f.handlers.rebuild("s");
 assert.ok(f.events.some(e=>e[0]==="error"&&e[1].includes("candidateDiedAfterClose")&&e[1].includes("dead-123")));
 assert.equal(f.events.some(e=>e[0]==="success"),false);
});
