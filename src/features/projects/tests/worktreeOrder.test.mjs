import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path, dependencies = {}) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(source)).join("\n");
  const exports = {};
  runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, ...dependencies });
  return exports;
}
const order = load("../../../shared/lib/worktreeOrder.ts");
const persistence = load("../../../shared/preferences/worktreeOrderPersistence.ts", order);
const records = [{ id: "b", project_id: "p", name: "beta" }, { id: "a", project_id: "p", name: "alpha" },
  { id: "new", project_id: "p", name: "gamma" }, { id: "other", project_id: "q", name: "aaa" }];
const ids = (map) => order.orderProjectWorktrees(records, "p", map).map((item) => item.id).join(",");

test("shape validation rejects malformed entries, duplicate/non-string IDs and array maps", () => {
  assert.equal(JSON.stringify(order.sanitizeWorktreeOrder(null)), "{}");
  assert.equal(JSON.stringify(order.sanitizeWorktreeOrder([])), "{}");
  assert.equal(JSON.stringify(order.sanitizeWorktreeOrder({ p: ["a", "b"], bad: ["a", "a"], mixed: [3], scalar: "a", "": [] })), '{"p":["a","b"]}');
});

test("name fallback, appended new records, stale/foreign IDs ignored without input mutation", () => {
  const snapshot = JSON.stringify(records);
  assert.equal(ids({}), "a,b,new");
  assert.equal(ids({ p: ["stale", "other", "b", "a"] }), "b,a,new");
  assert.equal(ids({ p: ["a"] }), "a,b,new");
  assert.equal(JSON.stringify(records), snapshot);
});

test("membership validation rejects partial, duplicate and cross-project input; optimistic writes serialize", async () => {
  let current = {};
  const writes = [];
  const update = persistence.createWorktreeOrderUpdater(() => current, (value) => { current = value; }, async (value) => { writes.push(JSON.stringify(value)); });
  for (const invalid of [["a"], ["a", "a", "new"], ["other", "a", "b"]]) assert.equal(await update("p", invalid, records), false);
  assert.equal(writes.length, 0);
  const input = ["b", "a", "new"];
  const first = update("p", input, records);
  input.reverse();
  const second = update("q", ["other"], records);
  assert.equal(current.p.join(","), "b,a,new");
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0], '{"p":["b","a","new"]}');
  assert.equal(writes[1], '{"p":["b","a","new"],"q":["other"]}');
});

test("settings load/default/persist and project API/tree reactivity use the shared seam", () => {
  const settings = readFileSync(new URL("../../../shared/preferences/settingsStore.ts", import.meta.url), "utf8");
  const projects = readFileSync(new URL("../api/projectStore.ts", import.meta.url), "utf8");
  assert.match(settings, /worktreeOrderByProject: \{\}/);
  assert.match(settings, /entries.worktreeOrderByProject = sanitizeWorktreeOrder/);
  assert.match(settings, /s.set\("worktreeOrderByProject", order\)/);
  assert.match(projects, /updateWorktreeOrder\(projectId, orderedIds, get\(\).worktrees\)/);
  assert.match(projects, /orderProjectWorktrees\(worktreesByProject/);
  assert.match(projects, /useSettingsStore.subscribe/);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('failed current revision rolls back, returns handled false, and queue recovers',async()=>{
 let current={p:['a','b','new']};const initial=current;const gate=deferred();let calls=0;
 const update=persistence.createWorktreeOrderUpdater(()=>current,v=>current=v,async()=>{if(++calls===1)await gate.promise;});
 const first=update('p',['b','a','new'],records);await Promise.resolve();gate.reject(new Error('disk'));
 assert.equal(await first,false);assert.equal(current,initial);
 assert.equal(await update('p',['new','b','a'],records),true);assert.equal(current.p.join(','),'new,b,a');
});
test('delayed failed revision never undoes later optimism; next write excludes failed foreign preference',async()=>{
 let current={p:['a','b','new']};const gate=deferred();const writes=[];
 const update=persistence.createWorktreeOrderUpdater(()=>current,v=>current=v,async v=>{writes.push(JSON.stringify(v));if(writes.length===1)await gate.promise;});
 const a=update('p',['b','a','new'],records);await Promise.resolve();
 const b=update('q',['other'],records);const optimistic=current;gate.reject(new Error('disk'));
 assert.equal(await a,false);assert.equal(current,optimistic);assert.equal(await b,true);
 assert.equal(current.p.join(','),'a,b,new');assert.equal(current.q.join(','),'other');
 assert.equal(writes[1],'{"p":["a","b","new"],"q":["other"]}');
});
test('later failed revision rolls back to last successful revision, not earlier optimism',async()=>{
 let current={};const gate=deferred();let calls=0;
 const update=persistence.createWorktreeOrderUpdater(()=>current,v=>current=v,async()=>{if(++calls===2)await gate.promise;});
 const a=update('p',['b','a','new'],records);const b=update('p',['new','a','b'],records);
 assert.equal(await a,true);await Promise.resolve();gate.reject(new Error('disk'));assert.equal(await b,false);assert.equal(current.p.join(','),'b,a,new');
});

function projectHarness() {
 let pref={};let state;const subscriptions=[];const gate=deferred();const errors=[];
 const settings={getState:()=>({worktreeOrderByProject:pref,updateWorktreeOrder:async()=>false}),subscribe:fn=>subscriptions.push(fn)};
 const create=initializer=>{state=initializer(v=>Object.assign(state,v),()=>state);return {getState:()=>state,setState:v=>Object.assign(state,v)};};
 const api=load('../api/projectStore.ts',{create,useSettingsStore:settings,orderProjectWorktrees:order.orderProjectWorktrees,
 getDb:async()=>({execute:()=>gate.promise}),batchUpdateSortOrder:()=>gate.promise,toast:{error:v=>errors.push(v)},translateCurrent:k=>k,logWarn(){}});
 const project={id:'p',group_id:null,name:'Project',sort_order:0,cli_tool:'codex',path_mode:'custom'};
 Object.assign(state,{projects:[project,{...project,id:'q',sort_order:1}],groups:[{id:'g',parent_id:null,name:'Group',sort_order:2,bound_path:'x'}],worktrees:records,fetchAll:async()=>{}});
 state.setSearchQuery('');
 return {state,gate,errors,settings,setPref(value){const prev=pref;pref=value;subscriptions.forEach(fn=>fn({worktreeOrderByProject:pref},{worktreeOrderByProject:prev}));}};
}
test('delayed project reorder/project move/group move failure rebuilds using CURRENT Worktree preference',async()=>{
 for(const method of ['reorderItems','moveProjectToGroup','moveGroupToParent']) {
  const h=projectHarness();const originalProjects=h.state.projects,originalGroups=h.state.groups;
  const pending=method==='reorderItems'?h.state[method](null,['q','p','g']):method==='moveProjectToGroup'?h.state[method]('p','g'):h.state[method]('g','other');
  await Promise.resolve();h.setPref({p:['b','a','new']});h.gate.reject(new Error('DB failure'));await assert.rejects(pending);
  const find=nodes=>nodes.flatMap(n=>n.type==='group'?find(n.children):[n]);
  assert.equal(find(h.state.tree).find(n=>n.project.id==='p').worktrees.map(w=>w.id).join(','),'b,a,new');
  if(method!=='moveGroupToParent')assert.equal(h.state.projects,originalProjects);
  if(method!=='moveProjectToGroup')assert.equal(h.state.groups,originalGroups);
 }
});
test('actual project ordering boundary reports handled failure with localized toast, including unexpected rejection',async()=>{
 const h=projectHarness();assert.equal(await h.state.reorderWorktrees('p',['b','a','new']),false);assert.equal(h.errors.length,1);
 h.settings.getState=()=>({updateWorktreeOrder:async()=>{throw new Error('write');}});
 assert.equal(await h.state.reorderWorktrees('p',['b','a','new']),false);assert.equal(h.errors.length,2);assert.equal(h.errors[0],'sidebar.order.saveFailed');
});
