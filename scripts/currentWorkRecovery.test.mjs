import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path, deps = {}) {
 const exports = {};
 const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code, {exports, require: id => {assert.ok(id in deps, id); return deps[id];}});
 return exports;
}
const model = load("../src/features/terminal/lib/currentWorkModel.ts");
const plain = v => JSON.parse(JSON.stringify(v));
const layout = () => ({type:"split",id:"split",direction:"vertical",ratio:0.65,
 first:{type:"leaf",id:"left",sessionIds:["other","source"],activeSessionId:"other"},
 second:{type:"leaf",id:"right",sessionIds:["created"],activeSessionId:"created"}});
test("live Current Work identity replacement preserves latest nodes, order, ratio and unrelated focus", () => {
 const original = {sessionIds:["other","created","source"],activeSessionId:"created",paneTree:layout()};
 const next = model.replaceCurrentWorkSession(original,"source","new");
 assert.deepEqual(plain(next.sessionIds),["other","created","new"]);
 assert.equal(next.activeSessionId,"created");
 assert.equal(next.paneTree.id,"split"); assert.equal(next.paneTree.ratio,0.65);
 assert.deepEqual(plain(next.paneTree.first.sessionIds),["other","new"]);
 assert.equal(next.paneTree.first.activeSessionId,"other");
 assert.deepEqual(plain(model.replaceCurrentWorkSession(original,"absent","new")),original);
 assert.equal(original.paneTree.first.sessionIds[1],"source");
});
function fixture() {
 const barrier = load("../src/features/terminal/api/sessionPersistenceBarrier.ts");
 let state, blockSave = null;
 const disk = {}; const saves = [];
 const jsonValue = value => {
  assert.ok(value === null || ["string","boolean","number","object"].includes(typeof value));
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  if (value && typeof value === "object") Object.values(value).forEach(jsonValue);
 };
 const native = {async set(k,v){jsonValue(v); assert.equal(JSON.stringify(plain(v)),JSON.stringify(v)); disk[k]=plain(v);}, async save(){saves.push(plain(disk)); if(blockSave) {const gate=blockSave; blockSave=null; await gate;}}};
 const exports = load("../src/features/terminal/api/sessionStore.ts", {
  zustand:{create(init){const api={getState:()=>state,setState:v=>{state={...state,...v};}};state=init();return api;}},
  "./sessionPersistenceBarrier":barrier,
  "@tauri-apps/plugin-store":{Store:{load:async()=>native}},
  "../lib/currentWorkModel":model,
  "../../../shared/platform/appPaths":{getCliManagerDataPaths:async()=>({sessionsStorePath:"test"})},
  "../../../shared/lib/singleFlight":{singleFlight:fn=>fn},
  "./terminalWorkspan":{migrateTerminalWorkspans:v=>v,sanitizeTerminalWorkspans:v=>v},
 });
 return {...exports,disk,saves,block(gate){blockSave=gate;}};
}
test("delayed Current Work save cannot overwrite concurrent replacement/focus; recovery persists latest coherent state",async()=>{
 const f=fixture(); const api=f.useSessionStore;
 let release; f.block(new Promise(resolve=>release=resolve));
 const sessions=[{id:"source"},{id:"other"},{id:"created"}];
 const old=api.getState().saveCurrentWork(["source","other","created"],"source",sessions,layout());
 await new Promise(resolve=>setImmediate(resolve));
 const edit=api.getState().saveCurrentWork(["other","created","source"],"created",sessions,layout());
 api.getState().replaceCurrentWorkSession("source","new");
 const terminal={sessions:[{id:"new"},{id:"other"},{id:"created"}],activeSessionId:"created",activeWorkspanId:"w",workspans:[{id:"w"}]};
 const recovery=f.saveRecoverySnapshot(()=>terminal);
 assert.deepEqual(plain(api.getState().currentWorkSessionIds),["other","created","new"]);
 release(); await Promise.all([old,edit,recovery]);
 assert.deepEqual(plain(api.getState().currentWorkSessionIds),["other","created","new"]);
 assert.deepEqual(f.disk.currentWorkSessionIds,["other","created","new"]);
 assert.equal(f.disk.currentWorkActiveSessionId,"created");
 assert.deepEqual(f.disk.sessions.map(s=>s.id),["new","other","created"]);
 assert.deepEqual(f.disk.currentWorkPaneTree.first.sessionIds,["other","new"]);
});

test("recovery snapshot whitelists DTO keys with a full live store shaped getter", async () => {
 const f=fixture();
 const terminal={sessions:[{id:"new",cwd:"/repo",envVars:{A:"B"}}],activeSessionId:"new",workspans:[],activeWorkspanId:null,
  sessionStatuses:{new:"running"},statusListeners:{new:()=>{}},recoveryBusy:{new:true},loaded:true,
  rebuildSession:async()=>"new",createSession:async()=>"new",closeSession:async()=>{}};
 await f.saveRecoverySnapshot(()=>terminal);
 const keys=["sessions","splits","activeSessionId","workspans","activeWorkspanId","currentWorkSessionIds","currentWorkActiveSessionId","currentWorkPaneTree"].sort();
 assert.deepEqual(Object.keys(f.disk).sort(),keys);
 assert.equal(f.saves.length,1);
 assert.deepEqual(f.disk.sessions,terminal.sessions);
 // Exit snapshots use the same writer; runtime extras must not leak there either.
 await f.saveRestorableExitSnapshot({...terminal,splits:[],currentWorkSessionIds:[],currentWorkActiveSessionId:null,currentWorkPaneTree:null});
 assert.deepEqual(Object.keys(f.disk).sort(),keys);
});
