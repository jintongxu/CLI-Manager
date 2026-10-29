import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const source = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
function load(path, deps = {}, extra = "") {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const body = file.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(file)).join("\n");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(body + extra, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: (id) => { assert.equal(id, "react/jsx-runtime"); return jsx; }, ...deps });
  return exports;
}
const groupPath = load("../api/groupPath.ts");
const display = load("../lib/sidebarDisplay.ts", groupPath);
const project = (id, path, extra = {}) => ({ id, path, name: "repo", environment_type: "local", remote_path: "", icon: "", color: "", cli_tool: "codex", ...extra });
test("shortest unique parent suffix handles POSIX, WSL, Windows, UNC and SSH without changing input/order", () => {
  for (const paths of [["/one/repo", "/two/repo"], ["C:\\one\\repo", "D:\\two\\repo"],
    ["//wsl.localhost/Ubuntu/one/repo", "//wsl.localhost/Debian/two/repo"],
    ["ssh://host/a/repo", "ssh://other/b/repo"]]) {
    const items = paths.map((path, i) => project(`p${i}`, path));
    const before = JSON.stringify(items);
    assert.equal(display.projectDisplayLabels(items).get("p0"), "repo · " + (paths[0].includes("/a/") ? "a" : "one"));
    assert.deepEqual([...display.projectDisplayLabels(items)].sort(), [...display.projectDisplayLabels([...items].reverse())].sort());
    assert.equal(JSON.stringify(items), before);
  }
  const deeper = [project("a", "/alpha/shared/repo"), project("b", "/beta/shared/repo")];
  assert.equal(display.projectDisplayLabels(deeper).get("a"), "repo · alpha/shared");
  const drives = [project("a", "C:\\repo"), project("b", "D:\\repo")];
  assert.equal(display.projectDisplayLabels(drives).get("a"), "repo · C:");
});
test("same/empty paths and prefix-colliding IDs fall back stably, including SSH remote precedence", () => {
  for (const path of ["", "/same/repo"]) {
    const items = [project("abcdef1", path), project("abcdef2", path)];
    const labels = display.projectDisplayLabels(items);
    assert.notEqual(labels.get("abcdef1"), labels.get("abcdef2"));
    assert.match(labels.get("abcdef1"), /abcdef1$/);
  }
  const ssh = project("remote", "C:/wrong/repo", { environment_type: "ssh", remote_path: "/remote/right/repo" });
  assert.equal(display.projectDisplayPath(ssh), "/remote/right/repo");
  assert.equal(display.projectDisplayLabels([ssh, project("local", "/local/left/repo")]).get("remote"), "repo · right");
  assert.equal(display.projectDisplayLabels([project("single", "/a/repo")]).get("single"), "repo");
});
test("session collisions add CLI/type then unique short ID, never mutate title or identity", () => {
  const items = [{ id: "abcdef1", title: "same", cliTool: "codex" }, { id: "abcdef2", title: "same", cliTool: "codex" },
    { id: "shell", title: "same" }, { id: "other", title: "alone" }];
  const before = JSON.stringify(items);
  const labels = display.sessionDisplayLabels(items, "Terminal");
  assert.equal(labels.get("abcdef1"), "same · codex · abcdef1");
  assert.equal(labels.get("shell"), "same · Terminal");
  assert.equal(labels.get("other"), "alone");
  assert.equal(JSON.stringify(items), before);
  assert.equal(display.sessionDisplayTooltip({ title: "same", cwd: "wrong", remotePath: "/remote", environmentType: "ssh" }, "same · codex", "Running"), "same · codex\nsame\n/remote\nRunning");
});
const icon = (name) => () => React.createElement("svg", { "data-icon": name });
const noop = () => null;
const wrap = ({ children }) => React.createElement("div", {}, children);
for (const language of ["en-US", "zh-CN"]) for (const inherited of [false, true]) test(`actual expanded/pinned/collapsed/group-flyout project markup uses canonical labels and effective tooltip (${language}, inherited=${inherited})`, () => {
  const catalog = load(`../../../shared/i18n/messages/projects.${language}.ts`)[language === "en-US" ? "en" : "zh"];
  const t = (key, args = {}) => Object.entries(args).reduce((value, [name, arg]) => value.replace(`{${name}}`, arg), catalog[key] ?? key);
  const groups = [{ id: "g", bound_path: "/alpha/repo" }];
  const items = [project("a", "C:/wrong/repo", inherited ? { path_mode: "inherit", group_id: "g" } : { environment_type: "ssh", remote_path: "/alpha/repo" }), project("b", "/beta/repo")];
  const actions = { selectedProjectIds: new Set(), selectedWorktreeIds: new Set(), selectedGroupIds: new Set(),
    collapsedIds: new Set(), providerBadges: {}, pinnedProjects: items, getProjectStatus: () => "idle", getTerminals: () => [],
    getProjectTerminalCount: () => 3, isPathInvalid: () => false, isProjectPinned: () => true };
  const useProjectDisplay = load("../hooks/useProjectDisplay.ts", { ...display,
    useMemo: (fn) => fn(), useProjectStore: (selector) => selector({ projects: items, groups }), useI18n: () => ({ t }),
  }).useProjectDisplay;
  const deps = { ...display, useProjectDisplay, useI18n: () => ({ t }), useTreeActions: () => actions,
    useState: (value) => [value, noop], useMemo: (fn) => fn(), useRef: () => ({ current: null }), useEffect: noop,
    memo: (fn) => fn, resolveCliToolIconKey: () => "codex", resolveNodeAppearance: () => ({ emoji: "", iconKey: "" }), NodeAppearanceIcon: noop,
    useSortable: () => ({ attributes: {}, listeners: {} }), CSS: { Transform: { toString: noop } }, DND_SORTABLE_TRANSITION: {},
    useWorktreeDepsRunnerStore: () => false, useWorktreeStore: () => false,
    SidebarProjectTerminals: noop, SidebarTerminalList: noop, ProviderBadgeChip: noop,
    worktreeListCollapseId: (id) => id, preventSecondaryPointerFocus: noop,
    Popover: wrap, PopoverTrigger: wrap, PopoverContent: wrap,
    Link2: noop, Folder: icon("folder"), Pin: noop, ChevronRight: noop, AlertTriangle: noop, Sparkles: noop, Play: noop };
  deps.ProjectIdentityIcon = load("../components/ProjectIdentityIcon.tsx", deps).ProjectIdentityIcon;
  const tree = load("../components/TreeNodeItem.tsx", deps).TreeNodeItem;
  const pinned = load("../components/PinnedProjectSection.tsx", deps, "\nexports.Item = PinnedProjectItem;").Item;
  const shortcuts = load("../components/ProjectTree.tsx", deps, "\nexports.Collapsed = CollapsedProjectButton; exports.Flyout = FlyoutProject;");
  const rows = [tree({ node: { type: "project", project: items[0] }, depth: 0, density: "compact", onFocusNode: noop }),
    pinned({ project: items[0], density: "comfortable" }), shortcuts.Collapsed({ node: { type: "project", project: items[0] }, sizeClass: "" }),
    shortcuts.Flyout({ project: items[0], depth: 0, onPick: noop })];
  for (const row of rows) {
    const markup = renderToStaticMarkup(row);
    assert.match(markup, /repo · alpha/);
    assert.match(markup, /\/alpha\/repo/);
    assert.ok(markup.includes(t("sidebar.terminals.idle")));
    assert.match(markup, /data-icon="folder"/);
    assert.match(markup, />3<\/span>/);
    assert.ok(markup.includes(t("sidebar.display.sessionCount", { count: 3 })));
    assert.doesNotMatch(markup, /C:\/wrong/);
  }
});

test("inherited display follows ancestor binding, group moves, fallback and SSH precedence", () => {
  const groups = [{ id: "root", bound_path: "/one/repo" }, { id: "child", parent_id: "root" }, { id: "other", bound_path: "/two/repo" }];
  const inherited = project("a", "/stale/repo", { path_mode: "inherit", group_id: "child" });
  const peer = project("b", "/peer/repo");
  assert.equal(display.projectDisplayPath(inherited, groups), "/one/repo");
  assert.equal(display.projectDisplayLabels([inherited, peer], groups).get("a"), "repo · one");
  assert.equal(display.projectDisplayPath({ ...inherited, group_id: "other" }, groups), "/two/repo");
  assert.equal(display.projectDisplayPath({ ...inherited, group_id: "missing" }, groups), "/stale/repo");
  assert.equal(display.projectDisplayPath({ ...inherited, environment_type: "ssh", remote_path: "/remote/repo" }, groups), "/remote/repo");
  assert.equal(display.projectDisplayPath({ ...inherited, environment_type: "ssh" }, groups), "/one/repo");
});

test("actual display hook subscribes to group-only updates and invalidates canonical label memo", () => {
  const inherited = project("a", "/stale/repo", { path_mode: "inherit", group_id: "g" });
  const projects = [inherited, project("b", "/peer/repo")];
  let store = { projects, groups: [{ id: "g", bound_path: "/before/repo" }] };
  const selectors = [];
  let memo;
  const hook = load("../hooks/useProjectDisplay.ts", { ...display,
    useProjectStore: (selector) => { selectors.push(selector); return selector(store); },
    useMemo: (fn, deps) => {
      if (!memo || deps.some((dep, i) => dep !== memo.deps[i])) memo = { deps, value: fn() };
      return memo.value;
    }, useI18n: () => ({ t: () => "Idle" }),
  }).useProjectDisplay;
  assert.equal(hook(inherited, null).label, "repo · before");
  const previous = store;
  store = { ...store, groups: [{ id: "g", bound_path: "/after/repo" }] };
  assert.ok(selectors.some((select) => select(previous) !== select(store)), "a subscribed slice changes without replacing projects");
  assert.equal(store.projects, projects);
  assert.deepEqual({ ...hook(inherited, null) }, { label: "repo · after", tooltip: "repo · after\nrepo\n/after/repo\nIdle" });
  assert.equal(hook(projects[1], "idle").label, "repo · peer");
});
