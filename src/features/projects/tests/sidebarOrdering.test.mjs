import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
const source = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
function load(p, deps = {}) {
 const file = ts.createSourceFile(p, source(p), ts.ScriptTarget.Latest, true);
 const body = file.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(file)).join('\n');
 const exports = {};
 vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, ...deps });
 return exports;
}
const order = load('../../../shared/lib/worktreeOrder.ts');
const terminal = load('../../../shared/lib/sidebarTerminalOrder.ts');
const logic = load('../lib/sidebarOrdering.ts', {...order, ...terminal});
const records = [{id:'a', project_id:'p', name:'a'}, {id:'b',project_id:'p',name:'b'}, {id:'c',project_id:'q',name:'c'}];
const meta = (projectId='p', sortableEnabled=true) => ({type:'worktree', projectId, sortableEnabled});
const event = (from='wt:a',to='wt:b', a=meta(), b=meta()) => ({active:{id:from,data:{current:a}},over:to ? {id:to,data:{current:b}}:null});
test('candidate prefilter keeps self and rejects into, cross-project, disabled and WT for legacy tree drags', () => {
 assert.equal(logic.treeDragCandidate('wt:a',meta(),'wt:b',meta()), true);
 assert.equal(logic.treeDragCandidate('wt:a',meta(),'wt:a',meta()), true);
 for (const [id,data] of [['into:g',{}],['wt:c',meta('q')],['wt:b',meta('p',false)],['p', {type:'project'}]])
  assert.equal(logic.treeDragCandidate('wt:a',meta(),id,data),false);
 assert.equal(logic.treeDragCandidate('wt:a',meta('p',false),'wt:b',meta()),false);
 assert.equal(logic.treeDragCandidate('p',{type:'project'},'wt:b',meta()),false);
 assert.equal(logic.treeDragCandidate('p',{type:'project'},'g',{type:'group'}),true);
});
test('WT dispatch consumes rejected drops before legacy movement; revalidates deleted membership and authoritative order', () => {
 const calls=[]; const reorder=(...args)=>{calls.push(args);return Promise.resolve(true);};
 assert.equal(logic.dispatchWorktreeDrag(event(),records,{},reorder),true);
 assert.equal(JSON.stringify(calls), '[["p",["b","a"]]]'); calls.length=0;
 for (const e of [event('wt:a','into:g',meta(),{}),event('wt:a','wt:c',meta(),meta('q')),event('wt:a',null),event('wt:deleted'),event('wt:a','wt:deleted'),event('wt:a','wt:b',meta('p',false))])
  assert.equal(logic.dispatchWorktreeDrag(e,records,{},reorder),true);
 assert.equal(calls.length,0);
 assert.equal(logic.dispatchWorktreeDrag(event('p','g',{type:'project'},{type:'group'}),records,{},reorder),false);
 assert.equal(logic.dispatchWorktreeDrag(event('p','wt:b',{type:'project'},meta()),records,{},reorder),true);
});
test('terminal candidate scope includes exact project, Worktree, pin partition, hidden/legacy; rejects deleted/pseudo', () => {
 const base={id:'a',projectId:'p'};
 for (const extra of [{tabHidden:true},{kind:'pty'},{sidebarPinned:false}]) assert.equal(logic.terminalDropAllowed([base,{...base,id:'b',...extra}],'a','b'),true);
 for (const extra of [{projectId:'q'},{worktreeId:'w'},{sidebarPinned:true},{kind:'pi'}]) assert.equal(logic.terminalDropAllowed([base,{...base,id:'b',...extra}],'a','b'),false);
 assert.equal(logic.terminalDropAllowed([base],'a','deleted'),false);
});
function component(path, deps) {return load(path,{ require:(id)=> {assert.ok(deps[id],id);return deps[id];}, ...deps });}
const transition = { duration: 100, easing: "cubic-bezier(0.2, 0, 0, 1)" };
function sortableHarness(dragging = false) {
 const calls=[]; const attributes={role:'button',tabIndex:0,'aria-describedby':'drag-instructions'};
 const sortable={attributes,listeners:{onPointerDown:e=>calls.push(['pointer',e])},
  setNodeRef:n=>calls.push(['node',n]),setActivatorNodeRef:n=>calls.push(['activator',n]),
  transition:'transform 100ms',transform:{y:8},isDragging:dragging};
 let options;
 const deps={require:()=>jsx,CSS:{Transform:{toString:()=> 'translateY(8px)'}},
  DND_SORTABLE_TRANSITION:transition,useSortable:o=>{options=o;return sortable;}};
 return {calls,attributes,deps,getOptions:()=>options};
}
const pointer = (button=0, primary=true, control=false) => ({button,isPrimary:primary,
 stopPropagation(){this.stopped=true;},target:{closest:()=>control?{}:null}});
test('actual terminal whole-row bindings attach node, activator, attributes, transition and primary pointer only',()=>{
 const h=sortableHarness();const c=load('../components/SidebarTerminalSortable.tsx',h.deps);
 const row=c.SidebarTerminalSortable({session:{id:'a',projectId:'p',sidebarPinned:true},children:p=>p});
 const node={};row.ref(node);assert.deepEqual(h.calls,[['node',node],['activator',node]]);h.calls.length=0;
 assert.equal(row.attributes,h.attributes);assert.equal(row.style.transition,'transform 100ms');
 assert.equal(h.getOptions().transition,transition);assert.equal(h.getOptions().data.pinned,true);
 const e=pointer();row.onPointerDown(e);assert.equal(h.calls.length,1);assert.equal(e.stopped,true);
 for(const e of [pointer(2),pointer(1),pointer(0,false)]) {row.onPointerDown(e);assert.equal(e.stopped,true);}
 assert.equal(h.calls.length,1);
 const drag=sortableHarness(true);const d=load('../components/SidebarTerminalSortable.tsx',drag.deps);
 assert.equal(d.SidebarTerminalSortable({session:{id:'a'},children:p=>p}).style.transition,undefined);
});
function worktreeHarness(dragging=false, disabled=false) {
 const h=sortableHarness(dragging);const calls=[];const store={worktrees:records,reorderWorktrees:(...a)=>calls.push(['reorder',...a])};
 let map={p:['b','a']};
 const actions={selectedWorktreeIds:new Set(),collapsedIds:new Set(),providerBadges:{},getTerminals:()=>[],
 onSelectWorktree:()=>calls.push(['select']),onOpenWorktree:()=>calls.push(['open']),onContextMenuWorktree:()=>calls.push(['menu'])};
 const deps={...h.deps,React,useState:()=>[null,()=>{}],useEffect:()=>{},useRef:()=>({current:null}),memo:f=>f,
 useI18n:()=>({t:k=>k}),useTreeActions:()=>actions,getWorktreeDisplayName:w=>w.name,
 worktreeTerminalsCollapseId:id=>`terminals:${id}`,WorktreeIcon:()=>null,Play:()=>null,AlertTriangle:()=>null,WorktreeTerminalSummary:()=>null,
 useProjectStore:{getState:()=>store},useSettingsStore:{getState:()=>({worktreeOrderByProject:map})},
 ...order,...logic};
 const c=load('../components/TreeNodeItem.tsx',deps);
 const render=()=>c.TreeNodeItem({node:{type:'worktree',project:{id:'p'},worktree:records[0]},depth:1,
 density:'compact',focusedNodeKey:'wt:a',onFocusNode:()=>calls.push(['focus']),sortableEnabled:!disabled});
 return {...h,calls: h.calls,actionsCalls:calls,store,render};
}
test('actual WT row body attaches activator, primary-only listener and selects on short click; controls/nested lists never drag',()=>{
 const h=worktreeHarness();const root=h.render();const body=React.Children.toArray(root.props.children)[0];
 assert.equal(root.props.role,'treeitem');assert.equal(root.props['aria-describedby'],'drag-instructions');
 root.props.ref('tree');body.props.ref('body');assert.deepEqual(h.calls,[['node','tree'],['activator','body']]);h.calls.length=0;
 body.props.onPointerDown(pointer());assert.equal(h.calls.length,1);
 for(const e of [pointer(2),pointer(1),pointer(0,false),pointer(0,true,true)]) body.props.onPointerDown(e);
 let selector;
 body.props.onPointerDown({ ...pointer(), target: { closest: value => { selector=value;return {}; } } });
 for(const excluded of ['button','input','textarea','select','[contenteditable]','[data-sidebar-terminals]']) assert.ok(selector.includes(excluded));
 assert.equal(h.calls.length,1);body.props.onClick({});body.props.onDoubleClick({});body.props.onContextMenu({});
 assert.deepEqual(h.actionsCalls,[['select'],['open'],['menu']]);
 const drag=worktreeHarness(true);const draggingBody=React.Children.toArray(drag.render().props.children)[0];
 draggingBody.props.onClick({});draggingBody.props.onDoubleClick({});assert.deepEqual(drag.actionsCalls,[]);
 const disabled=worktreeHarness(false,true);React.Children.toArray(disabled.render().props.children)[0].props.onPointerDown(pointer());
 assert.equal(disabled.calls.length,0);
});
test('actual WT row Alt arrows read live order, refuse edges/deleted/disabled and do not select/open',()=>{
 const h=worktreeHarness();const root=h.render();const press=(key,el=root,target=el)=>el.props.onKeyDown({
 key,altKey:true,target,currentTarget:el,stopPropagation(){},preventDefault(){}});
 press('ArrowUp');assert.equal(JSON.stringify(h.actionsCalls),'[["reorder","p",["a","b"]]]');h.actionsCalls.length=0;
 press('ArrowDown');press('ArrowUp',root,{});h.store.worktrees=records.filter(w=>w.id!=='a');press('ArrowUp');assert.equal(h.actionsCalls.length,0);
 const d=worktreeHarness(false,true);press('ArrowUp',d.render());assert.equal(d.actionsCalls.length,0);
});
test('release click suppression is owned by activated PointerSensor capture, same as terminal tabs',()=>{
 const sensor=readFileSync(new URL('../../../../node_modules/@dnd-kit/core/dist/core.esm.js',import.meta.url),'utf8');
 assert.match(sensor,/setTimeout\(this\.documentListeners.removeAll, 50\)/);
 assert.match(sensor,/this\.activated = true/);assert.match(sensor,/documentListeners\.add\(EventName\.Click, stopPropagation, \{\s*capture: true/);
 const list=source('../components/SidebarTerminalList.tsx');assert.match(list,/activationConstraint: DND_ACTIVATION_CONSTRAINT/);
 assert.match(source('../components/ProjectTree.tsx'),/activationConstraint: DND_ACTIVATION_CONSTRAINT/);
 assert.doesNotMatch(source('../components/TreeNodeItem.tsx')+list,/WorktreeOrderHandle|sidebar-order-handle/);
});
test('collision filter precedes candidate selection, WT dispatch precedes legacy branches, search/filter guard and shared raw ordering are wired',()=>{
 const tree=source('../components/ProjectTree.tsx');
 assert.match(tree,/closestCenter\(\{ \.\.\.args, droppableContainers: args.droppableContainers.filter/);
 assert.match(tree,/if \(!searchActive && projectFilter === "all"\) actions.onDragEnd/);
 const hook=source('../hooks/useSidebarTreeDrag.ts');assert.ok(hook.indexOf('dispatchWorktreeDrag(event')<hook.indexOf('overId.startsWith("into:")'));
 assert.match(source('../components/TreeNodeItem.tsx'),/SortableContext items=\{projectWorktrees.map/);
 assert.doesNotMatch(source('../components/TreeNodeItem.tsx'),/ui-worktree-short-chip|>\s*WT\s*</);
 assert.match(source('../components/SidebarProjectTerminals.tsx'),/useSettingsStore\(\(s\) => s.worktreeOrderByProject\)/);
 assert.match(source('../components/SidebarProjectTerminals.tsx'),/orderProjectWorktrees\(worktrees, projectId, order\)/);
});

test('real closestCenter geometry keeps near-origin and return-to-origin drops a no-op', async () => {
 const {closestCenter}=await import('@dnd-kit/core');
 const rect=(top)=>({left:0,right:160,top,bottom:top+30,width:160,height:30});
 for (const kind of ['terminal','worktree']) {
  const active=kind==='terminal'?'a':'wt:a', sibling=kind==='terminal'?'b':'wt:b';
  const candidates=[active,sibling,kind==='terminal'?'foreign':'wt:c'].map(id=>({id}));
  const sessions=[{id:'a',projectId:'p'},{id:'b',projectId:'p'},{id:'foreign',projectId:'q'}];
  const allowed=candidates.filter(c=>kind==='terminal'?logic.terminalDragCandidate(sessions,active,c.id):logic.treeDragCandidate(active,meta(),c.id,meta(c.id==='wt:c'?'q':'p')));
  for (const top of [7,0,40]) {
   const result=closestCenter({active:{id:active},collisionRect:rect(top),droppableRects:new Map(candidates.map((c,i)=>[c.id,rect(i*40)])),droppableContainers:allowed});
   const target=String(result[0].id);
   assert.equal(target,top===40?sibling:active);
   if (top!==40) {
    if(kind==='terminal') assert.equal(logic.terminalDropAllowed(sessions,active,target),false);
    else {let calls=0;logic.dispatchWorktreeDrag(event(active,target),records,{},()=>{calls++;return Promise.resolve(true);});assert.equal(calls,0);}
   }
  }
 }
});

test('canonical project-owned Worktree lookup supplies the drag ghost node, including nested groups',()=>{
 const lookup=load('../lib/treeNodeLookup.ts');
 const project={id:'p',name:'Project'};const wt={id:'a',project_id:'p',name:'Worktree'};
 const p={type:'project',project,worktrees:[wt]};const tree=[{type:'group',group:{id:'g'},children:[p]}];
 assert.equal(lookup.findNodeById(tree,'p'),p);
 const node=lookup.findNodeById(tree,'wt:a');assert.equal(node.type,'worktree');assert.equal(node.worktree,wt);assert.equal(node.project,project);
 assert.equal(lookup.findNodeById(tree,'wt:deleted'),null);
});

test('localized instructions describe supported pointer/Alt keyboard controls and tree ownership semantics',()=>{
 for(const lang of ['en-US','zh-CN']) {
  const messages=load(`../../../shared/i18n/messages/projects.${lang}.ts`);
  const dictionary=Object.values(messages)[0];
  for(const key of ['terminalInstructions','treeInstructions']) {
   const instruction=dictionary[`sidebar.order.${key}`];assert.ok(instruction.includes('Alt+'));assert.ok(instruction.includes('Worktree'));assert.doesNotMatch(instruction,/Space|空格|handle|手柄/);
  }
  assert.match(dictionary['sidebar.order.treeInstructions'],lang==='en-US'?/project and group/:/项目和分组/);
 }
 for(const [path,key] of [['SidebarTerminalList','terminalInstructions'],['ProjectTree','treeInstructions']]) {
  const file=ts.createSourceFile(path,source(`../components/${path}.tsx`),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let found=false;function visit(n){if(ts.isJsxAttribute(n)&&n.name.getText(file)==='accessibility') {found=true;assert.ok(n.getText(file).includes(`sidebar.order.${key}`));}ts.forEachChild(n,visit);}visit(file);assert.ok(found);
 }

});
