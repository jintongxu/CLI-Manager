import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, deps = {}) {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const body = file.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(file)).join("\n");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: () => jsx, ...deps });
  return exports;
}
const collapseKey = id => `project-worktrees:${id}`;
const tools = load("../lib/sidebarTools.ts", { worktreeListCollapseId: collapseKey });
const p = { id: "remote", name: "same", cli_tool: "codex", path: "wrong", remote_path: "/remote/repo", environment_type: "ssh" };
const wt = { id: "w", project_id: p.id, name: "work", branch: "b", description: "" };
const project = { type: "project", project: p };
const flat = { type: "worktree", project: p, worktree: wt };
const group = (id, children) => ({ type: "group", group: { id, name: id }, children });
const tree = [group("outer", [group("inner", [project, flat])]), group("other", [{ type: "project", project: { id: "local", name: "same", path: "/local", remote_path: "", cli_tool: "codex" } }])];
const plain = value => JSON.parse(JSON.stringify(value));

test("locate resolves true flat ancestors by ID, never names/path or synthetic Worktree parent", () => {
  const before = JSON.stringify(tree);
  assert.deepEqual(plain(tools.resolveSidebarLocateTarget(tree, p.id)), { projectId: p.id, projectName: "same", ancestorIds: ["outer", "inner"] });
  assert.deepEqual(plain(tools.resolveSidebarLocateTarget(tree, p.id, "w")), { projectId: p.id, projectName: "same", worktreeId: "w", ancestorIds: ["outer", "inner"] });
  for (const ids of [[null], ["deleted"], [p.id, "deleted"], ["local", "w"], ["same"]]) {
    assert.equal(tools.resolveSidebarLocateTarget(tree, ...ids), null);
  }
  assert.equal(JSON.stringify(tree), before);
});
test("legacy project-owned Worktree expands project key; flat sibling in another group uses its own ancestors", () => {
  const nested = [group("g", [{ ...project, worktrees: [wt] }])];
  assert.deepEqual([...tools.resolveSidebarLocateTarget(nested, p.id, "w").ancestorIds], ["g", collapseKey(p.id)]);
  const split = [group("main", [project]), group("work", [flat])];
  assert.deepEqual([...tools.resolveSidebarLocateTarget(split, p.id, "w").ancestorIds], ["work"]);
});
test("collapse all collects every group/project stored key including hidden descendants, no Worktree or duplicate pin keys", () => {
  const ids = tools.collectSidebarCollapseIds(tree);
  assert.deepEqual([...ids], ["outer", "inner", collapseKey(p.id), "other", collapseKey("local")]);
  assert.equal(tools.collectSidebarCollapseIds([]).size, 0);
  assert.equal(ids.has("worktree-terminals:w"), false);
});

// Small React hook runtime: render/effect/commit passes plus cancellable RAF, no real settings/browser.
function runtime() {
  const slots = []; let cursor = 0; let effects = []; let dirty = false;
  const frames = new Map(); let frameId = 0;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => {
        const next = typeof value === "function" ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) {
      const i = cursor++; const prev = slots[i];
      if (!prev || deps.some((v, j) => !Object.is(v, prev.deps[j]))) {
        slots[i] = { deps, cleanup: prev?.cleanup };
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const window = {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  return { hooks, window,
    render(fn, commit = () => {}) {
      let result;
      for (let count = 0; count < 20; count++) {
        cursor = 0; dirty = false; result = fn(); commit(result);
        const pending = effects; effects = []; pending.forEach(fn => fn());
        if (!dirty) return result;
      }
      throw new Error("render did not settle");
    },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
  };
}
const t = key => key;
test("actual locate hook resets open/pinned filters, expands only ancestors, selects exact target and repeats nonce without terminal actions", () => {
  for (const filter of ["all", "open", "pinned"]) {
    const rt = runtime(); const calls = []; let collapsed = new Set(["outer", "inner", "other", collapseKey(p.id)]);
    const hook = load("../hooks/useProjectLocate.ts", { ...rt.hooks, ...tools, useI18n: () => ({ t }), toast: { info: (...a) => calls.push(["toast", ...a]) } });
    const params = { tree, projectFilter: filter, setProjectFilter: f => calls.push(["filter", f]),
      setCollapsedIds: fn => { collapsed = fn(collapsed); }, setSelectedId: id => calls.push(["select", id]),
      onBeforeLocate: () => calls.push(["before"]) };
    let result = rt.render(() => hook.useProjectLocate(params));
    result.locateTarget(tools.resolveSidebarLocateTarget(tree, p.id, "w"));
    result = rt.render(() => hook.useProjectLocate(params));
    assert.equal(result.locateRequest.worktreeId, "w"); assert.equal(result.locateRequest.nonce, 1);
    assert.deepEqual([...collapsed], ["other", collapseKey(p.id)]);
    assert.deepEqual(calls, filter === "all" ? [["before"], ["select", "w"]] : [["before"], ["filter", "all"], ["select", "w"]]);
    result.locateTarget(tools.resolveSidebarLocateTarget(tree, p.id, "w"));
    result = rt.render(() => hook.useProjectLocate(params)); assert.equal(result.locateRequest.nonce, 2);
    calls.length = 0; result.locateTarget(null); assert.equal(calls.length, 0);
    result.locateProject({ id: "deleted", name: "missing" }); assert.equal(calls[0][0], "toast");
    calls.length = 0; result.locateProject(p);
    result = rt.render(() => hook.useProjectLocate(params));
    assert.equal(result.locateRequest.worktreeId, undefined); assert.equal(result.locateRequest.projectId, p.id);
  }
});
function nodes(element, predicate) {
  if (!element || typeof element !== "object") return [];
  const children = React.Children.toArray(element.props?.children);
  return [...(predicate(element) ? [element] : []), ...children.flatMap(child => nodes(child, predicate))];
}
for (const locale of ["en-US", "zh-CN"]) test(`actual header tools share bilingual labels/disabled reasons and events in expanded/collapsed/docked variants (${locale})`, () => {
  const messages = load(`../../../shared/i18n/messages/projects.${locale}.ts`)[locale === "en-US" ? "en" : "zh"];
  const icon = () => null;
  const header = load("../components/SidebarHeader.tsx", { useI18n: () => ({ t: key => messages[key] }),
    Crosshair: icon, Minimize2: icon, ChevronRight: icon, Plus: icon, FolderPlus: icon }).SidebarHeader;
  for (const collapsed of [false, true]) for (const density of ["compact", "comfortable"]) for (const dockSide of ["left", "right"]) {
    const calls = [];
    const props = { collapsed, density, dockSide, onLocateCurrent: () => calls.push("locate"), onCollapseAll: () => calls.push("collapse"),
      onToggleCollapse() {}, onCreateGroup() {}, onCreateProject() {}, canLocateCurrent: true, treeSearchActive: false };
    const element = header(props);
    const buttons = nodes(element, e => e.type === "button");
    const locate = buttons.find(e => e.props["aria-label"] === messages["sidebar.tools.locateCurrent"]);
    const collapse = buttons.find(e => e.props["aria-label"] === messages["sidebar.tools.collapseAll"]);
    locate.props.onClick(); collapse.props.onClick(); assert.deepEqual(calls, ["locate", "collapse"]);
    assert.equal(locate.props.disabled, false); assert.equal(collapse.props.disabled, false);
    const html = renderToStaticMarkup(header({ ...props, canLocateCurrent: false, treeSearchActive: true }));
    assert.ok(html.includes(messages["sidebar.tools.locateUnavailable"]));
    assert.ok(html.includes(messages["sidebar.tools.collapseSearchDisabled"]));
    assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
  }
});
function treeHarness() {
  const rt = runtime(); const calls = []; let renderedRows = [];
  const actions = { collapsedIds: new Set(), pinnedProjects: [p], selectedId: null,
    getProjectTerminalCount: () => 0, getTerminals: () => [], locateRequest: null, onDragEnd: () => calls.push("drag") };
  const wrap = () => null;
  const deps = { ...rt.hooks, window: rt.window, requestAnimationFrame: rt.window.requestAnimationFrame,
    getWorktreeSidebarLabel: w => w.name, getWorktreeDisplayName: w => w.name,
    EmptyState: wrap, performance: { now: () => 10 }, useI18n: () => ({ t }), useTreeActions: () => actions,
    useSensor: () => null, useSensors: () => [], PointerSensor: wrap, DND_ACTIVATION_CONSTRAINT: {},
    DndContext: wrap, SortableContext: wrap, DragOverlay: wrap, TreeNodeItem: wrap, SidebarSkeleton: wrap,
    verticalListSortingStrategy: {}, worktreeListCollapseId: collapseKey, PinnedProjectSection: wrap,
    Folder: wrap, Pin: wrap, Plus: wrap, Terminal: wrap,
    toast: { info: () => calls.push("toast") } };
  const component = load("../components/ProjectTree.tsx", deps).ProjectTree;
  let props = { tree, projectFilter: "all", collapsed: false, density: "compact", terminalScope: { kind: "all" }, onSearchActiveChange: active => calls.push(["search", active]) };
  let element;
  const render = () => {
    element = rt.render(() => component(props), element => {
      const root = nodes(element, e => e.props.role === "tree")[0];
      if (root) root.props.ref.current = { querySelectorAll: () => renderedRows };
    });
    return element;
  };
  return { actions, calls, rt, render, get element() { return element; }, props,
    setRows(keys) { renderedRows = keys.map(key => ({ dataset: { treeKey: key }, scrollIntoView: () => calls.push(["scroll", key]) })); },
    root() { return nodes(element, e => e.props.role === "tree")[0]; } };
}
test("actual tree clears local search before scrolling ordinary Worktree row, never pin copy or terminal focus; repeat requests scroll", () => {
  const h = treeHarness(); h.render();
  const event = { key: "x", target: { tagName: "DIV", closest: () => null }, preventDefault() {}, nativeEvent: {} };
  h.root().props.onKeyDown(event); h.render();
  assert.equal(nodes(h.element, e => e.type === "input").length, 1);
  assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === "search" && call[1] === true));
  h.setRows(["pin:p:remote", "wt:w", "p:remote"]);
  h.actions.locateRequest = { projectId: p.id, worktreeId: "w", projectName: p.name, nonce: 1 };
  h.render(); h.rt.flush();
  assert.equal(nodes(h.element, e => e.type === "input").length, 0);
  assert.ok(h.calls.some(call => JSON.stringify(call) === '["scroll","wt:w"]'));
  assert.equal(h.calls.includes("toast"), false);
  h.calls.length = 0; h.actions.locateRequest = { ...h.actions.locateRequest, nonce: 2 }; h.render(); h.rt.flush();
  assert.deepEqual(h.calls, [["scroll", "wt:w"]]);
});
test("actual tree waits for collapsed sidebar/pinned filter to render ordinary tree; missing target reports after bounded retry", () => {
  const h = treeHarness(); h.props.projectFilter = "pinned"; h.render();
  h.actions.locateRequest = { projectId: p.id, projectName: p.name, nonce: 1 }; h.render(); h.rt.flush();
  assert.equal(h.calls.includes("toast"), false);
  h.props.projectFilter = "all"; h.props.collapsed = true; h.render(); h.rt.flush();
  assert.equal(h.calls.includes("toast"), false);
  h.props.collapsed = false; h.setRows(["p:remote"]); h.render(); h.rt.flush();
  assert.ok(h.calls.some(call => JSON.stringify(call) === '["scroll","p:remote"]'));
  h.setRows([]); h.actions.locateRequest = { ...h.actions.locateRequest, nonce: 2 }; h.render();
  h.rt.flush(); assert.equal(h.calls.includes("toast"), false);
  h.rt.flush(); assert.equal(h.calls.includes("toast"), true);
});
test("actual tree IME ignores shortcuts and Enter; activated drag capture swallows release click and search refuses reorder", () => {
  const h = treeHarness(); h.render();
  for (const event of [{ key: "x", nativeEvent: { isComposing: true } }, { key: "Enter", keyCode: 229, nativeEvent: {} }]) {
    h.root().props.onKeyDown({ ...event, target: { tagName: "DIV", closest: () => null }, preventDefault() { throw Error("IME intercepted"); } });
  }
  h.render(); assert.equal(nodes(h.element, e => e.type === "input").length, 0);
  // DndContext is a stub function, but its real emitted handlers are exercised.
  const dnd = nodes(h.element, e => !!e.props.onDragEnd)[0];
  dnd.props.onDragEnd({}); h.render(); assert.ok(h.calls.includes("drag"));
  let stopped = 0; let prevented = 0;
  h.root().props.onClickCapture({ preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  assert.equal(stopped, 1); assert.equal(prevented, 1);
  h.root().props.onKeyDown({ key: "x", nativeEvent: {}, target: { tagName: "DIV", closest: () => null }, preventDefault() {} }); h.render();
  const input = nodes(h.element, e => e.type === "input")[0];
  input.props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: true }, preventDefault() { throw Error("IME escape intercepted"); } });
  h.render(); assert.equal(nodes(h.element, e => e.type === "input").length, 1);
  h.calls.length = 0; nodes(h.element, e => !!e.props.onDragEnd)[0].props.onDragEnd({}); assert.equal(h.calls.includes("drag"), false);
});
test("controller/view wiring uses exact activeSessionId ownership and existing persistence, not terminalScope or focus/session creation", () => {
  const controller = source("../hooks/useSidebarController.tsx");
  assert.match(controller, /sessions.find\(\(session\) => session.id === activeSessionId\)/);
  assert.match(controller, /resolveSidebarLocateTarget\(tree, activeSessionProjectId, activeSessionWorktreeId\)/);
  const handlers = controller.slice(controller.indexOf("  const locateCurrent ="), controller.indexOf("  const selectTerminalScope ="));
  assert.match(handlers, /if \(treeSearchActive\) return/); assert.match(handlers, /setCollapsedIds\(collectSidebarCollapseIds\(tree\)\)/);
  assert.doesNotMatch(handlers, /createSession|setActive|dispatchCurrentWorkTarget|onTerminalScopeChange/);
  assert.match(controller, /updateSetting\("collapsedGroupIds", Array.from\(collapsedIds\)\)/);
  const view = source("../components/SidebarView.tsx");
  for (const binding of ["onLocateCurrent={locateCurrent}", "onCollapseAll={collapseAll}", "onSearchActiveChange={setTreeSearchActive}"]) assert.ok(view.includes(binding));
});
test("actual controller active-session derivation ignores different scope/selection and keeps hidden/remote session identity", () => {
  const controller = source("../hooks/useSidebarController.tsx");
  const start = controller.indexOf("  const activeSession = useMemo(");
  const end = controller.indexOf("\n  useEffect", start);
  const derivation = controller.slice(start, end);
  for (const activeSessionId of ["current", "main", "unbound", "deleted", null]) {
    const sessions = [{ id: "current", projectId: p.id, worktreeId: "w", tabHidden: true },
      { id: "main", projectId: p.id }, { id: "unbound" }];
    const context = { sessions, activeSessionId, useMemo: fn => fn(), tree, ...tools,
      terminalScope: { kind: "project", projectId: "local" }, selectedId: "local" };
    vm.runInNewContext(derivation + "\nresult = resolveSidebarLocateTarget(tree, activeSessionProjectId, activeSessionWorktreeId);", context);
    if (activeSessionId === "current") assert.equal(context.result.worktreeId, "w");
    else if (activeSessionId === "main") { assert.equal(context.result.projectId, p.id); assert.equal(context.result.worktreeId, undefined); }
    else assert.equal(context.result, null);
  }
});
test("actual collapse controller handler is inert during search and replaces all persisted group/project keys from unfiltered tree", () => {
  const controller = source("../hooks/useSidebarController.tsx");
  const handlers = controller.slice(controller.indexOf("  const locateCurrent ="), controller.indexOf("  const selectTerminalScope ="));
  for (const treeSearchActive of [true, false]) {
    const calls = []; const context = { treeSearchActive, tree, ...tools,
      currentLocateTarget: null, locateTarget: target => calls.push(["locate", target]),
      setCollapsedIds: ids => calls.push([...ids]) };
    vm.runInNewContext(handlers + "\ncollapseAll();", context);
    assert.deepEqual(calls, treeSearchActive ? [] : [["outer", "inner", collapseKey(p.id), "other", collapseKey("local")]]);
  }
});
