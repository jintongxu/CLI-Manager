import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "project-tabs-interaction-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
function compile(path, name, transform = (code) => code) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  writeFileSync(join(temp, name), transform(code));
}
// Deterministic hook scheduler; actual application hook/component logic is compiled unchanged.
writeFileSync(join(temp, "react.mjs"), `
let cells = [], cursor = 0, effects = [];
export function reset() { cells = []; cursor = 0; effects = []; }
export function render(fn) { cursor = 0; effects = []; const value = fn(); const pending = effects; effects = []; pending.forEach(fn => fn()); return value; }
export function useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
 return [cells[i], next => { cells[i] = typeof next === "function" ? next(cells[i]) : next; }]; }
export function useRef(initial) { const i = cursor++; return cells[i] ??= { current: initial }; }
export function useCallback(fn) { cursor++; return fn; }
export function useEffect(fn, deps) { const i = cursor++; const old = cells[i];
 if (!old || deps.some((dep, index) => dep !== old[index])) { cells[i] = deps; effects.push(fn); } }
export function jsx(type, props, key) { return { type, props, key }; }
export const jsxs = jsx;
export const Fragment = "Fragment";
`);
compile("../src/features/projects/api/worktreeLabels.ts", "labels.mjs", code => code.replace(/import[^;]*;/g, ""));
compile("../src/features/terminal/api/terminalProjectTabsModel.ts", "model.mjs", code =>
  code.replace('"../../projects/api/worktreeLabels"', '"./labels.mjs"')
    .replace(/import \{ findWorktreeForSession, resolveProjectForSession \}[^;]*;/, "const resolveProjectForSession = () => null; const findWorktreeForSession = () => null;"));
compile("../src/features/terminal/api/terminalWorktreeBadge.ts", "badge.mjs", code => code.replace('"./terminalProjectTabsModel"', '"./model.mjs"'));
const { buildWorktreeBadges, buildGlobalWorktreeBadges } = await import(pathToFileURL(join(temp, "badge.mjs")));
compile("../src/features/terminal/components/TerminalCurrentContext.tsx", "current.mjs", code =>
  code.replace('"react/jsx-runtime"', '"./react.mjs"').replace('"../api/terminalProjectTabsModel"', '"./model.mjs"')
    .replace(/import \{ useI18n \}[^;]*;/, 'const useI18n = () => ({ t: key => key });'));
const { TerminalCurrentContext } = await import(pathToFileURL(join(temp, "current.mjs")));
compile("../src/features/terminal/lib/terminalTabVisibility.ts", "visibility.mjs", code => code.replace(/import[^;]*;\n/g, ""));
compile("../src/features/terminal/api/terminalProjectHide.ts", "hide.mjs", code =>
  code.replace('"../lib/terminalTabVisibility"', '"./visibility.mjs"'));
compile("../src/features/terminal/api/terminalProjectSelection.ts", "selection.mjs", (code) =>
  code.replace('"../api/terminalProjectTabsModel"', '"./model.mjs"'));
compile("../src/features/terminal/hooks/useTerminalProjectSelection.ts", "hook.mjs", (code) =>
  code.replace('"react"', '"./react.mjs"').replace('"../api/terminalProjectTabsModel"', '"./model.mjs"')
    .replace('"../api/terminalProjectSelection"', '"./selection.mjs"'));
compile("../src/features/workspace/api/WorkspanTabBar.tsx", "bar.mjs", (code) => {
  const imports = `import { jsx as _jsx, jsxs as _jsxs, useState, useEffect } from "./react.mjs";
import { selectProjectTabGroups, resolveStatusWorkspanTarget, countVisibleTabStatuses } from "./selection.mjs";
import { buildWorktreeBadges, buildGlobalWorktreeBadges } from "./badge.mjs";
import { displayedProjectTerminalIds } from "./hide.mjs";
import { describeWorkspanTabGroup, formatWorkspanGroupTitle } from "./model.mjs";
const useI18n = () => ({ t: (key, params) => params?.project ? key + ": " + params.project : key });
const useDroppable = () => ({ setNodeRef() {} });
const SortableContext = "SortableContext", horizontalListSortingStrategy = "horizontal";
const WORKSPAN_DRAG_PREFIX = "workspan:", PULSING_TAB_STATES = new Set(), TAB_NOTIFICATION_COLORS = {};
const ChevronDown = "ChevronDown", Plus = "Plus", Terminal = "Terminal", X = "X", VendorIcon = "VendorIcon";
const Popover = "Popover", PopoverContent = "PopoverContent", PopoverTrigger = "PopoverTrigger";
`;
  return imports + code.replace(/import[\s\S]*?from "[^"]+";\n/g, "");
});
compile("../src/features/terminal/components/TerminalTabsView.tsx", "view.mjs", (code) => {
  const stubs = [];
  const body = code.replace(/import\s*\{([^}]+)\}\s*from "([^"]+)";\n/g, (_, names, path) => {
    if (path === "react/jsx-runtime") return `import { ${names} } from "./react.mjs";\n`;
    if (path.endsWith("/TerminalCurrentContext")) return 'import { TerminalCurrentContext } from "./current.mjs";';
    if (path.endsWith("/WorkspanTabBar")) return 'import { WorkspanTabBar } from "./bar.mjs";\n';
    for (const name of names.split(",").map(name => name.trim()).filter(Boolean)) {
      stubs.push(`const ${name} = ${JSON.stringify(name)};`);
    }
    return "";
  });
  return stubs.join("\n") + "\n" + body;
});
compile("../src/features/terminal/components/SortableTerminalTabs.tsx", "sortable.mjs", (code) => {
  const imports = `import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment, useCallback, useState, useRef, useEffect } from "./react.mjs";
const useI18n = () => ({ t: key => key });
const useSortable = () => ({ attributes: {}, listeners: {}, setNodeRef() {} });
const CSS = { Transform: { toString: () => undefined } }, DND_SORTABLE_TRANSITION = {}, WORKSPAN_DRAG_PREFIX = "workspan:";
const PULSING_TAB_STATES = new Set(["running"]), TAB_NOTIFICATION_COLORS = { running: "red", done: "green" }, TAB_NOTIFICATION_LABELS = {};
const Terminal = "Terminal", X = "X", Cloud = "Cloud", VendorIcon = "VendorIcon", CliToolIcon = "CliToolIcon";
const ContextMenu = "ContextMenu", ContextMenuTrigger = "ContextMenuTrigger", ContextMenuContent = "ContextMenuContent", Portal = "Portal", TerminalTabHoverCard = "TerminalTabHoverCard";
const useTerminalTabHoverCard = () => ({ enabled: false });
`;
  return imports + code.replace(/import[\s\S]*?from "[^"]+";\n/g, "");
});
const { SortableWorkspanTab } = await import(pathToFileURL(join(temp, "sortable.mjs")));
const { TerminalTabsView } = await import(pathToFileURL(join(temp, "view.mjs")));
compile("../src/features/terminal/hooks/useWorkspanTabOverflow.ts", "overflow.mjs", (code) => code.replace('"react"', '"./react.mjs"'));
const { useWorkspanTabOverflow } = await import(pathToFileURL(join(temp, "overflow.mjs")));
const { reset, render } = await import(pathToFileURL(join(temp, "react.mjs")));
const { useTerminalProjectSelection } = await import(pathToFileURL(join(temp, "hook.mjs")));
const { resolveNewTabSource, selectProjectTabGroups } = await import(pathToFileURL(join(temp, "selection.mjs")));
const { WorkspanTabBar } = await import(pathToFileURL(join(temp, "bar.mjs")));
const member = (id, projectKey, extra = {}) => ({ sessionId: id, projectKey, project: projectKey, worktreeKind: "root", worktreeId: null, worktreeName: null, worktreeLabel: "", ...extra });
function model(id, members, group = "root", closeIds = members.map(item => item.sessionId)) {
  if (group === "worktree") members = members.map(item => ({ ...item, worktreeKind: "worktree", worktreeId: item.worktreeId ?? "fixture-tree" }));
  const keys = [...new Set(members.map(item => item.projectKey))];
  return { workspan: { id }, members, memberSessions: members.map(item => ({ id: item.sessionId })), projectKeys: keys, sessionIds: members.map(item => item.sessionId),
    closeSessionIds: closeIds, title: id, mixedProject: keys.length > 1,
    projectMemberships: keys.map(key => {
      const items = members.filter(item => item.projectKey === key);
      return { projectKey: key, members: items, sessionIds: items.map(item => item.sessionId),
        activationSessionId: items[0].sessionId, group: { key: `${key}:${group}`, kind: group } };
    }) };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const mixed = model("mixed", [member("a", "p"), member("b", "q"), member("c", "p")], "mixed-project");

test("project switch restores exact split member; outside-bar notifications/close activation follow active member", () => {
  reset();
  let active = "c";
  let models = [model("root", [member("root", "p")]), mixed, model("qroot", [member("qroot", "q")])];
  const calls = [];
  const activate = (workspan, session) => { calls.push([workspan, session]); active = session; };
  const run = () => render(() => useTerminalProjectSelection(models, active, activate));
  let hook = run();
  assert.equal(hook.selectedProjectKey, "p");
  hook.activateProject("q");
  assert.deepEqual(calls.at(-1), ["mixed", "b"]);
  hook = run();
  assert.equal(hook.selectedProjectKey, "q");
  hook.activateProject("p");
  assert.deepEqual(calls.at(-1), ["mixed", "c"]);
  active = "qroot"; // notification/navigation/drag/store activation outside the bar
  hook = run();
  assert.equal(hook.selectedProjectKey, "q");
  active = "root"; // close fallback emitted by the store
  hook = run();
  assert.equal(hook.selectedProjectKey, "p");
  models = [mixed]; // remembered qroot closed or excluded by sidebar scope
  hook = run();
  hook.activateProject("q");
  assert.deepEqual(calls.at(-1), ["mixed", "b"]);
});

test("mixed tab activation targets selected project; grouping/filter preserves close IDs and original trees", () => {
  reset();
  const calls = [];
  const hook = render(() => useTerminalProjectSelection([mixed], "b", (...args) => calls.push(args)));
  hook.activateWorkspanTab("mixed");
  assert.deepEqual(calls, [["mixed", "b"]]);
  const before = JSON.stringify(mixed);
  const groups = selectProjectTabGroups([mixed], "p", "running", { b: "running" });
  assert.equal(groups[0].models[0], mixed); // global matching member in another project
  const scoped = model("scoped", [member("a", "p")], "worktree", ["a"]);
  const result = selectProjectTabGroups([scoped], "p", "all", {});
  assert.equal(result[0].models[0], scoped);
  assert.deepEqual(result[0].models[0].closeSessionIds, ["a"]);
  assert.equal(JSON.stringify(mixed), before);
});

test("bar empty status filter keeps project; explicit project click exits filter, invalidates overflow menu, and + has no visible-tab source", () => {
  reset();
  const rowChanges = [], projects = [], newTabs = [];
  const p = model("p-root", [member("p1", "p")]);
  const q = model("q-root", [member("q1", "q")]);
  const props = { position: "top", models: [p, q, mixed], contextOptions: [
    { key: "p", project: "Project P" }, { key: "q", project: "Project Q" }],
    selectedProjectKey: "p", overflow: { isOverflowing: true, hiddenIds: ["q-root"] }, listOpen: false,
    activeWorkspanId: "p-root", notifications: {}, detachPreview: {},
    onRowChange: signature => rowChanges.push(signature), onActivateProject: key => projects.push(key),
    onNewTab: (...args) => newTabs.push(args), renderTab: m => ({ type: "test-tab", props: { id: m.workspan.id } }),
  };
  const run = () => render(() => WorkspanTabBar(props));
  let tree = run();
  const running = nodes(tree).find(node => node.props?.["aria-label"] === "terminal.status.running");
  running.props.onClick();
  tree = run();
  assert.equal(nodes(tree).filter(node => node.type === "test-tab").length, 0);
  assert.equal(nodes(tree).find(node => node.props?.role === "tab" && node.props?.["aria-selected"]).props.title, "Project P");
  assert.equal(nodes(tree).some(node => node.props?.["aria-label"] === "terminal.toolbar.newTerminal"), false);
  assert.deepEqual(newTabs, []);
  nodes(tree).find(node => node.props?.role === "tab" && node.props?.title === "Project Q").props.onClick();
  assert.deepEqual(projects, ["q"]);
  props.selectedProjectKey = "q";
  tree = run();
  assert.deepEqual(nodes(tree).filter(node => node.type === "test-tab").map(node => node.props.id), ["q-root", "mixed"]);
  assert.equal(nodes(tree).find(node => node.props?.["aria-label"] === "terminal.status.all").props["aria-pressed"], true);
  assert.equal(rowChanges.length, 3);
  assert.notEqual(rowChanges[1], rowChanges[2]);
});

test("new tab source remains actual active SSH/WSL member even when filtered or last visible tab differs", () => {
  const sessions = [{ id: "ssh", projectId: "p", worktreeId: "wt", environmentType: "ssh", sshHostId: "host" },
    { id: "wsl", environmentType: "wsl", shell: "wsl" },
    { id: "transcript", kind: "subagent-transcript", subagent: { parentSessionId: "ssh" } }];
  assert.equal(resolveNewTabSource(sessions, "ssh"), sessions[0]);
  assert.equal(resolveNewTabSource(sessions, "wsl"), sessions[1]);
  assert.equal(resolveNewTabSource(sessions, "transcript"), sessions[0]);
  assert.equal(resolveNewTabSource(sessions, "closed"), null);
});

test("overflow hook remeasures changed rows, clears stale menu, observes scroll, and respects active dragging", () => {
  reset();
  const frames = [];
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const flush = () => { const pending = frames.splice(0); pending.forEach(fn => fn()); };
  const listeners = new Map();
  let rects = [{ dataset: { workspanId: "old" }, getBoundingClientRect: () => ({ left: 150, right: 220 }), scrollIntoView() {} }];
  const scroller = { clientWidth: 100, scrollWidth: 220,
    getBoundingClientRect: () => ({ left: 0, right: 100 }), querySelectorAll: () => rects,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const scroll = { current: scroller }, bar = { current: null }, dragging = { current: null };
  const run = () => render(() => useWorkspanTabOverflow(bar, scroll, dragging, true, null));
  let hook = run(); flush(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow.hiddenIds, ["old"]);
  hook.setWorkspanTabListOpen(true); hook = run();
  assert.equal(hook.workspanTabListOpen, true);
  rects = [{ dataset: { workspanId: "new" }, getBoundingClientRect: () => ({ left: -20, right: 80 }), scrollIntoView() {} }];
  hook.onWorkspanRowChange("new project/group/filter"); hook = run();
  assert.equal(hook.workspanTabListOpen, false);
  assert.deepEqual(hook.workspanTabOverflow.hiddenIds, []);
  flush(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow.hiddenIds, ["new"]);
  dragging.current = "dragging";
  scroller.scrollWidth = 100;
  hook.updateWorkspanTabOverflow(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow.hiddenIds, ["new"]);
  dragging.current = null;
  listeners.get("scroll")(); flush(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow, { isOverflowing: false, hiddenIds: [] });
});

test("overflow is driven by rendered row signature and clears stale menu; backing layouts and scoped drag guards remain wired", () => {
  const overflow = readFileSync(new URL("../src/features/terminal/hooks/useWorkspanTabOverflow.ts", import.meta.url), "utf8");
  assert.match(overflow, /onWorkspanRowChange[\s\S]*setWorkspanTabListOpen\(false\)/);
  assert.match(overflow, /signature, updateWorkspanTabOverflow/);
  assert.match(overflow, /scrollWidth > scroller.clientWidth/);
  const view = readFileSync(new URL("../src/features/terminal/components/TerminalTabsView.tsx", import.meta.url), "utf8");
  assert.match(view, /mountedWorkspanLayouts\.map/);
  assert.match(view, /key=\{layout.workspan.id\}/);
  assert.match(view, /dragDisabled=\{hasScopedTerminalFilter\}/);
  assert.match(view, /handleCloseSessions\(model.closeSessionIds/);
  const controller = readFileSync(new URL("../src/features/terminal/hooks/useTerminalTabsController.tsx", import.meta.url), "utf8");
  assert.match(controller, /resolveNewTabSource\(sessions, sourceSessionId \?\? activeSessionId\)/);
  // Creation option inheritance is verified by the independently owned naming lane.
  assert.match(controller, /clearDragState[\s\S]*requestAnimationFrame[\s\S]*updateWorkspanTabOverflow\(\)/);
});

test("actual Workspan menu callbacks close only displayed grouped/project/status row targets", () => {
  reset();
  const a = model("A", [member("a", "p")]);
  // Scoped split: closing B must use only its supplied closeSessionIds, never all members.
  const b = model("B", [member("b", "p"), member("b-hidden", "p")], "worktree", ["b"]);
  const c = model("C", [member("c", "p")]);
  const q = model("Q", [member("q", "q")]);
  const mixedTab = model("mixed", [member("ma", "p"), member("mb", "q"), member("mc", "p")], "mixed-project");
  const calls = [], anchor = { x: 42 };
  const props = { t: key => key, mountedWorkspanLayouts: [{ workspan: { id: "A" } }],
    workspanEnabled: true, workspanTabModels: [a, b, q, c, mixedTab], selectedProjectKey: "p",
    renderToolbarActions: () => null, onWorkspanRowChange: () => {},
    workspanContextOptions: [], workspanTabOverflow: { isOverflowing: false, hiddenIds: [] },
    workspanDetachPreview: {}, visibleSessions: [],
    tabNotifications: { a: "running", b: "done", c: "running", ma: "running" },
    handleCloseSessions: (...args) => calls.push(args) };
  const view = TerminalTabsView(props);
  const bar = nodes(view).find(node => node.type === "WorkspanTerminalLayout").props.tabBar;
  assert.equal(bar.type, WorkspanTabBar);
  const run = () => render(() => WorkspanTabBar(bar.props));
  const tabs = tree => nodes(tree).filter(node => node.type === "SortableWorkspanTab");
  const menu = tab => nodes(tab.props.menuContent(() => anchor));
  const item = (tab, action) => menu(tab).find(node => node.props?.children === `terminal.workspan.${action}`);
  const close = (tab, action, expected) => {
    const entry = item(tab, action);
    assert.equal(entry.props.disabled ?? false, expected.length === 0);
    if (expected.length) {
      entry.props.onSelect();
      assert.deepEqual(calls.at(-1), [expected, anchor]);
    }
  };
  bar.props.models = [a, b, q, c];
  let tree = run(), row = tabs(tree);
  assert.deepEqual(row.map(tab => tab.props.workspan.id), ["A", "C", "B"]);
  assert.ok(row.every(tab => tab.props.showWorktreeBadge === true));
  assert.ok(row.every(tab => tab.props.worktreeBadge?.label));
  assert.ok(row.every(tab => tab.props.worktreeBadge?.color));
  close(row[1], "closeLeft", ["a"]);
  close(row[1], "closeRight", ["b"]);
  close(row[1], "closeOthers", ["a", "b"]);

  bar.props.models = props.workspanTabModels;
  tree = run(); row = tabs(tree);
  assert.deepEqual(row.map(tab => tab.props.workspan.id), ["A", "C", "B", "mixed"]);
  close(row[1], "closeLeft", ["a"]);
  close(row[1], "closeRight", ["b", "ma", "mb", "mc"]); // mixed model's exact close scope retained
  close(row[1], "closeOthers", ["a", "b", "ma", "mb", "mc"]);
  close(row[0], "closeLeft", []);
  close(row.at(-1), "closeRight", []);
  item(row[2], "closeCurrent").props.onSelect();
  assert.deepEqual(calls.at(-1), [["b"], anchor]);

  nodes(tree).find(node => node.props?.["aria-label"] === "terminal.status.running").props.onClick();
  tree = run(); row = tabs(tree);
  assert.deepEqual(row.map(tab => tab.props.workspan.id), ["A", "C", "mixed"]);
  close(row[1], "closeLeft", ["a"]);
  close(row[1], "closeRight", ["ma", "mb", "mc"]);
  close(row[1], "closeOthers", ["a", "ma", "mb", "mc"]);

  // Explicit project navigation exits global status mode.
  nodes(tree).find(node => node.props?.["aria-label"] === "terminal.status.all").props.onClick();
  bar.props.selectedProjectKey = "q";
  tree = run(); row = tabs(tree);
  assert.deepEqual(row.map(tab => tab.props.workspan.id), ["Q", "mixed"]);
  close(row[0], "closeOthers", ["ma", "mb", "mc"]);
  close(row[1], "closeLeft", ["q"]);
  close(row[1], "closeRight", []);

  nodes(tree).find(node => node.props?.["aria-label"] === "terminal.status.done").props.onClick();
  bar.props.notifications = { q: "done" };
  tree = run(); row = tabs(tree);
  assert.deepEqual(row.map(tab => tab.props.workspan.id), ["Q"]);
  close(row[0], "closeOthers", []);
  close(row[0], "closeLeft", []);
  close(row[0], "closeRight", []);
});

compile("../src/shared/i18n/messages/terminal.zh-CN.ts", "zh.mjs");
compile("../src/shared/i18n/messages/terminal.en-US.ts", "en.mjs");
const { zh } = await import(pathToFileURL(join(temp, "zh.mjs")));
const { en } = await import(pathToFileURL(join(temp, "en.mjs")));

const badgeLabels = { root: "Main", missing: "Missing", cross: "Cross", mixed: "Mixed" };
function badgeModel(id, kind, wtId, name, extraMembers = [], token = wtId ?? "") {
  const m = model(id, [member(id, "p", { worktreeId: wtId }), ...extraMembers], kind);
  m.members[0] = { ...m.members[0], worktreeKind: kind, worktreeId: wtId, worktreeName: name, worktreeLabel: token };
  m.projectMemberships[0].group = { key: JSON.stringify(["p", kind, wtId]), kind, worktreeId: wtId, worktreeName: name, worktreeLabel: token };
  return m;
}

test("persistent alias/Wn tokens survive name collisions, filtering and reordering", () => {
  const items = [badgeModel("a", "worktree", "tree-a", "same-full-name-1048", [], "W17"),
    badgeModel("b", "worktree", "tree-b", "same-full-name-1048", [], "release"),
    badgeModel("gone", "missing-worktree", "gone-id", null, [], "W23"),
    badgeModel("absent", "missing-worktree", "absent-id", null), badgeModel("root", "root", null, null)];
  const badges = buildWorktreeBadges(items, "p", badgeLabels);
  assert.deepEqual([...badges.values()].map(b => b.label), ["W17", "release", "Missing · W23", "Missing · absent-id", "Main"]);
  for (const item of items) {
    assert.deepEqual(buildWorktreeBadges([item], "p", badgeLabels).get(item.workspan.id), badges.get(item.workspan.id));
    assert.deepEqual(buildWorktreeBadges([...items].reverse(), "p", badgeLabels).get(item.workspan.id), badges.get(item.workspan.id));
  }
  assert.equal(buildGlobalWorktreeBadges(items, badgeLabels).get("a").label, "p / W17");
});

test("split/scoped badges use membership semantics; identity survives labels, notification, rename, member order and project selection", () => {
  const root = badgeModel("root", "root", null, null);
  const wt = badgeModel("wt", "worktree", "stable-id", "task-1048");
  const split = model("split", [member("s1", "p"), member("s2", "p", { worktreeKind: "worktree", worktreeId: "stable-id", worktreeLabel: "W17" })], "cross-worktree");
  const mixedTab = model("mx", [member("m1", "p", { worktreeKind: "worktree", worktreeId: "stable-id", worktreeLabel: "W17" }), member("m2", "q")], "mixed-project", ["m1"]);
  const all = [root, wt, split, mixedTab];
  const before = JSON.stringify(all);
  const badges = buildWorktreeBadges(all, "p", badgeLabels);
  assert.match(badges.get("split").label, /p \/ Main[\s\S]*p \/ W17/);
  assert.match(badges.get("mx").label, /p \/ W17[\s\S]*q \/ Main/);
  assert.deepEqual(buildWorktreeBadges([wt], "p", badgeLabels).get("wt"), badges.get("wt"));
  assert.deepEqual(buildWorktreeBadges(all, "q", badgeLabels).get("mx"), badges.get("mx"));
  const changed = structuredClone(all);
  changed[1].notification = "failed"; changed[1].title = "renamed";
  changed[1].projectMemberships[0].group.worktreeName = "new-display-name";
  changed[3].members.reverse();
  const after = buildWorktreeBadges(changed, "p", { root: "主", missing: "丢失", cross: "跨树", mixed: "混合" });
  for (const [id, badge] of badges) assert.equal(after.get(id).color, badge.color);
  assert.equal(JSON.stringify(all), before);
  assert.deepEqual(mixedTab.closeSessionIds, ["m1"]);
});

test("compiled bar/view/sortable render persistent badges without group headers, keeping title/icon, hover and status independent", () => {
  reset();
  const wt = badgeModel("wt", "worktree", "stable-id", "task-1048");
  const props = { position: "top", models: [badgeModel("root", "root", null, null), wt], selectedProjectKey: "p",
    contextOptions: [{ key: "p", project: "Project only" }], overflow: { isOverflowing: false, hiddenIds: [] },
    notifications: {}, detachPreview: {}, onRowChange() {}, renderTab: (m, targets, badge) => ({ type: "test-tab", props: { badge } }) };
  const tree = render(() => WorkspanTabBar(props));
  assert.equal(nodes(tree).filter(n => n.props?.className === "ui-workspan-group-label").length, 0);
  assert.ok(nodes(tree).some(n => n.type === "test-tab" && n.props.badge.label === "stable-id"));
  assert.equal(nodes(tree).filter(n => n.type === "test-tab").length, 2);
  assert.equal(nodes(tree).find(n => n.props?.role === "tab").props.title, "Project only");
  const badge = buildWorktreeBadges([wt], "p", badgeLabels).get("wt");
  const hover = { project: "Full project", worktree: "Full task name", branch: "branch", path: "/full/path" };
  const tabProps = { workspan: wt.workspan, title: "Terminal purpose", notification: "running", worktreeBadge: badge, hoverInfo: hover,
    isActive: true, menuContent: () => null };
  reset();
  let rendered = render(() => SortableWorkspanTab(tabProps));
  const find = cls => nodes(rendered).find(n => n.props?.className?.split(" ").includes(cls));
  assert.equal(find("ui-terminal-tab-title").props.children, "Terminal purpose");
  assert.ok(nodes(rendered).some(n => n.type === "Terminal"));
  assert.equal(find("ui-workspan-worktree-badge").props.children, "stable-id");
  assert.equal(nodes(rendered).filter(n => n.props?.className?.includes("ui-terminal-tab-context")).length, 0);
  const line = find("ui-workspan-tab").props.style["--worktree-identity-color"];
  const statusColor = find("ui-tab-runtime-dot").props.style.backgroundColor;
  tabProps.notification = "done"; tabProps.isActive = false;
  rendered = render(() => SortableWorkspanTab(tabProps));
  assert.equal(find("ui-workspan-tab").props.style["--worktree-identity-color"], line);
  assert.notEqual(find("ui-tab-runtime-dot").props.style.backgroundColor, statusColor);
  assert.deepEqual(tabProps.hoverInfo, hover);
  const css = readFileSync(new URL("../src/styles/components/focus-controls.css", import.meta.url), "utf8");
  assert.match(css, /height: 2px;[\s\S]*background: var\(--worktree-identity-color/);
  assert.ok(!css.includes(".ui-workspan-group-label"));
  tabProps.showWorktreeBadge = false;
  rendered = render(() => SortableWorkspanTab(tabProps));
  assert.equal(find("ui-workspan-worktree-badge"), undefined);
  assert.equal(find("ui-workspan-tab").props.style["--worktree-identity-color"], line);
  assert.ok(find("ui-workspan-tab").props.className.includes("h-7"));
});

test("both locales supply short root, missing and split badges without changing identity color", () => {
  const all = [badgeModel("root", "root", null, null), badgeModel("gone", "missing-worktree", "gone", null),
    badgeModel("cross", "cross-worktree", null, null), badgeModel("mixed", "mixed-project", null, null)];
  const localized = messages => buildWorktreeBadges(all, "p", {
    root: messages["terminal.context.badgeMain"], missing: messages["terminal.context.badgeMissing"],
    cross: messages["terminal.context.badgeCross"], mixed: messages["terminal.context.badgeMixed"],
  });
  const chinese = localized(zh), english = localized(en);
  assert.equal(chinese.get("root").label, "主");
  assert.equal(english.get("root").label, "Main");
  assert.equal(english.get("gone").label, "Missing · gone");
  for (const [id, badge] of chinese) {
    assert.ok(badge.label.length > 0);
    assert.equal(badge.color, english.get(id).color);
  }
});

test("overflow groups show persistent badges without group headers; scoped close is unchanged", () => {
  reset();
  const name = "very-long-identical-worktree-name-".repeat(12);
  const items = [badgeModel("one", "worktree", "tree-one", name), badgeModel("two", "worktree", "tree-two", name)];
  items[0].closeSessionIds = ["scoped-only"];
  const activated = [], closed = [], toggled = [];
  const tree = render(() => WorkspanTabBar({ position: "top", models: items, selectedProjectKey: "p",
    overflow: { isOverflowing: true, hiddenIds: ["one", "two"] }, listOpen: true,
    notifications: {}, detachPreview: {}, onRowChange() {}, renderTab: () => null,
    onActivate: id => activated.push(id), onClose: m => closed.push(m.closeSessionIds), onToggleList: value => toggled.push(value) }));
  const hasClass = (n, cls) => n.props?.className?.split(" ").includes(cls);
  const groups = nodes(tree).filter(n => hasClass(n, "ui-workspan-overflow-group"));
  assert.equal(groups.length, 2);
  groups.forEach((group, i) => {
    assert.equal(nodes(group).some(n => hasClass(n, "ui-workspan-group-label")), false);
    assert.equal(nodes(group).find(n => hasClass(n, "ui-workspan-worktree-badge")).props.children, `tree-${i ? "two" : "one"}`);
    const target = nodes(group).find(n => hasClass(n, "ui-workspan-overflow-target"));
    const close = nodes(group).find(n => hasClass(n, "ui-terminal-tab-close"));
    assert.ok(!nodes(target).includes(close));
    target.props.onClick();
    close.props.onClick({ stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({}) } });
  });
  assert.deepEqual(activated, ["one", "two"]);
  assert.deepEqual(closed, [["scoped-only"], ["two"]]);
  assert.deepEqual(toggled, [false, false, false, false]);
});


test("global status first-row navigation, mixed matching callbacks/overflow, updates, dedupe and stable empty results", () => {
  reset();
  const a = model("A", [member("a", "p")]);
  const b = model("B", [member("b", "q")]);
  const mx = model("MX", [member("ma", "p"), member("mb", "q")], "mixed-project", ["ma"]);
  mx.workspan.activeSessionId = "ma";
  const calls = [], projects = [], rows = [];
  const props = { position: "top", models: [a, mx, b, mx], selectedProjectKey: "p",
    contextOptions: [{ key: "p", project: "P" }, { key: "q", project: "Q" }],
    overflow: { isOverflowing: true, hiddenIds: ["MX", "B"] }, notifications: { mb: "running", b: "running" },
    detachPreview: {}, onRowChange: x => rows.push(x), onActivate: (...x) => calls.push(x),
    onActivateProject: x => projects.push(x), onToggleList() {}, onClose: m => calls.push(m.closeSessionIds),
    renderTab: (m, targets, badge, activate) => ({ type: "test-tab", props: { id: m.workspan.id, targets, badge, activate } }) };
  const run = () => render(() => WorkspanTabBar(props));
  const tabs = tree => nodes(tree).filter(n => n.type === "test-tab");
  let tree = run();
  const firstRow = nodes(tree).find(n => n.props?.className?.includes("ui-workspan-context-row"));
  assert.ok(nodes(firstRow).some(n => n.props?.["aria-label"] === "terminal.status.running"));
  nodes(tree).find(n => n.props?.["aria-label"] === "terminal.status.running").props.onClick();
  tree = run();
  assert.deepEqual(tabs(tree).map(n => n.props.id), ["MX", "B"]);
  assert.match(tabs(tree)[0].props.badge.label, /p[\s\S]*Main[\s\S]*q[\s\S]*Main/);
  tabs(tree)[0].props.activate();
  assert.deepEqual(calls.at(-1), ["MX", "mb"]);
  assert.deepEqual(tabs(tree)[0].props.targets.rightSessionIds, ["b"]);
  assert.deepEqual(tabs(tree)[1].props.targets.otherSessionIds, ["ma"]);
  const overflow = nodes(tree).filter(n => n.props?.className?.includes("ui-workspan-overflow-target"));
  overflow[0].props.onClick();
  assert.deepEqual(calls.at(-1), ["MX", "mb"]);
  props.selectedProjectKey = "q"; // activation/notification changes must not reset mode
  tree = run();
  assert.equal(nodes(tree).find(n => n.props?.["aria-label"] === "terminal.status.running").props["aria-pressed"], true);
  const signature = rows.at(-1);
  props.notifications = { mb: "running", b: "running", ma: "running" };
  tree = run();
  assert.notEqual(rows.at(-1), signature); // same result IDs, changed member state/count
  const callsBefore = calls.length;
  props.notifications = {};
  tree = run();
  assert.deepEqual(tabs(tree), []);
  assert.equal(calls.length, callsBefore);
  nodes(tree).find(n => n.props?.role === "tab" && n.props.title === "P").props.onClick();
  props.selectedProjectKey = "p";
  props.models = [a, mx, b];
  tree = run();
  assert.deepEqual(projects, ["p"]);
  assert.deepEqual(tabs(tree).map(n => n.props.id), ["A", "MX"]);
  nodes(tree).find(n => n.props?.["aria-label"] === "terminal.status.running").props.onClick();
  tree = run();
  nodes(tree).find(n => n.props?.["aria-label"] === "terminal.status.all").props.onClick();
  tree = run();
  assert.deepEqual(tabs(tree).map(n => n.props.id), ["A", "MX"]);
});

test("global target overrides remembered unrelated member; side scope and count dedupe remain upper bounds", async () => {
  const { countVisibleTabStatuses, resolveStatusWorkspanTarget } = await import(pathToFileURL(join(temp, "selection.mjs")));
  reset();
  const calls = [];
  const hook = render(() => useTerminalProjectSelection([mixed], "a", (...args) => calls.push(args)));
  hook.activateWorkspanTab("mixed", "b");
  assert.deepEqual(calls, [["mixed", "b"]]);
  hook.activateProject("p");
  assert.deepEqual(calls.at(-1), ["mixed", "a"]);
  assert.deepEqual(countVisibleTabStatuses([mixed, mixed], { a: "running", b: "running" }),
    { running: 2, done: 0, failed: 0, attention: 0 });
  const scoped = model("scoped", [member("a", "p")], "root", ["a"]);
  assert.equal(resolveStatusWorkspanTarget(scoped, "running", { b: "running" }), null);
  assert.deepEqual(selectProjectTabGroups([scoped], "p", "running", { b: "running" }), []);
  assert.deepEqual(scoped.closeSessionIds, ["a"]);
});


function globalBadgeModel(id, projectKey, project, wtId = null, name = null, kind = "worktree") {
  return model(id, [member(id, projectKey, { project, worktreeId: wtId, worktreeName: name, worktreeLabel: wtId ? name ?? wtId : "", worktreeKind: wtId ? kind : "root" })]);
}
function assertStableUniqueGlobalBadges(items) {
  const before = JSON.stringify(items);
  const badges = buildGlobalWorktreeBadges(items, badgeLabels);
  const identities = new Map();
  const used = new Map();
  for (const badge of badges.values()) {
    if (identities.has(badge.identity)) assert.deepEqual(badge, identities.get(badge.identity));
    else {
      assert.ok(!used.has(badge.label.toLowerCase()), `duplicate badge: ${badge.label}`);
      used.set(badge.label.toLowerCase(), badge.identity);
      identities.set(badge.identity, badge);
    }
  }
  const reversed = buildGlobalWorktreeBadges([...items].reverse().map(item => ({ ...item, members: [...item.members].reverse() })), badgeLabels);
  for (const [id, badge] of badges) assert.deepEqual(reversed.get(id), badge);
  assert.equal(JSON.stringify(items), before);
  return badges;
}

test("RV-GLOBAL-001: generated ID fallbacks and literal names stay unique and reversal-stable", () => {
  const items = [globalBadgeModel("a", "p", "P", "a", "foo"),
    globalBadgeModel("b", "p", "P", "b", "foo"), globalBadgeModel("c", "p", "P", "c", "foo · a"),
    globalBadgeModel("repeat", "p", "P", "a", "foo"),
    globalBadgeModel("ordinal-blocker", "p", "P", "bb", 'foo · a · ["p","c"]')];
  const badges = assertStableUniqueGlobalBadges(items);
  assert.notEqual(badges.get("a").label, badges.get("c").label);
  assert.ok(badges.get("c").label.includes("foo · a")); // literal alias stays visible, not runtime numbering
  assert.deepEqual(badges.get("a"), badges.get("repeat"));
});

test("global root/missing/reserved and same-name project fallbacks cannot collide with literal text", () => {
  const items = [globalBadgeModel("root", "p", "P"),
    globalBadgeModel("gone", "p", "P", "gone", null, "missing-worktree"),
    globalBadgeModel("literal-missing", "p", "P", "valid", "Missing · gone"),
    ...["Main", "Missing", "Cross", "Mixed"].flatMap((name, i) => [
      globalBadgeModel(`reserved${i}`, "p", "P", `r${i}`, name),
      globalBadgeModel(`literal${i}`, "p", "P", `l${i}`, `${name} · r${i}`)]),
    globalBadgeModel("same1", "s1", "Same"), globalBadgeModel("same2", "s2", "same"),
    globalBadgeModel("project-literal", "s3", "Same · s1")];
  assertStableUniqueGlobalBadges(items);
});

test("complete mixed-context labels resolve separator collisions and reuse repeated identities", () => {
  const p = member("p-root", "p", { project: "P" });
  const q = member("q-root", "q", { project: "Q" });
  const items = [model("mixed", [p, q]), model("mixed-repeat", [q, p, p]),
    globalBadgeModel("literal", "z", "P / Main + Q")];
  const badges = assertStableUniqueGlobalBadges(items);
  assert.deepEqual(badges.get("mixed"), badges.get("mixed-repeat"));
  assert.notEqual(badges.get("mixed").label, badges.get("literal").label);
});

test("each project chip x compiled view/bar callback targets clicked project without activating or resetting filter", () => {
  reset();
  const mx = model("MX", [member("a", "p"), member("idle", "p"), member("q", "q"),
    member("editor", "p"), member("transcript", "p"), member("temp", "p"), member("hidden", "p")], "mixed-project");
  mx.memberSessions = mx.memberSessions.map(s => ({ ...s,
    ...(s.id === "editor" ? { kind: "file-editor" } : s.id === "transcript" ? { kind: "subagent-transcript" }
      : s.id === "temp" ? { kind: "synced-history" } : s.id === "hidden" ? { tabHidden: true } : {}) }));
  const scoped = model("scoped", [member("scoped", "p")]); // scope-excluded backing members never supplied
  const calls = [], destructive = [], projects = [], activated = [];
  const view = TerminalTabsView({ t: key => key, mountedWorkspanLayouts: [{ workspan: { id: "MX" } }], workspanEnabled: true,
    workspanTabModels: [mx, scoped, mx], selectedProjectKey: "p", renderToolbarActions: () => null,
    workspanContextOptions: [{ key: "p", project: "P" }, { key: "q", project: "Q" }], workspanTabOverflow: { hiddenIds: [] },
    workspanDetachPreview: {}, visibleSessions: [], onWorkspanRowChange() {},
    tabNotifications: { a: "running", q: "running", editor: "running", transcript: "running", temp: "running", hidden: "running", scoped: "done" },
    handleHideProjectTerminals: ids => calls.push(ids), handleCloseSessions: ids => destructive.push(ids) });
  const bar = nodes(view).find(n => n.type === "WorkspanTerminalLayout").props.tabBar;
  const run = () => render(() => WorkspanTabBar(bar.props));
  bar.props.onActivateProject = key => projects.push(key);
  bar.props.onActivate = (...args) => activated.push(args);
  const button = (tree, project = "P") => nodes(tree).find(n => n.props?.["aria-label"] === `terminal.context.hideDisplayedProjectTerminals: ${project}`);
  const click = x => x.props.onClick({ stopPropagation() {} });
  const mode = (tree, status) => nodes(tree).find(n => n.props?.["aria-label"] === `terminal.status.${status}`);
  let tree = run(), x = button(tree);
  assert.equal(x.props.disabled, false);
  assert.match(x.props.className, /ui-workspan-project-hide/);
  assert.doesNotMatch(x.props.className, /ui-terminal-tab-close/);
  const hideStyles = readFileSync(new URL("../src/styles/components/focus-controls.css", import.meta.url), "utf8");
  assert.match(hideStyles, /\.ui-workspan-project-hide\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/);
  assert.match(hideStyles, /\.ui-workspan-project-hide:disabled\s*\{[^}]*opacity:\s*0\.4;[^}]*pointer-events:\s*none;/);
  assert.equal(nodes(tree).filter(n => n.props?.className?.includes("ui-workspan-project-hide")).length, 2);
  for (const chip of nodes(tree).filter(n => n.props?.className?.includes("ui-workspan-project-chip"))) {
    const [nav, hide] = chip.props.children;
    assert.equal(nav.type, "button");
    assert.equal(hide.type, "button");
    assert.equal(nav.props.role, "tab");
    assert.equal(hide.props.title, hide.props["aria-label"]);
    assert.ok(hide.props.title.includes(nav.props.title));
    assert.doesNotMatch(hide.props.className, /ml-auto|ui-terminal-tab-close/);
    assert.ok(!nodes(nav).includes(hide)); // independent sibling, no nested buttons
    assert.equal(chip.props.onClick, undefined);
  }
  click(x);
  assert.deepEqual(calls.at(-1), ["a", "idle", "scoped"]);
  // All mode also closes nonselected Q's in-scope members, despite P's displayed row.
  click(button(tree, "Q"));
  assert.deepEqual(calls.at(-1), ["q"]);
  tree = run();
  assert.equal(bar.props.selectedProjectKey, "p");
  assert.equal(mode(tree, "all").props["aria-pressed"], true);
  const firstRow = nodes(tree).find(n => n.props?.className?.includes("ui-workspan-context-row"));
  assert.notEqual(firstRow.props.children.at(-1)?.type, "button"); // no global row-end x
  mode(tree, "running").props.onClick();
  tree = run(); click(button(tree));
  assert.deepEqual(calls.at(-1), ["a"]); // exact member status, not whole matching mixed Workspan
  click(button(tree, "Q"));
  assert.deepEqual(calls.at(-1), ["q"]);
  tree = run();
  assert.equal(mode(tree, "running").props["aria-pressed"], true);
  bar.props.selectedProjectKey = "q";
  tree = run(); click(button(tree, "Q"));
  assert.deepEqual(calls.at(-1), ["q"]);
  click(button(tree));
  assert.deepEqual(calls.at(-1), ["a"]); // nonselected P in global mode
  mode(tree, "done").props.onClick();
  tree = run(); click(button(tree));
  assert.deepEqual(calls.at(-1), ["scoped"]);
  assert.equal(button(tree, "Q").props.disabled, true);
  mode(tree, "failed").props.onClick();
  bar.props.notifications = { idle: "failed", q: "running", scoped: "done" };
  tree = run(); click(button(tree));
  assert.deepEqual(calls.at(-1), ["idle"]);
  assert.equal(button(tree, "Q").props.disabled, true);
  assert.deepEqual(projects, []);
  assert.deepEqual(activated, []);
  mode(tree, "all").props.onClick();
  bar.props.selectedProjectKey = "p";
  bar.props.models = [model("only-other", [member("other", "q")])];
  tree = run(); assert.equal(button(tree).props.disabled, true);
  bar.props.models = [model("pseudo", [member("editor", "p")])];
  bar.props.models[0].memberSessions[0].kind = "file-editor";
  tree = run(); assert.equal(button(tree).props.disabled, true);
  assert.deepEqual(destructive, []);
  for (const messages of [zh, en]) {
    const label = messages["terminal.context.hideDisplayedProjectTerminals"];
    assert.ok(label.includes("{project}"));
    assert.match(label, /unhidden ordinary terminals|未隐藏的普通终端/);
    assert.match(label, /do not delete|不删除/);
  }
});

test("project hide target selector never expands scoped visible members to closeSessionIds or backing pane IDs", async () => {
  const { displayedProjectTerminalIds } = await import(pathToFileURL(join(temp, "hide.mjs")));
  const scoped = model("mixed", [member("visible", "p")], "worktree", ["visible", "out-of-scope", "other-project"]);
  scoped.workspan.paneTree = { sessionIds: ["visible", "out-of-scope", "other-project"] };
  const before = JSON.stringify(scoped);
  assert.deepEqual(displayedProjectTerminalIds([scoped, scoped], "p", "all", {}), ["visible"]);
  assert.deepEqual(displayedProjectTerminalIds([scoped], "p", "running", { "out-of-scope": "running" }), []);
  assert.equal(JSON.stringify(scoped), before);
});

test("global A-B-A segments preserve first unique backing order, full visible contexts and close references", () => {
  const a = globalBadgeModel("A", "p", "P", "a", "Full-worktree-A");
  const b = globalBadgeModel("B", "p", "P", "b", "Full-worktree-B");
  const again = globalBadgeModel("A2", "p", "P", "a", "Full-worktree-A");
  const all = [a, b, again, a];
  const groups = selectProjectTabGroups(all, null, "running", { A: "running", B: "running", A2: "running" });
  assert.deepEqual(groups.map(g => g.models.map(m => m.workspan.id)), [["A"], ["B"], ["A2"]]);
  assert.equal(new Set(groups.map(g => g.group.key)).size, 3);
  assert.deepEqual(groups.flatMap(g => g.models), [a, b, again]);
  groups.flatMap(g => g.models).forEach((m, i) => assert.strictEqual(m.closeSessionIds, all[i].closeSessionIds));
  assert.deepEqual(selectProjectTabGroups(all, "p", "all", {}).map(g => g.models.map(m => m.workspan.id)), [["A", "A2"], ["B"]]);
  const mx = model("mx", [member("hit", "p", { worktreeKind: "worktree", worktreeId: "a", worktreeName: "Full-worktree-A" }),
    member("not-matching", "q", { worktreeKind: "worktree", worktreeId: "b", worktreeName: "Full-worktree-B" })]);
  const selected = selectProjectTabGroups([mx, mx], null, "done", { hit: "done" });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].group.contexts.length, 2);
  assert.deepEqual(selected[0].group.contexts.map(c => c.worktreeName), ["Full-worktree-A", "Full-worktree-B"]);
});

test("compiled current context renders full active metadata and deduplicated scoped contexts above either docking position", () => {
  const long = "full-worktree-name-".repeat(30);
  const active = member("active", "p", { project: "Full project", worktreeKind: "worktree", worktreeId: "tree", worktreeLabel: "W17", worktreeName: long, branch: "feature/full", worktreePath: "/full/path" });
  const m = model("split", [member("other", "q"), active, { ...active, sessionId: "duplicate" }]);
  const tree = TerminalCurrentContext({ models: [m], workspanId: "split", sessionId: "active" });
  assert.equal(tree.props.children.length, 2);
  assert.equal(tree.props.children[0].props["data-current"], "true");
  assert.equal(tree.props.children[1].props["data-current"], "false");
  assert.equal(tree.props.children[0].props.children[1].props.children, `Full project / W17 / ${long} / feature/full / /full/path`);
  assert.equal(tree.props.children[1].props.children[1].props.children, "q / terminal.context.rootDirectory");
  assert.equal(TerminalCurrentContext({ models: [m], workspanId: "split", sessionId: "out-of-scope" }), null);
  assert.equal(TerminalCurrentContext({ models: [m], workspanId: "absent", sessionId: "active" }), null);
  for (const position of ["top", "bottom"]) for (const visible of [true, false]) {
    const view = TerminalTabsView({ t: key => key, mountedWorkspanLayouts: [{ workspan: { id: "split" } }],
      workspanEnabled: true, workspanTabModels: [m], effectiveActiveWorkspanId: "split", currentContextSessionId: "active",
      workspanTabBarPosition: position, workspanTabBarVisible: visible, renderToolbarActions: () => null, visibleSessions: [] });
    const contexts = nodes(view).filter(n => n.type === TerminalCurrentContext);
    assert.equal(contexts.length, 1);
    assert.deepEqual(contexts[0].props, { models: [m], workspanId: "split", sessionId: "active" });
    const parent = nodes(view).find(n => Array.isArray(n.props?.children) && n.props.children.includes(contexts[0]));
    const layout = parent.props.children.find(n => n?.type === "WorkspanTerminalLayout");
    assert.ok(parent.props.children.indexOf(contexts[0]) < parent.props.children.indexOf(layout));
    assert.equal(layout.props.position, position);
    assert.equal(layout.props.tabBarVisible, visible);
  }
});

test("overflow observes only tab geometry, uses client viewport/scrollLeft only, pauses dragging and clears disabled/zero width", () => {
  reset();
  const frames = [], observed = [];
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const flush = () => frames.splice(0).forEach(fn => fn());
  let resize;
  globalThis.ResizeObserver = class { constructor(fn) { resize = fn; } observe(node) { observed.push(node); } disconnect() {} };
  const title = { title: true }, group = { group: true };
  const tab = { dataset: { workspanId: "active" }, getBoundingClientRect: () => ({ left: 170, right: 220 }),
    scrollIntoView() { assert.fail("ancestor scrolling forbidden"); } };
  const clipped = { dataset: { workspanId: "clipped" }, getBoundingClientRect: () => ({ left: 90, right: 130 }) };
  const scroller = { clientWidth: 100, clientLeft: 2, scrollWidth: 400, scrollLeft: 10,
    getBoundingClientRect: () => ({ left: 0, right: 130 }),
    querySelectorAll: selector => selector.includes("group") ? [title, group, tab, clipped] : [tab, clipped, clipped],
    addEventListener() {}, removeEventListener() {} };
  let enabled = true;
  const dragging = { current: null }, bar = { current: {} }, scroll = { current: scroller };
  const run = () => render(() => useWorkspanTabOverflow(bar, scroll, dragging, enabled, "active"));
  let hook = run();
  assert.equal(scroller.scrollLeft, 128);
  assert.ok(!observed.includes(title) && !observed.includes(group));
  assert.ok(observed.includes(tab) && observed.includes(clipped));
  flush(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow.hiddenIds, ["active", "clipped"]);
  dragging.current = "drag"; scroller.scrollWidth = 100;
  resize(); flush(); hook = run();
  assert.equal(hook.workspanTabOverflow.isOverflowing, true);
  dragging.current = null; hook.updateWorkspanTabOverflow(); hook = run();
  assert.equal(hook.workspanTabOverflow.isOverflowing, false);
  scroller.scrollWidth = 400; scroller.clientWidth = 0;
  hook.updateWorkspanTabOverflow(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow, { isOverflowing: false, hiddenIds: [] });
  scroller.clientWidth = 100; hook.updateWorkspanTabOverflow(); hook = run();
  hook.setWorkspanTabListOpen(true); hook = run();
  enabled = false; hook = run(); flush(); hook = run();
  assert.deepEqual(hook.workspanTabOverflow, { isOverflowing: false, hiddenIds: [] });
  assert.equal(hook.workspanTabListOpen, false);
  delete globalThis.ResizeObserver;
});

test("oversized active tabs align their left edge within the scroller, never an ancestor", () => {
  for (const geometry of [{ left: 170, right: 420, width: 250, expected: 178 },
    { left: -20, right: 230, width: 250, expected: 0 }]) {
    reset();
    const frames = [];
    globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
    globalThis.cancelAnimationFrame = () => {};
    const selectors = [];
    const tab = { dataset: { workspanId: "wide" }, getBoundingClientRect: () => geometry,
      scrollIntoView() { assert.fail("must not scroll ancestors"); } };
    const scroller = { clientWidth: 100, clientLeft: 2, scrollWidth: 600, scrollLeft: 10,
      getBoundingClientRect: () => ({ left: 0, right: 130 }),
      querySelectorAll(selector) { selectors.push(selector); return [tab]; },
      addEventListener() {}, removeEventListener() {} };
    render(() => useWorkspanTabOverflow({ current: null }, { current: scroller }, { current: null }, true, "wide"));
    assert.equal(scroller.scrollLeft, geometry.expected);
    assert.ok(selectors.every(selector => selector === "[data-workspan-id]"));
    frames.splice(0).forEach(fn => fn());
  }
});

test("current/mixed context maps existing aliases and Wn to full names without renumbering", () => {
  const a = member("a", "p", { project: "Same", projectId: "p", worktreeKind: "worktree", worktreeId: "a", worktreeLabel: "审查", worktreeName: "Full alias name" });
  const b = member("b", "q", { project: "Same", projectId: "q", worktreeKind: "missing-worktree", worktreeId: "b", worktreeLabel: "W2147483647", worktreeName: "Full missing name" });
  const m = model("mixed", [a, b, { ...a, sessionId: "duplicate" }]);
  const before = JSON.stringify(m);
  for (const sessionId of ["a", "b"]) {
    const rows = TerminalCurrentContext({ models: [m], workspanId: "mixed", sessionId }).props.children;
    assert.equal(rows.length, 2);
    const text = rows.map(row => row.props.children[1].props.children);
    assert.ok(text.includes("Same · p / 审查 / Full alias name"));
    assert.ok(text.includes("Same · q / W2147483647 / Full missing name / terminal.context.worktreeMissing"));
    assert.ok(text[0].includes(sessionId === "a" ? "审查" : "W2147483647"));
    assert.equal(rows[0].props.children[0].props.children[0], "terminal.context.current");
    assert.equal(rows[1].props.children[0].props.children[0], "terminal.context.otherVisible");
  }
  assert.equal(JSON.stringify(m), before);
});

test("top overflow complete mixed tokens remain inside the bounded text column", async () => {
  reset();
  const hasClass = (n, cls) => n.props?.className?.split(" ").includes(cls);
  const project = "SameVeryLongProjectName".repeat(8);
  const members = [member("a", "p", { project, projectId: "duplicate-project-id-p", worktreeKind: "worktree", worktreeId: "a", worktreeLabel: "W2147483647" }),
    member("b", "q", { project, projectId: "duplicate-project-id-q", worktreeKind: "worktree", worktreeId: "b", worktreeLabel: "十二字符别名审查" })];
  const m = model("mixed", members);
  const tree = render(() => WorkspanTabBar({ position: "top", models: [m], selectedProjectKey: "p",
    contextOptions: [], overflow: { isOverflowing: true, hiddenIds: ["mixed"] }, listOpen: true,
    notifications: {}, detachPreview: { left: 0, visible: false }, onRowChange() {}, renderTab: () => null }));
  const token = nodes(tree).find(n => hasClass(n, "ui-workspan-worktree-badge"));
  assert.ok(token.props.children.includes("W2147483647"));
  assert.ok(token.props.children.includes("十二字符别名审查"));
  assert.ok(token.props.children.includes("duplicate-project-id-p"));
  assert.ok(token.props.children.includes("duplicate-project-id-q"));
  assert.ok(nodes(tree).some(n => hasClass(n, "ui-workspan-overflow-text") && nodes(n).includes(token)));
  if (process.env.TERMINAL_GEOMETRY_DIR) {
    const { saveOverflowFixture } = await import("./terminalOverflowGeometry.fixture.mjs");
    await saveOverflowFixture("top-overflow", nodes(tree).find(n => hasClass(n, "ui-terminal-tab-list-popover")));
  }
});
