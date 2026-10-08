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
compile("../src/features/projects/api/worktreeMetadata.ts", "metadata.mjs");
compile("../src/features/terminal/api/terminalWorktreeBadge.ts", "badge.mjs", code =>
  code.replace('"../../projects/api/worktreeMetadata"', '"./metadata.mjs"'));
const { buildWorktreeBadges, buildGlobalWorktreeBadges } = await import(pathToFileURL(join(temp, "badge.mjs")));
const { getCompactWorktreeLabel } = await import(pathToFileURL(join(temp, "metadata.mjs")));
compile("../src/features/terminal/api/terminalProjectTabsModel.ts", "model.mjs", (code) =>
  code.replace(/import[^;]*;\n/g, "const resolveProjectForSession = () => null; const findWorktreeForSession = () => null;\n"));
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
const member = (id, projectKey, extra = {}) => ({ sessionId: id, projectKey, project: projectKey, ...extra });
function model(id, members, group = "root", closeIds = members.map(item => item.sessionId)) {
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
  assert.match(controller, /sourceSession\?\.shell \?\? projectLaunchOptions\?\.shell/);
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
function badgeModel(id, kind, wtId, name, extraMembers = []) {
  const m = model(id, [member(id, "p", { worktreeId: wtId }), ...extraMembers], kind);
  m.projectMemberships[0].group = { key: JSON.stringify(["p", kind, wtId]), kind, worktreeId: wtId, worktreeName: name };
  return m;
}

test("compiled shared compact helper and badge model distinguish same tails, long/identical names and reserved/fallback collisions", () => {
  const pairs = ["task-1007-1048", "task-1007-1111", "alpha-very-long-identical-tail", "beta-very-long-identical-tail",
    "same", "same", "Main", "Missing", "Cross", "Mixed", "same · w4"];
  const items = pairs.map((name, i) => badgeModel(`t${i}`, "worktree", `w${i}`, name));
  const all = [badgeModel("root", "root", null, null), ...items,
    badgeModel("gone1", "missing-worktree", "gone1", "Missing"), badgeModel("gone2", "missing-worktree", "gone2", "Missing")];
  const badges = buildWorktreeBadges(all, "p", badgeLabels);
  assert.equal(new Set([...badges.values()].map(item => item.label.toLowerCase())).size, all.length);
  assert.equal(badges.get("t0").label, "1048");
  assert.equal(badges.get("t1").label, "1111");
  assert.notEqual(badges.get("t2").label, badges.get("t3").label);
  assert.ok(!badges.get("t2").label.includes("…"));
  assert.match(badges.get("gone1").label, /Missing/);
  assert.equal(badges.get("root").label, "Main");
  const reversed = buildWorktreeBadges([...all].reverse(), "p", badgeLabels);
  for (const [id, badge] of badges) assert.deepEqual(reversed.get(id), badge);
  const paths = [{ id: "a", name: "alpha\same" }, { id: "b", name: "beta/same" }];
  assert.notEqual(getCompactWorktreeLabel(paths[0], paths), getCompactWorktreeLabel(paths[1], paths));
});

test("split/scoped badges use membership semantics; identity survives labels, notification, rename, member order and project selection", () => {
  const root = badgeModel("root", "root", null, null);
  const wt = badgeModel("wt", "worktree", "stable-id", "task-1048");
  const split = badgeModel("split", "cross-worktree", null, null, [member("s2", "p", { worktreeId: "stable-id" })]);
  const mixedTab = model("mx", [member("m1", "p", { worktreeId: "stable-id" }), member("m2", "q")], "mixed-project", ["m1"]);
  const all = [root, wt, split, mixedTab];
  const before = JSON.stringify(all);
  const badges = buildWorktreeBadges(all, "p", badgeLabels);
  assert.equal(badges.get("split").label, "Cross");
  assert.equal(badges.get("mx").label, "Mixed");
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

test("compiled bar/view/sortable render no standalone labels or duplicated identity metadata, keeping title/icon, hover and status independent", () => {
  reset();
  const wt = badgeModel("wt", "worktree", "stable-id", "task-1048");
  const props = { position: "top", models: [badgeModel("root", "root", null, null), wt], selectedProjectKey: "p",
    contextOptions: [{ key: "p", project: "Project only" }], overflow: { isOverflowing: false, hiddenIds: [] },
    notifications: {}, detachPreview: {}, onRowChange() {}, renderTab: (m, targets, badge) => ({ type: "test-tab", props: { badge } }) };
  const tree = render(() => WorkspanTabBar(props));
  assert.equal(nodes(tree).filter(n => n.props?.className === "ui-workspan-group-label").length, 0);
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
  assert.equal(find("ui-workspan-worktree-badge").props.children, "1048");
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
  assert.equal(english.get("gone").label, "Missing");
  for (const [id, badge] of chinese) {
    assert.ok(badge.label.length > 0);
    assert.equal(badge.color, english.get(id).color);
  }
});

test("long identical-name overflow badges remain contained below title with full unique hover and scoped close", () => {
  reset();
  const name = "very-long-identical-worktree-name-".repeat(12);
  const items = [badgeModel("one", "worktree", "stable-identity-one-".repeat(8), name),
    badgeModel("two", "worktree", "stable-identity-two-".repeat(8), name)];
  items[0].title = "Primary terminal one";
  items[1].title = "Primary terminal two";
  items[0].closeSessionIds = ["scoped-only"];
  const activated = [], closed = [], toggled = [];
  const tree = render(() => WorkspanTabBar({ position: "top", models: items, selectedProjectKey: "p",
    overflow: { isOverflowing: true, hiddenIds: ["one", "two"] }, listOpen: true,
    notifications: {}, detachPreview: {}, onRowChange() {}, renderTab: () => null,
    onActivate: id => activated.push(id), onClose: m => closed.push(m.closeSessionIds), onToggleList: value => toggled.push(value) }));
  const hasClass = (n, cls) => n.props?.className?.split(" ").includes(cls);
  const rows = nodes(tree).filter(n => hasClass(n, "ui-terminal-tab-list-item"));
  const labels = [];
  rows.forEach((row, i) => {
    const target = nodes(row).find(n => hasClass(n, "ui-workspan-overflow-target"));
    const column = nodes(target).find(n => hasClass(n, "ui-workspan-overflow-text"));
    assert.ok(column.props.className.includes("min-w-0"));
    assert.ok(column.props.className.includes("flex-1"));
    assert.ok(column.props.className.includes("flex-col"));
    assert.ok(column.props.className.includes("overflow-hidden"));
    const [title, badge] = column.props.children;
    assert.equal(title.props.children, items[i].title);
    assert.ok(title.props.className.includes("w-full truncate"));
    const label = badge.props.children;
    assert.ok(label.length > 200);
    assert.equal(badge.props.title, label); // full ID fallback remains available on hover
    assert.ok(target.props.title.includes(label));
    labels.push(label);
    const close = nodes(row).find(n => hasClass(n, "ui-terminal-tab-close"));
    assert.ok(close.props.className.includes("shrink-0"));
    assert.ok(!nodes(target).includes(close)); // separate sibling, not inside clipped content
    target.props.onClick();
    close.props.onClick({ stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({}) } });
  });
  assert.notEqual(labels[0], labels[1]);
  assert.deepEqual(activated, ["one", "two"]);
  assert.deepEqual(closed, [["scoped-only"], ["two"]]);
  assert.deepEqual(toggled, [false, false, false, false]);
  const css = readFileSync(new URL("../src/styles/components/focus-controls.css", import.meta.url), "utf8");
  const rule = css.match(/\.ui-workspan-overflow-text > \.ui-workspan-worktree-badge\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  for (const declaration of ["min-width: 0", "max-width: 100%", "box-sizing: border-box", "overflow: hidden", "text-overflow: ellipsis"]) {
    assert.ok(rule.includes(declaration), declaration);
  }
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
  assert.match(tabs(tree)[0].props.badge.label, /p.*Main.*q.*Main/);
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
  return model(id, [member(id, projectKey, { project, worktreeId: wtId, worktreeName: name, worktreeKind: kind })]);
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
  assert.match(badges.get("c").label, / · 2$/);
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
