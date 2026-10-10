import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = (code, module = ts.ModuleKind.ES2022) => ts.transpileModule(code, {
  compilerOptions: { module, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const selectorUrl = `data:text/javascript;base64,${Buffer.from(transpile(source("../../../shared/lib/sidebarTerminalOrder.ts"))).toString("base64")}`;
const taskUrl = `data:text/javascript;base64,${Buffer.from(transpile(source("../../terminal/lib/terminalTaskPresentation.ts"))).toString("base64")}`;
const actualDomain = await import(`data:text/javascript;base64,${Buffer.from(transpile(source("../lib/sidebarTerminals.ts")).replace("../../../shared/lib/sidebarTerminalOrder", selectorUrl).replace("../../terminal/state", taskUrl)).toString("base64")}`);
// Older presentation fixtures model explicit Agents and hook-only notifications.
const hookSources = notifications => Object.fromEntries(Object.entries(notifications ?? {}).map(([id, hook]) => [id, { hook }]));
const domain = { ...actualDomain,
  resolveSidebarTerminalState: (session, life, hook, sources) => actualDomain.resolveSidebarTerminalState(session, life, hook, sources ?? { hook }),
  summarizeWorktreeTerminals: (sessions, project, wt, life, hooks, sources) => actualDomain.summarizeWorktreeTerminals(sessions, project, wt, life, hooks, sources ?? hookSources(hooks)),
  summarizeProjectTerminalStates: (sessions, life, hooks, sources) => actualDomain.summarizeProjectTerminalStates(sessions, life, hooks, sources ?? hookSources(hooks)),
};
const glyphs = { running: "▶", wait: "Ⅱ", completed: "✓", failed: "!", remote: "↗", idle: "○" };
const icon = (name) => (props) => React.createElement("svg", { ...props, "data-icon": name });
const icons = { Terminal: icon("Terminal"), EyeOff: icon("EyeOff"), Pin: icon("Pin") };
const summaryTokens = (tree) => descendants(tree).filter((el) => el.props.className === "worktree-terminal-summary-token");
const tokenText = (token) => descendants(token).filter((el) => typeof el.props?.children === "string" || typeof el.props?.children === "number")
  .map((el) => String(el.props.children)).join("");
const session = (id, extra = {}) => ({ id, title: `Terminal ${id}`, projectId: "p1", isAgentSession: true, ...extra });

test("grouping retains hidden and legacy PTYs, isolates worktrees by identity and excludes pseudo sessions", () => {
  const sessions = [session("legacy"), session("hidden", { kind: "pty", tabHidden: true }),
    session("wt", { worktreeId: "w1", tabHidden: true }), session("other", { projectId: "p2" }),
    ...["file-editor", "transcript", "pi", "synced-history"].map((kind) => session(kind, { kind })),
    session("different-path", { cwd: "same-path", worktreeId: "w2" })];
  assert.deepEqual(domain.getSidebarTerminals(sessions, "p1").map((s) => s.id), ["legacy", "hidden"]);
  assert.deepEqual(domain.getSidebarTerminals(sessions, "p1", "w1").map((s) => s.id), ["wt"]);
  assert.deepEqual(domain.getSidebarTerminals(sessions, "p1", "missing"), []);
  assert.deepEqual(domain.getSidebarTerminals(sessions, "p2").map((s) => s.id), ["other"]);
});

test("transient background tasks are excluded from ordinary sidebar terminals", () => {
  const sessions = [session("visible"), session("bg", { tabHidden: true, transientBackground: true }),
    session("bg-wt", { worktreeId: "w1", tabHidden: true, transientBackground: true }),
    session("wt", { worktreeId: "w1", tabHidden: true })];
  assert.deepEqual(domain.getSidebarTerminals(sessions, "p1").map((s) => s.id), ["visible"]);
  assert.deepEqual(domain.getSidebarTerminals(sessions, "p1", "w1").map((s) => s.id), ["wt"]);
});

test("open selects exact project/worktree scope, closes competing workspaces, reopens original ID without creating", () => {
  for (const worktreeId of [undefined, "w1"]) {
    const calls = [];
    const item = session("original", { tabHidden: true, worktreeId });
    domain.openSidebarTerminal(item, {
      selectScope: (scope) => calls.push(["scope", scope]),
      closeGitWorkspace: () => calls.push(["git-close"]),
      closeHistory: () => calls.push(["history-close"]),
      reopenSession: (id) => calls.push(["reopen", id]),
    });
    assert.deepEqual(calls, [["scope", worktreeId
      ? { kind: "worktree", projectId: "p1", worktreeId }
      : { kind: "project", projectId: "p1" }], ["git-close"], ["history-close"], ["reopen", "original"]]);
    assert.equal(item.tabHidden, true); // Domain delegates; it does not replace/mutate the retained identity.
  }
});

test("delete confirms then destructively closes exactly the original hidden ID", async () => {
  let sessions = [session("delete", { tabHidden: true }), session("keep")];
  const calls = [];
  await domain.deleteSidebarTerminal("delete", {
    getSession: (id) => sessions.find((s) => s.id === id),
    confirm: async (s) => { calls.push(["confirm", s.id]); return true; },
    closeSession: async (id) => { calls.push(["close", id]); sessions = sessions.filter((s) => s.id !== id); },
    onLocked: () => assert.fail("not locked"),
  });
  assert.deepEqual(calls, [["confirm", "delete"], ["close", "delete"]]);
  assert.deepEqual(sessions.map((s) => s.id), ["keep"]);
});

test("delete cancellation/missing/pseudo sessions do not close; remote lock is checked before and after confirmation", async () => {
  for (const mode of ["cancel", "missing", "pseudo", "locked", "lock-during-confirm", "removed-during-confirm", "recovery_failed"]) {
    let current = mode === "missing" ? undefined : session("s", mode === "pseudo" ? { kind: "transcript" }
      : mode === "locked" || mode === "recovery_failed" ? { remoteHandoff: { phase: mode === "locked" ? "running" : mode } } : {});
    const calls = [];
    await domain.deleteSidebarTerminal("s", {
      getSession: () => current,
      confirm: async () => {
        calls.push("confirm");
        if (mode === "lock-during-confirm") current = { ...current, remoteHandoff: { phase: "running" } };
        if (mode === "removed-during-confirm") current = undefined;
        return mode !== "cancel";
      },
      closeSession: async () => calls.push("close"), onLocked: () => calls.push("locked"),
    });
    assert.deepEqual(calls, mode === "recovery_failed" ? ["confirm", "close"] : mode === "locked" ? ["locked"]
      : mode === "lock-during-confirm" ? ["confirm", "locked"] : ["cancel", "removed-during-confirm"].includes(mode) ? ["confirm"] : []);
  }
});

const catalogs = {};
for (const [language, name] of [["zh-CN", "zh"], ["en-US", "en"]]) {
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpile(source(`../../../shared/i18n/messages/projects.${language}.ts`))).toString("base64")}`);
  catalogs[language] = module[name];
}
function renderList(language, options = {}) {
  let renameTarget = null;
  const calls = [];
  const items = options.items ?? [session("hidden", { tabHidden: true }), session("locked", { remoteHandoff: { phase: "running" } })];
  const actions = {
    getTerminals: () => items,
    onPinTerminal: (id, pinned) => calls.push(["pin", id, pinned]),
    onMoveTerminal: (id, delta) => calls.push(["move", id, delta]),
    onReorderTerminal: (from, to) => calls.push(["reorder", from, to]),
    getTerminalRenameTarget: (id) => domain.getSidebarTerminalRenameTarget(id, (id) => items.find((s) => s.id === id)),
    onRenameTerminal: (id, title) => calls.push(["rename", id, title]),
    terminalStatuses: options.statuses ?? { hidden: "exited" }, activeTerminalId: options.activeId ?? "hidden",
    onOpenTerminal: (id) => calls.push(["open", id]), onDeleteTerminal: (id) => calls.push(["delete", id]),
  };
  const tag = (name) => ({ children, danger: _danger, onSelect: _onSelect, ...props }) => React.createElement(name, props, children);
  const exports = {};
  const modules = {
    "react/jsx-runtime": awaitJsx,
    react: { useState: () => [renameTarget, (value) => { renameTarget = value; }] },
    "@dnd-kit/core": { DndContext: tag("div"), PointerSensor: {}, closestCenter: () => [], useSensor: () => ({}), useSensors: () => [] },
    "@dnd-kit/sortable": { SortableContext: tag("div"), verticalListSortingStrategy: {}, useSortable: () => ({
      attributes: { role: "button", tabIndex: 0, "aria-describedby": "terminal-drag" },
      listeners: { onPointerDown: () => calls.push(["pointer"]) },
      setNodeRef: (node) => calls.push(["node", node]), setActivatorNodeRef: (node) => calls.push(["activator", node]),
      isDragging: options.dragging ?? false,
    }) },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: () => undefined } } },
    "./SidebarTerminalSortable": {},
    "../../workspace/api/dragInteraction": { DND_ACTIVATION_CONSTRAINT: { distance: 3 } },
    "../lib/sidebarOrdering": { terminalDropAllowed: (items, a, b) => !!items.find((s) => s.id === a) && !!items.find((s) => s.id === b) },
    "./SidebarTerminalRenameDialog": { SidebarTerminalRenameDialog: () => null },
    "./TreeContext": { useTreeActions: () => actions },
    "../../../shared/i18n/index": { useI18n: () => ({ t: (key, args) => {
      let value = catalogs[language][key]; assert.ok(value, `missing ${key}`);
      for (const [key, arg] of Object.entries(args ?? {})) value = value.replace(`{${key}}`, arg);
      return value;
    } }) },
    "../../../shared/ui/icons": icons,
    "../../terminal/state": { useTerminalStore: (selector) => selector({ tabNotifications: options.notifications ?? {}, tabStatuses: hookSources(options.notifications) }) },
    "../../../shared/ui/context-menu": {
      ContextMenu: tag("div"), ContextMenuTrigger: ({ children }) => children,
      ContextMenuContent: tag("div"), ContextMenuItem: tag("div"),
    },
    "../lib/sidebarTerminals": domain,
  };
  vm.runInNewContext(transpile(source("../components/SidebarTerminalSortable.tsx"), ts.ModuleKind.CommonJS), {
    exports: modules["./SidebarTerminalSortable"], require: (id) => { assert.ok(modules[id], id); return modules[id]; },
  });
  vm.runInNewContext(transpile(source("../components/SidebarTerminalList.tsx"), ts.ModuleKind.CommonJS), {
    exports, require: (id) => { assert.ok(modules[id], id); return modules[id]; },
    MouseEvent: class { constructor(type, props) { this.type = type; Object.assign(this, props); } },
  });
  const render = () => exports.SidebarTerminalList({ projectId: "p1", compact: options.compact ?? true, depth: options.depth ?? 0 });
  const expandSortable = (el) => {
    if (!React.isValidElement(el)) return el;
    if (el.type === modules["./SidebarTerminalSortable"].SidebarTerminalSortable) return expandSortable(el.type(el.props));
    const children = el.props.children;
    return React.cloneElement(el, {}, Array.isArray(children) ? children.map(expandSortable) : expandSortable(children));
  };
  return { tree: expandSortable(render()), calls, render: () => expandSortable(render()), items, getTarget: () => renameTarget };
}
const awaitJsx = await import("react/jsx-runtime");
function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(descendants)];
}

test("actual list component renders bilingual title/state/hidden labels and wires click/Delete/context-menu without parent selection", () => {
  for (const language of ["zh-CN", "en-US"]) {
    const { tree, calls } = renderList(language);
    const elements = descendants(tree);
    const buttons = elements.filter((el) => el.type === "button");
    assert.equal(buttons.length, 2);
    const markup = renderToStaticMarkup(tree);
    assert.ok(markup.includes(catalogs[language]["sidebar.terminals.hidden"]));
    assert.ok(markup.includes(catalogs[language]["sidebar.terminals.completed"]));
    assert.ok(markup.includes(catalogs[language]["sidebar.terminals.remote"]));
    let stopped = 0;
    buttons[0].props.onClick({ stopPropagation: () => stopped++ });
    buttons[0].props.onKeyDown({ key: "Delete", preventDefault() {} });
    const menuDelete = elements.find((el) => el.props.danger && !el.props.disabled);
    menuDelete.props.onSelect();
    assert.ok(elements.some((el) => el.props.danger && el.props.disabled));
    assert.deepEqual(calls, [["open", "hidden"], ["delete", "hidden"], ["delete", "hidden"]]);
    assert.equal(stopped, 1);
    let dispatched;
    buttons[0].props.onKeyDown({ key: "F10", shiftKey: true, preventDefault() {}, stopPropagation() {},
      currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 30 }), dispatchEvent: (event) => { dispatched = event; } } });
    assert.equal(dispatched.type, "contextmenu");
    assert.equal(dispatched.bubbles, true);
    assert.equal(dispatched.clientY, 30);
  }
});

test("actual sidebar rows use shared status glyphs, complete bilingual labels and unchanged callbacks at both densities", () => {
  for (const language of ["en-US", "zh-CN"]) for (const compact of [false, true]) {
    const title = "A very long terminal title / 工作目录 / repeated name";
    const items = [session("running", { title }), session("wait"), session("completed"), session("failed"),
      session("remote", { remoteHandoff: { phase: "active" } }), session("exited"), session("error"),
      session("hidden", { tabHidden: true, title }), session("recovered", { remoteHandoff: { phase: "recovery_failed" } })];
    const h = renderList(language, { compact, depth: 2, items, activeId: "running",
      notifications: { running: "running", wait: "attention", completed: "done", failed: "failed", exited: "attention", error: "done" },
      statuses: { exited: "exited", error: "error" } });
    const elements = descendants(h.tree);
    const group = elements.find((el) => el.props["data-sidebar-terminals"] !== undefined);
    assert.equal(group.props.className, "sidebar-terminal-list");
    assert.equal(group.props["data-density"], compact ? "compact" : "comfortable");
    assert.equal(group.props.style.marginInlineStart, 4 + 2 * (compact ? 14 : 16) + (compact ? 18 : 20));
    const rows = elements.filter((el) => el.type === "button");
    const expected = ["running", "wait", "completed", "failed", "remote", "completed", "failed", "idle", "idle"];
    rows.forEach((row, index) => {
      const status = expected[index];
      assert.equal(row.props.className, "sidebar-terminal-row");
      assert.equal(row.props["data-status"], status);
      assert.equal(row.props["data-selected"], index === 0 ? "true" : "false");
      assert.equal(row.props["data-hidden"], index === 7 ? "true" : "false");
      const label = [items[index].title, catalogs[language][`sidebar.terminals.${status}`],
        index === 7 ? catalogs[language]["sidebar.terminals.hidden"] : ""].filter(Boolean).join(" · ");
      assert.equal(row.props.title, label);
      assert.ok(row.props["aria-label"].endsWith(label));
      const children = descendants(row);
      const state = children.find((el) => el.props.className === "sidebar-terminal-status");
      assert.equal(state.props.children, glyphs[status]);
      assert.equal(state.props.title, catalogs[language][`sidebar.terminals.${status}`]);
      const heading = children.find((el) => el.props.className === "sidebar-terminal-heading");
      const metadata = descendants(heading).find((el) => el.props.className === "sidebar-terminal-metadata");
      assert.equal(metadata.props["aria-hidden"], "true");
      assert.ok(descendants(metadata).some((el) => el.props.className === "sidebar-terminal-status"));
      assert.ok(descendants(heading).some((el) => el.props.className === "sidebar-terminal-title-line"));
      assert.equal(children.find((el) => el.props.className === "sidebar-terminal-title").props.children, items[index].title);
      const hidden = children.find((el) => el.props.className === "sidebar-terminal-hidden");
      assert.equal(Boolean(hidden), index === 7);
      if (hidden) {
        assert.equal(hidden.props.title, catalogs[language]["sidebar.terminals.hidden"]);
        assert.equal(hidden.props.children.type, icons.EyeOff);
        assert.equal(hidden.props.children.props["aria-hidden"], "true");
        assert.equal(hidden.props.children.props.size, 12);
        assert.equal(tokenText(hidden), "");
      }
      row.props.onClick({ stopPropagation() {} });
    });
    assert.deepEqual(h.calls, items.map((item) => ["open", item.id]));
    const menu = elements.filter((el) => el.props.children === catalogs[language]["sidebar.terminals.rename"]);
    assert.equal(menu.length, items.length);
    assert.equal(catalogs[language]["sidebar.terminals.rename"], language === "en-US" ? "Rename" : "重命名");
    const reopen = elements.find((el) => el.props.children === catalogs[language]["sidebar.terminals.reopen"]);
    reopen.props.onSelect();
    assert.deepEqual(h.calls.at(-1), ["open", "running"]);
  }
  const hiddenActive = descendants(renderList("en-US").tree).find((el) => el.type === "button");
  assert.equal(hiddenActive.props["data-selected"], "false");
  assert.equal(renderList("en-US", { items: [] }).tree, null);
});

test("sidebar domain CSS keeps ordered imports, narrow title flex, static status and local explicit focus", () => {
  const css = source("../styles/sidebar-terminals.css");
  const entry = source("../../../styles/components.css");
  assert.ok(entry.indexOf("project-tree.css") < entry.indexOf("sidebar-terminals.css"));
  assert.ok(entry.indexOf("sidebar-terminals.css") < entry.indexOf("focus-controls.css"));
  assert.match(css, /\.sidebar-terminal-title\s*\{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  assert.match(css, /\.sidebar-terminal-list\[data-density="compact"\]/);
  assert.match(css, /\.sidebar-terminal-row:focus-visible\s*\{[^}]*outline: 2px solid[^}]*outline-offset: -2px/);
  assert.match(css, /border-inline-start: 1px solid/);
  assert.match(css, /\.sidebar-terminal-list\s*\{[^}]*margin-block: 2px 8px;[^}]*padding: 1px 0 2px 7px;/);
  assert.match(css, /\.sidebar-terminal-row::before\s*\{[^}]*inset-inline-start: -8px;[^}]*width: 7px;/);
  assert.match(css, /\.sidebar-terminal-heading\s*\{[^}]*flex-direction: column;[^}]*min-width: 0;/);
  assert.match(css, /\.sidebar-terminal-metadata\s*\{[^}]*overflow: hidden;[^}]*white-space: nowrap;/);
  assert.match(css, /\.sidebar-terminal-title-line\s*\{[^}]*font-weight: 400;/);
  assert.match(source("../components/SidebarTerminalList.tsx"), /EyeOff/);
  assert.match(source("../components/SidebarTerminalList.tsx"), /sidebarTerminalGlyphs\[status\]/);
  assert.match(css, /flex: 0 0 12px;/);
  assert.match(css, /\.worktree-terminal-summary-token\s*\{[^}]*flex: 0 0 auto;[^}]*gap: 3px;[^}]*white-space: nowrap;/);
  assert.match(css, /box-shadow: inset 2px 0 0 var\(--primary\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|gradient|animation|transition/i);
});

test("sidebar text/status/focus contrast on opaque theme token surfaces across declared palettes", () => {
  const themes = source("../../../styles/themes.css");
  const css = source("../styles/sidebar-terminals.css");
  const rgb = (hex) => hex.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16));
  const mix = (a, b, weight) => a.map((value, index) => value * weight + b[index] * (1 - weight));
  const luminance = (color) => color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  assert.match(css, /color: color-mix\(in srgb, var\(--on-surface\) 75%, var\(--warning\)\)/);
  assert.match(css, /outline: 2px solid color-mix\(in srgb, var\(--on-surface\) 65%, var\(--primary\)\)/);
  let palettes = 0;
  for (const block of themes.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const values = Object.fromEntries([...block[2].matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/gi)]
      .map((match) => [match[1], rgb(match[2])]));
    if (!values["text-primary"] || !values["bg-secondary"]) continue;
    palettes++;
    const foreground = values["text-primary"];
    for (const key of ["bg-primary", "bg-secondary", "bg-tertiary"]) {
      const base = values[key];
      for (const background of [base, mix(foreground, base, 0.05), mix(values.accent, base, 0.10), mix(values.accent, base, 0.14)]) {
        assert.ok(contrast(foreground, background) >= 4.5, `title: ${block[1]}`);
        for (const token of ["accent", "success", "warning", "danger"]) {
          assert.ok(contrast(mix(foreground, values[token], 0.75), background) >= 4.5, `${token}: ${block[1]}`);
        }
        assert.ok(contrast(mix(foreground, values.accent, 0.65), background) >= 3, `focus: ${block[1]}`);
      }
    }
  }
  assert.equal(palettes, 22); // Token calculation, not a claim about live translucent/backdrop compositing.
});

test("list keyboard arrows navigate terminal buttons locally, without bubbling into project actions", () => {
  const { tree } = renderList("en-US");
  const calls = [];
  const rows = [0, 1].map((index) => ({ focus: () => calls.push(index) }));
  for (const [key, target] of [["ArrowDown", rows[0]], ["Home", rows[1]], ["End", rows[0]]]) {
    descendants(tree).find((el) => el.props["data-sidebar-terminals"] !== undefined).props.onKeyDown({ key, target, stopPropagation() {}, preventDefault() {}, currentTarget: { querySelectorAll: () => rows } });
  }
  assert.deepEqual(calls, [1, 0, 1]);
});

test("expanded, compact, collapsed and pinned callsites expose retained lists and real store lifecycle actions", () => {
  const nodes = source("../components/TreeNodeItem.tsx");
  const projectTree = source("../components/ProjectTree.tsx");
  const pinned = source("../components/PinnedProjectSection.tsx");
  const hook = source("../hooks/useSidebarTerminals.ts");
  assert.match(nodes, /SidebarTerminalList projectId=\{project.id\} worktreeId=\{worktree.id\}/);
  assert.match(nodes, /SidebarTerminalList projectId=\{p.id\} depth=\{depth \+ 1\} compact=\{compact\}/);
  assert.match(projectTree, /SidebarProjectTerminals projectId=\{p.id\} compact/);
  assert.match(projectTree, /SidebarTerminalList projectId=\{child.project.id\} worktreeId=\{child.worktree.id\}/);
  assert.match(pinned, /SidebarProjectTerminals projectId=\{project.id\}/);
  assert.match(hook, /reopenSession: store.reopenSession/);
  assert.match(hook, /closeSession: \(sessionId\) => useTerminalStore.getState\(\).closeSession\(sessionId\)/);
  assert.doesNotMatch(hook, /createSession|hideSession/);
});

function collapseHarness(language = "en-US") {
  let sessions = [session("main"), session("hidden", { worktreeId: "w1", tabHidden: true }),
    session("second", { worktreeId: "w2" }), session("pseudo", { worktreeId: "empty", kind: "pi" })];
  const worktrees = ["w1", "w2", "empty"].map((id) => ({ id, project_id: "p1", name: id, branch: id, path: id }));
  const calls = [];
  const actions = {
    collapsedIds: new Set(), selectedWorktreeIds: new Set(), selectedProjectIds: new Set(),
    providerBadges: {}, getTerminals: (p, w) => domain.getSidebarTerminals(sessions, p, w),
    toggleCollapsed: (key) => {
      calls.push(["toggle", key]);
      if (actions.collapsedIds.has(key)) actions.collapsedIds.delete(key); else actions.collapsedIds.add(key);
    },
    onSelectWorktree: () => calls.push(["select"]), onOpenWorktree: () => calls.push(["open"]),
    onContextMenuWorktree: () => calls.push(["menu"]),
  };
  const noop = () => null;
  const context = load("TreeContext", { react: React });
  const modules = {
    "react/jsx-runtime": awaitJsx,
    react: { ...React, memo: (fn) => fn },
    "./TreeContext": { ...context, useTreeActions: () => actions },
    "../lib/sidebarTerminals": domain,
    "../../terminal/state": { useTerminalStore: (selector) => selector({ sessions, sessionStatuses: {}, tabNotifications: {} }) },
    "../../../shared/i18n/index": { useI18n: () => ({ t: (key) => {
      assert.ok(catalogs[language][key], `missing ${key}`); return catalogs[language][key];
    } }) },
    "../../../shared/ui/icons": Object.fromEntries(["ChevronRight", "AlertTriangle", "Link2", "Pin", "Play", "Sparkles", "Terminal"].map((key) => [key, noop])),
    "../lib/sidebarOrdering": { worktreeMoveIds: () => null },
    "../../../shared/preferences/settingsStore": { useSettingsStore: (selector) => selector({ worktreeOrderByProject: {} }) },
    "../api/worktreeOrder": { orderProjectWorktrees: (items, id) => items.filter((w) => w.project_id === id).sort((a,b) => a.name.localeCompare(b.name)) },
    "../api/projectStore": { useProjectStore: (selector) => selector({ worktrees }) },
    "../api/worktreeMetadata": { getWorktreeDisplayName: (w) => w.name },
    "./SidebarTerminalList": { SidebarTerminalList: (props) => React.createElement("ul", { "data-scope": props.worktreeId ?? "main" }) },
    "@dnd-kit/core": { useDroppable: () => ({}) },
    "@dnd-kit/sortable": { useSortable: () => ({ attributes: {}, setNodeRef: noop }), SortableContext: noop },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: noop } } },
    "../../../shared/ui/VendorIcon": { VendorIcon: noop, inferVendor: noop },
    "../../../shared/ui/WorktreeIcon": { WorktreeIcon: noop },
    "../../workspace/api/dragInteraction": {},
    "../api/NodeAppearanceIcon": {}, "./NewGroupRow": {}, "../api/nodeAppearance": {},
    "../../../shared/lib/cliTools": {},
  };
  function load(name, deps = modules) {
    const exports = {};
    vm.runInNewContext(transpile(source(`../components/${name}.tsx`), ts.ModuleKind.CommonJS), {
      exports, require: (id) => { assert.ok(deps[id], id); return deps[id]; },
    });
    return exports;
  }
  for (const name of ["WorktreeTerminalSummary", "WorktreeTerminalsToggle", "SidebarWorktreeTerminals", "SidebarProjectTerminals"]) {
    modules[`./${name}`] = load(name);
  }
  const node = load("TreeNodeItem").TreeNodeItem;
  const expand = (el) => {
    if (!el || typeof el !== "object") return el;
    if (typeof el.type === "function") return expand(el.type(el.props));
    return React.cloneElement(el, {}, React.Children.toArray(el.props.children).map((child, index) => {
      const expanded = expand(child);
      return React.isValidElement(expanded) ? React.cloneElement(expanded, { key: child.key ?? index }) : expanded;
    }));
  };
  const row = (id, density = "comfortable", forceExpanded = false) => expand(node({
    node: { type: "worktree", project: { id: "p1" }, worktree: worktrees.find((w) => w.id === id) },
    depth: 1, density, onFocusNode: () => calls.push(["focus"]), forceExpanded,
  }));
  const shortcuts = (compact = false) => expand(modules["./SidebarProjectTerminals"].SidebarProjectTerminals({ projectId: "p1", compact }));
  // Execute the real leaf renderer without mounting the popover/browser shell.
  const flyoutSource = source("../components/ProjectTree.tsx");
  const flyoutExports = {};
  vm.runInNewContext(transpile(flyoutSource.slice(flyoutSource.indexOf("function renderFlyoutNodes("),
    flyoutSource.indexOf("function findNodeById(")) + "\nexports.render = renderFlyoutNodes;", ts.ModuleKind.CommonJS), {
    exports: flyoutExports, require: (id) => modules[id],
    WorktreeIcon: noop, getWorktreeDisplayName: (w) => w.name,
    WorktreeTerminalsToggle: modules["./WorktreeTerminalsToggle"].WorktreeTerminalsToggle,
    WorktreeTerminalSummary: modules["./WorktreeTerminalSummary"].WorktreeTerminalSummary,
    SidebarTerminalList: modules["./SidebarTerminalList"].SidebarTerminalList,
    worktreeTerminalsCollapseId: context.worktreeTerminalsCollapseId,
  });
  const flyout = (id) => expand(React.createElement("div", {}, flyoutExports.render([
    { type: "worktree", project: { id: "p1" }, worktree: worktrees.find((w) => w.id === id) },
  ], 0, actions, noop)));
  return { actions, calls, context, row, shortcuts, flyout, setSessions: (value) => { sessions = value; } };
}
const toggleButtons = (tree) => descendants(tree).filter((el) => el.type === "button" && typeof el.props["aria-expanded"] === "boolean");
const lists = (tree) => descendants(tree).filter((el) => el.type === "ul").map((el) => el.props["data-scope"]);

test("actual worktree rows and pinned/narrow shortcuts share independent namespaced folds, including hidden PTYs", () => {
  for (const language of ["zh-CN", "en-US"]) {
    const h = collapseHarness(language);
    const key = h.context.worktreeTerminalsCollapseId("w1");
    assert.equal(key, "worktree-terminals:w1");
    assert.notEqual(key, h.context.worktreeListCollapseId("w1"));
    h.actions.collapsedIds.add(h.context.worktreeListCollapseId("p1"));
    for (const density of ["comfortable", "compact"]) {
      assert.equal(toggleButtons(h.row("w1", density)).length, 1);
      assert.equal(toggleButtons(h.row("empty", density)).length, 0);
      assert.deepEqual(lists(h.row("w1", density)), ["w1"]);
    }
    for (const compact of [false, true]) {
      assert.equal(toggleButtons(h.shortcuts(compact)).length, 2);
      assert.deepEqual(lists(h.shortcuts(compact)), ["main", "w1", "w2"]);
      assert.ok(!renderToStaticMarkup(h.shortcuts(compact)).includes("empty"));
    }
    const button = toggleButtons(h.row("w1"))[0];
    assert.equal(button.props.title, catalogs[language]["sidebar.terminals.collapseWorktree"]);
    assert.equal(button.props["aria-label"], button.props.title);
    assert.ok(!button.props.className.includes("hidden"));
    button.props.onClick({ stopPropagation() {} });
    assert.deepEqual(h.calls, [["toggle", key]]);
    assert.deepEqual(lists(h.row("w1", "compact", true)), []); // Search force expansion must not override it.
    assert.deepEqual(lists(h.row("w2")), ["w2"]);
    for (const compact of [false, true]) {
      const tree = h.shortcuts(compact);
      assert.deepEqual(lists(tree), ["main", "w2"]);
      assert.ok(renderToStaticMarkup(tree).includes("w1")); // Folded label is still reachable.
      const folded = toggleButtons(tree)[0];
      assert.equal(folded.props["aria-expanded"], false);
      assert.equal(folded.props.title, catalogs[language]["sidebar.terminals.expandWorktree"]);
    }
    toggleButtons(h.shortcuts())[0].props.onClick({ stopPropagation() {} });
    assert.deepEqual(lists(h.row("w1")), ["w1"]);
    assert.ok(h.actions.collapsedIds.has(h.context.worktreeListCollapseId("p1")));
    h.setSessions([session("main")]);
    assert.equal(toggleButtons(h.row("w1")).length, 0);
    assert.equal(toggleButtons(h.shortcuts()).length, 0);
    assert.deepEqual(lists(h.shortcuts()), ["main"]);
    h.setSessions([session("added", { kind: "pty", worktreeId: "w1" })]);
    assert.equal(toggleButtons(h.row("w1")).length, 1);
  }
});

test("actual toggle event guards isolate selection/open/context/drag/focus and preserve single native Enter/Space activation", () => {
  const h = collapseHarness();
  for (const tree of [h.row("w1"), h.shortcuts(true)]) {
    const button = toggleButtons(tree)[0];
    for (const name of ["onDoubleClick", "onPointerDown", "onMouseDown", "onFocus", "onContextMenu", "onKeyDown", "onKeyUp"]) {
      let stopped = false, prevented = false;
      button.props[name]({ stopPropagation: () => { stopped = true; }, preventDefault: () => { prevented = true; } });
      assert.equal(stopped, true, name);
      assert.equal(prevented, name === "onContextMenu", name);
    }
    for (const key of ["Enter", " ", "ArrowDown", "Delete", "F10", "a"]) {
      const before = h.calls.length;
      let prevented = false;
      const event = { key, stopPropagation() {}, preventDefault: () => { prevented = true; } };
      button.props.onKeyDown(event);
      button.props.onKeyUp(event);
      assert.equal(h.calls.length, before); // No custom key toggle, native click is the single activation.
      assert.equal(prevented, false);
      if (["Enter", " "].includes(key)) {
        button.props.onClick(event); // Model browser's native activation click.
        assert.equal(h.calls.length, before + 1);
      }
    }
  }
  assert.ok(h.calls.every(([kind, key]) => kind === "toggle" && key === "worktree-terminals:w1"));
});

test("rename actions snapshot current title, recheck exact PTY identity and preserve hidden/active/handoff metadata", () => {
  for (const extra of [{}, { tabHidden: true, worktreeId: "w1" }, { tabHidden: true, remoteHandoff: { phase: "running" } }]) {
    let items = [session("exact", extra), session("other", { title: "Repeated" })];
    const before = structuredClone(items);
    const active = "other";
    const calls = [];
    const actions = {
      getSession: (id) => items.find((s) => s.id === id),
      renameSession: (id, title) => { calls.push([id, title]); items = items.map((s) => s.id === id ? { ...s, title } : s); },
    };
    assert.deepEqual(domain.getSidebarTerminalRenameTarget("exact", actions.getSession), { id: "exact", title: "Terminal exact" });
    domain.renameSidebarTerminal("exact", "  Repeated  ", actions);
    domain.renameSidebarTerminal("exact", "Repeated", actions); // Unchanged title delegates existing semantics.
    assert.deepEqual(calls, [["exact", "Repeated"], ["exact", "Repeated"]]);
    assert.deepEqual(items, before.map((s) => s.id === "exact" ? { ...s, title: "Repeated" } : s));
    assert.equal(active, "other");
    domain.renameSidebarTerminal("exact", "  ", actions);
    items = items.filter((s) => s.id !== "exact");
    domain.renameSidebarTerminal("exact", "deleted", actions);
    items.push(session("exact", { kind: "transcript" }));
    domain.renameSidebarTerminal("exact", "pseudo", actions);
    assert.equal(domain.getSidebarTerminalRenameTarget("exact", actions.getSession), null);
    assert.equal(domain.getSidebarTerminalRenameTarget("missing", actions.getSession), null);
    assert.equal(calls.length, 2);
  }
});

test("actual menu requests current title rather than rendered stale title; remote rename stays enabled", () => {
  for (const language of ["en-US", "zh-CN"]) {
    const h = renderList(language);
    const renameItems = descendants(h.tree).filter((el) => el.props.children === catalogs[language]["sidebar.terminals.rename"]);
    assert.equal(renameItems.length, 2);
    h.items[0].title = "Latest title";
    renameItems[0].props.onSelect();
    assert.deepEqual(h.getTarget(), { id: "hidden", title: "Latest title" });
    const dialog = descendants(h.render()).find((el) => el.props.target);
    assert.equal(dialog.props.target.title, "Latest title");
    dialog.props.onClose();
    assert.equal(h.getTarget(), null);
    assert.deepEqual(h.calls, []);
    assert.ok(!renameItems[1].props.disabled);
    renameItems[1].props.onSelect();
    assert.equal(h.getTarget().id, "locked");
    h.items.splice(1, 1);
    renameItems[1].props.onSelect();
    assert.equal(h.getTarget(), null);
  }
});

function dialogHarness(language) {
  let title;
  const composing = { current: false };
  const calls = [];
  const modules = {
    "react/jsx-runtime": awaitJsx,
    react: { useState: (initial) => { title ??= initial; return [title, (value) => { title = value; }]; }, useRef: () => composing },
    "../../../shared/i18n/index": { useI18n: () => ({ t: (key) => { assert.ok(catalogs[language][key]); return catalogs[language][key]; } }) },
    "../../../shared/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogTitle"].map((key) => [key, key])),
    "../../../shared/ui/button": { Button: "Button" }, "../../../shared/ui/input": { Input: "Input" },
  };
  const exports = {};
  vm.runInNewContext(transpile(source("../components/SidebarTerminalRenameDialog.tsx"), ts.ModuleKind.CommonJS), {
    exports, require: (id) => { assert.ok(modules[id], id); return modules[id]; },
  });
  const render = () => exports.SidebarTerminalRenameDialog({ target: { id: "exact", title: "Current title" },
    onConfirm: (id, value) => calls.push(["rename", id, value]), onClose: () => calls.push(["close"]) });
  const input = () => descendants(render()).find((el) => el.type === "Input");
  const change = (value) => input().props.onChange({ target: { value } });
  const enter = (extra = {}) => input().props.onKeyDown({ key: "Enter", preventDefault() {}, nativeEvent: extra });
  return { render, input, change, enter, calls };
}

test("actual input dialog prefills, trims and confirms exact ID; blank/cancel/Escape/IME do not rename", () => {
  for (const language of ["en-US", "zh-CN"]) {
    const h = dialogHarness(language);
    assert.equal(h.input().props.value, "Current title");
    assert.equal(h.input().props["aria-label"], catalogs[language]["sidebar.terminals.renameInput"]);
    assert.equal(descendants(h.render()).find((el) => el.type === "DialogContent").props.showCloseButton, false);
    h.change("   "); h.enter();
    assert.ok(descendants(h.render()).find((el) => el.props.variant === "default").props.disabled);
    assert.deepEqual(h.calls, []);
    h.change("  Repeated  ");
    h.enter({ isComposing: true }); h.enter({ keyCode: 229 });
    h.input().props.onCompositionStart(); h.enter();
    assert.deepEqual(h.calls, []);
    h.input().props.onCompositionEnd(); h.enter();
    assert.deepEqual(h.calls, [["rename", "exact", "Repeated"], ["close"]]);
    const cancel = dialogHarness(language);
    descendants(cancel.render()).find((el) => el.props.children === catalogs[language]["sidebar.terminals.renameCancel"]).props.onClick();
    assert.deepEqual(cancel.calls, [["close"]]);
    const escape = dialogHarness(language);
    escape.render().props.onOpenChange(false); // Radix's Escape/dismiss contract.
    assert.deepEqual(escape.calls, [["close"]]);
    let stopped = false;
    descendants(escape.render()).find((el) => el.type === "DialogContent").props.onKeyDown({ stopPropagation() { stopped = true; } });
    assert.ok(stopped);
  }
});

test("actual hook delegates only renameSession against live store, not activation/reopen/lifecycle", () => {
  let items = [session("target", { tabHidden: true, remoteHandoff: { phase: "running" } }), session("keep")];
  const calls = [];
  const store = { sessions: items, sessionStatuses: {}, activeSessionId: "keep", renameSession: (id, title) => calls.push([id, title]) };
  const modules = {
    react: { useCallback: (fn) => fn }, sonner: { toast: {} },
    "../../terminal/state": { useTerminalStore: Object.assign((selector) => selector(store), { getState: () => store }) },
    "../../history/index": {}, "../../git/api/gitWorkspaceStore": {},
    "../../../shared/i18n/index": { useI18n: () => ({ t: (key) => key }) },
    "../lib/sidebarTerminals": domain,
  };
  const exports = {};
  vm.runInNewContext(transpile(source("../hooks/useSidebarTerminals.ts"), ts.ModuleKind.CommonJS), {
    exports, require: (id) => { assert.ok(modules[id], id); return modules[id]; },
  });
  const hook = exports.useSidebarTerminals(() => assert.fail("scope change"), () => assert.fail("delete confirmation"));
  items[0].title = "Fresh";
  assert.deepEqual(JSON.parse(JSON.stringify(hook.getTerminalRenameTarget("target"))), { id: "target", title: "Fresh" });
  hook.onRenameTerminal("target", "  New  ");
  assert.deepEqual(calls, [["target", "New"]]);
  assert.equal(store.activeSessionId, "keep"); assert.equal(items[0].tabHidden, true);
  store.sessions = [items[1]];
  hook.onRenameTerminal("target", "Gone");
  assert.equal(calls.length, 1);
});

test("shared resolver exhaustively preserves remote > lifecycle > notification > idle priority", () => {
  for (const phase of [undefined, "running", "recovery_failed"])
    for (const lifecycle of [undefined, "running", "error", "exited"])
      for (const notification of [undefined, "none", "running", "attention", "done", "failed"]) {
        const item = session("s", phase ? { remoteHandoff: { phase } } : {});
        const expected = phase === "running" ? "remote" : lifecycle === "error" ? "failed"
          : lifecycle === "exited" ? "completed" : notification === "attention" ? "wait"
          : notification === "done" ? "completed" : notification === "failed" ? "failed"
          : notification === "running" ? "running" : "idle";
        assert.equal(domain.resolveSidebarTerminalState(item, lifecycle, notification), expected);
      }
});

function summaryHarness(language) {
  const store = { sessions: [], sessionStatuses: {}, tabNotifications: {} };
  const selected = [];
  const modules = {
    "react/jsx-runtime": awaitJsx,
    "../lib/sidebarTerminals": domain,
    "../../../shared/ui/icons": icons,
    "../../terminal/state": { useTerminalStore: (selector) => { selected.push(selector(store)); return selector(store); } },
    "../../../shared/i18n/index": { useI18n: () => ({ t: (key, args) => {
      let value = catalogs[language][key]; assert.ok(value, key);
      for (const [key, arg] of Object.entries(args ?? {})) value = value.replace(`{${key}}`, arg);
      return value;
    } }) },
  };
  const exports = {};
  vm.runInNewContext(transpile(source("../components/WorktreeTerminalSummary.tsx"), ts.ModuleKind.CommonJS), {
    exports, require: (id) => { assert.ok(modules[id], id); return modules[id]; },
  });
  return { store, selected, render: (worktreeId = "w1", compact = false) =>
    exports.WorktreeTerminalSummary({ projectId: "p1", worktreeId, compact }) };
}

test("summary counts hidden/legacy PTYs once, excludes pseudo/main/other WT, updates read-only inputs, zero is null", () => {
  for (const language of ["zh-CN", "en-US"]) for (const compact of [false, true]) {
    const h = summaryHarness(language);
    assert.equal(h.render(), null);
    h.store.sessions = [session("running", { worktreeId: "w1" }), session("idle", { worktreeId: "w1", tabHidden: true }),
      session("wait", { worktreeId: "w1", tabHidden: true, kind: "pty" }),
      session("done", { worktreeId: "w1" }), session("failed", { worktreeId: "w1" }),
      session("remote", { worktreeId: "w1", remoteHandoff: { phase: "running" } }),
      session("other", { worktreeId: "w2", cwd: "same" }), session("main"),
      ...["pi", "file-editor", "transcript", "synced-history"].map((kind) => session(kind, { kind, worktreeId: "w1" }))];
    h.store.sessionStatuses = { failed: "error", remote: "error" };
    h.store.tabNotifications = { running: "running", wait: "attention", done: "done", failed: "done", remote: "attention" };
    const before = structuredClone(h.store);
    const result = domain.summarizeWorktreeTerminals(h.store.sessions, "p1", "w1", h.store.sessionStatuses, h.store.tabNotifications);
    assert.equal(result.total, 6);
    assert.equal(result.total, Object.values(result.counts).reduce((a, b) => a + b));
    assert.deepEqual(result.counts, { running: 1, wait: 1, completed: 1, failed: 1, remote: 1, idle: 1 });
    const tree = h.render("w1", compact);
    assert.equal(tree.props["data-density"], compact ? "compact" : "comfortable");
    assert.equal(tree.props.title, tree.props["aria-label"]);
    assert.equal(tree.props["aria-label"], [catalogs[language]["sidebar.terminals.summaryTotal"].replace("{count}", "6"),
      ...domain.sidebarTerminalStates.map((state) => `${catalogs[language][`sidebar.terminals.${state}`]}: 1`),
      catalogs[language]["sidebar.terminals.summaryHiddenIncluded"]].join(" · "));
    assert.equal((renderToStaticMarkup(tree).match(/data-icon="Terminal"/g) ?? []).length, 1);
    assert.equal(tree.props.role, "img");
    assert.ok(tree.props.title.includes(catalogs[language]["sidebar.terminals.summaryTotal"].replace("{count}", "6")));
    assert.ok(tree.props.title.includes(catalogs[language]["sidebar.terminals.summaryHiddenIncluded"]));
    for (const state of domain.sidebarTerminalStates) assert.ok(tree.props.title.includes(`${catalogs[language][`sidebar.terminals.${state}`]}: 1`));
    const tokens = summaryTokens(tree);
    assert.equal(tokens.length, 7);
    assert.equal(tokenText(tokens[0]), "6");
    assert.equal(tokens[0].props.title, catalogs[language]["sidebar.terminals.summaryTotal"].replace("{count}", "6"));
    assert.equal(tokens[0].props.children[0].type, icons.Terminal);
    assert.equal(tokens[0].props.children[0].props["aria-hidden"], "true");
    domain.sidebarTerminalStates.forEach((state, index) => {
      assert.equal(tokenText(tokens[index + 1]), `${glyphs[state]}1`);
      assert.equal(tokens[index + 1].props.title, catalogs[language][`sidebar.terminals.summary.${state}`].replace("{count}", "1"));
    });
    assert.equal(descendants(tree).find((el) => el.props.className === "worktree-terminal-summary-text").props["aria-hidden"], "true");
    assert.ok(!tokens.map(tokenText).join("").includes("Σ"));
    assert.ok(descendants(tree).every((el) => el.type !== "button" && !el.props.onClick));
    assert.deepEqual(h.store, before);
    assert.ok(h.selected.includes(h.store.sessions) && h.selected.includes(h.store.sessionStatuses) && h.selected.includes(h.store.tabNotifications));
    const other = h.render("w2");
    assert.deepEqual(summaryTokens(other).map(tokenText), ["1", "○1"]);
    h.store.sessions.push(session("otherDone", { worktreeId: "w2" }));
    h.store.tabNotifications.otherDone = "done";
    assert.deepEqual(summaryTokens(h.render("w2")).map(tokenText), ["2", "✓1", "○1"]);
    assert.ok(!other.props.title.includes(`${catalogs[language]["sidebar.terminals.failed"]}: 0`));
    h.store.tabNotifications = { ...h.store.tabNotifications, wait: "done" };
    assert.ok(h.render().props.title.includes(`${catalogs[language]["sidebar.terminals.completed"]}: 2`));
    h.store.sessionStatuses = { ...h.store.sessionStatuses, done: "error" };
    assert.ok(h.render().props.title.includes(`${catalogs[language]["sidebar.terminals.failed"]}: 2`));
    h.store.sessions = h.store.sessions.filter((s) => s.worktreeId !== "w1");
    assert.equal(h.render(), null);
  }
});

test("actual tree and shortcut summaries stay mounted through independent folds at both densities/languages", () => {
  for (const language of ["zh-CN", "en-US"]) for (const compact of [false, true]) {
    const h = collapseHarness(language);
    const ids = (tree) => descendants(tree).filter((el) => el.props["data-worktree-summary"])
      .map((el) => el.props["data-worktree-summary"]);
    assert.deepEqual(ids(h.row("w1", compact ? "compact" : "comfortable")), ["w1"]);
    assert.deepEqual(ids(h.row("empty")), []);
    assert.deepEqual(ids(h.shortcuts(compact)), ["w1", "w2"]);
    toggleButtons(h.row("w1"))[0].props.onClick({ stopPropagation() {} });
    assert.deepEqual(lists(h.row("w1")), []);
    assert.deepEqual(ids(h.row("w1", compact ? "compact" : "comfortable")), ["w1"]);
    assert.deepEqual(ids(h.shortcuts(compact)), ["w1", "w2"]);
    assert.deepEqual(lists(h.shortcuts(compact)), ["main", "w2"]);
    assert.ok(descendants(h.shortcuts(compact)).filter((el) => el.props["data-worktree-summary"])
      .every((el) => el.props.title.includes(catalogs[language]["sidebar.terminals.summaryHiddenIncluded"])));
  }
});

test("group flyout and all shortcut entrances use exact WT summary with fixed columns and deterministic tiers", () => {
  const flyout = source("../components/ProjectTree.tsx");
  assert.match(flyout, /WorktreeTerminalSummary projectId=\{child.project.id\} worktreeId=\{child.worktree.id\} compact/);
  assert.match(flyout, /SidebarWorktreeTerminals key=\{worktree.id\}/);
  assert.match(flyout, /SidebarProjectTerminals projectId=\{p.id\} compact/);
  assert.match(source("../components/PinnedProjectSection.tsx"), /SidebarProjectTerminals projectId=\{project.id\}/);
  const css = source("../styles/sidebar-terminals.css");
  const rule = (selector) => {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    assert.ok(block.startsWith(`${selector} {`), selector);
    return block;
  };
  assert.match(rule(".worktree-terminal-toggle-slot"), /flex: 0 0 14px;/);
  assert.match(rule(".worktree-terminal-toggle-slot"), /width: 14px;[\s\S]*height: 22px;/);
  assert.match(rule(".ui-worktree-row > .ui-tree-item-actions"), /display: flex;[\s\S]*flex: 0 0 22px;/);
  assert.match(rule(".worktree-terminal-heading"), /flex: 1 1 0;[\s\S]*flex-direction: column;[\s\S]*min-width: 0;/);
  assert.doesNotMatch(rule(".worktree-terminal-heading"), /flex-wrap: wrap;/);
  assert.match(rule(".worktree-terminal-title-line"), /flex-wrap: nowrap;[\s\S]*min-width: 0;[\s\S]*white-space: nowrap;/);
  assert.match(rule(".worktree-terminal-title"), /flex: 1 1 0;[\s\S]*min-width: 0;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(rule(".worktree-terminal-summary"), /max-width: 100%;[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(rule(".worktree-terminal-summary-text"), /white-space: nowrap;[\s\S]*overflow-wrap: normal;[\s\S]*word-break: normal;/);
  assert.match(source("../components/SidebarTerminalList.tsx"), /resolveSidebarTerminalState\(session/);
  assert.doesNotMatch(source("../components/WorktreeTerminalSummary.tsx"), /getState|onClick|<button|useEffect|invoke|setItem/);
});


test("mock-rendered rows keep empty toggle slots inert and title/badges separate from optional metadata", () => {
  const hasClass = (el, name) => el.props.className?.split(" ").includes(name);
  for (const language of ["zh-CN", "en-US"]) for (const density of ["compact", "comfortable"]) {
    const h = collapseHarness(language);
    h.actions.providerBadges["wt:w1"] = { providerName: "gpt-5.6-long-provider" };
    for (const folded of [false, true]) {
      if (folded) h.actions.collapsedIds.add(h.context.worktreeTerminalsCollapseId("w1"));
      for (const tree of [h.row("w1", density), h.row("empty", density), h.flyout("w1"), h.flyout("empty")]) {
        const elements = descendants(tree);
        const slot = elements.find((el) => hasClass(el, "worktree-terminal-toggle-slot"));
        assert.equal(elements.filter((el) => hasClass(el, "worktree-terminal-toggle-slot")).length, 1);
        const button = toggleButtons(slot)[0];
        if (button) assert.equal(button.props["aria-expanded"], !folded);
        else {
          const placeholder = React.Children.toArray(slot.props.children)[0];
          assert.equal(placeholder.type, "span");
          assert.equal(placeholder.props["aria-hidden"], "true");
          assert.equal(placeholder.props.tabIndex, undefined);
          assert.equal(placeholder.props.onClick, undefined);
          assert.equal(React.Children.count(placeholder.props.children), 0);
        }
        const heading = elements.find((el) => hasClass(el, "worktree-terminal-heading"));
        const tiers = React.Children.toArray(heading.props.children);
        assert.ok(hasClass(tiers[0], "worktree-terminal-title-line"));
        assert.ok(descendants(tiers[0]).some((el) => hasClass(el, "worktree-terminal-title")));
        assert.ok(!descendants(tiers[0]).some((el) => el.props["data-worktree-summary"]));
        assert.equal(tiers.length, button ? 2 : 1);
        if (button) assert.equal(tiers[1].props["data-worktree-summary"], "w1");
        const actions = elements.find((el) => hasClass(el, "ui-tree-item-actions"));
        if (actions) {
          assert.ok(hasClass(actions, "flex"));
          assert.doesNotMatch(actions.props.className, /hidden|group-hover|group-focus/);
        }
      }
      const mainTitle = descendants(h.row("w1", density)).find((el) => hasClass(el, "worktree-terminal-title-line"));
      assert.ok(!renderToStaticMarkup(mainTitle).includes("WT"));
      assert.ok(renderToStaticMarkup(mainTitle).includes("gpt-5.6"));
      for (const heading of descendants(h.shortcuts(density === "compact")).filter((el) => hasClass(el, "worktree-terminal-heading"))) {
        const tiers = React.Children.toArray(heading.props.children);
        assert.equal(tiers.length, 2);
        assert.ok(hasClass(tiers[0], "worktree-terminal-title-line"));
        assert.ok(tiers[1].props["data-worktree-summary"]);
      }
    }
  }
});


test("actual bilingual pin/unpin and keyboard move menus dispatch metadata callbacks without reopen/delete", () => {
  for (const language of ["zh-CN", "en-US"]) for (const pinned of [false, true]) {
    const h = renderList(language, { items: [session("a", { sidebarPinned: pinned }), session("b", { sidebarPinned: pinned })] });
    const elements = descendants(h.tree);
    const menu = elements.find((el) => el.props.children === catalogs[language][pinned ? "sidebar.terminals.unpin" : "sidebar.terminals.pin"]);
    menu.props.onSelect();
    const moves = elements.filter((el) => el.props.children === catalogs[language]["sidebar.order.moveDown"]);
    assert.equal(moves[0].props.disabled, false);
    moves[0].props.onSelect();
    assert.deepEqual(h.calls, [["pin", "a", !pinned], ["move", "a", 1]]);
    assert.equal(elements.filter((el) => el.props.className === "sidebar-terminal-pin").length, pinned ? 2 : 0);
  }
});


test("actual terminal row receives sortable refs/attributes/pointer and Alt callbacks; drag clicks do not reopen", () => {
  const h = renderList("en-US");
  const row = descendants(h.tree).find((el) => el.type === "button");
  assert.equal(row.props["aria-describedby"], "terminal-drag");assert.equal(row.props.tabIndex, 0);
  row.props.ref("row");assert.deepEqual(h.calls, [["node", "row"], ["activator", "row"]]);h.calls.length = 0;
  let stopped = 0;
  const e = (button = 0, isPrimary = true) => ({ button, isPrimary, stopPropagation() { stopped++; } });
  row.props.onPointerDown(e());row.props.onPointerDown(e(2));row.props.onPointerDown(e(1));row.props.onPointerDown(e(0, false));
  assert.deepEqual(h.calls, [["pointer"]]);assert.equal(stopped, 4);h.calls.length = 0;
  for (const key of ["ArrowUp", "ArrowDown"]) row.props.onKeyDown({ key, altKey: true, stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(h.calls, [["move", "hidden", -1], ["move", "hidden", 1]]);h.calls.length = 0;
  row.props.onClick({ stopPropagation() {} });assert.deepEqual(h.calls, [["open", "hidden"]]);
  const dragging = renderList("en-US", { dragging: true });
  descendants(dragging.tree).find((el) => el.type === "button").props.onClick({ stopPropagation() {} });
  assert.deepEqual(dragging.calls, []);
  const group = descendants(h.tree).find((el) => el.props["data-sidebar-terminals"] !== undefined);
  group.props.onPointerDown({ stopPropagation() { stopped++; } });assert.equal(stopped, 5);
});


test("project badges aggregate only PTY task presentation, including hidden/worktree sessions", () => {
  const items = [session("empty"), session("hidden", { tabHidden: true, worktreeId: "w1" }),
    session("pseudo", { kind: "pi", projectId: "p2" })];
  const life = { empty: "running", hidden: "running", pseudo: "running" };
  const resolve = (notifications = {}) => domain.summarizeProjectTerminalStates(items, life, notifications);
  assert.equal(resolve().get("p1"), "idle");
  assert.equal(resolve().has("p2"), false);
  assert.equal(resolve({ hidden: "running" }).get("p1"), "running");
  assert.equal(resolve({ hidden: "done" }).get("p1"), "completed");
  assert.equal(resolve({ hidden: "failed", empty: "running" }).get("p1"), "failed");
  assert.equal(resolve({ hidden: "attention", empty: "failed" }).get("p1"), "wait");
  items[0].remoteHandoff = { phase: "running" };
  assert.equal(resolve({ hidden: "attention" }).get("p1"), "remote");
  const controller = source("../hooks/useSidebarController.tsx");
  assert.match(controller, /summarizeProjectTerminalStates\(sessions, sessionStatuses, tabNotifications, taskSources\)/);
  assert.doesNotMatch(controller, /sessionStatuses\[session.id\] \?\? "running"/);
});


test("ordinary shell row and no-Agent summary hide all task state while retaining total and hidden metadata", () => {
  for (const language of ["zh-CN", "en-US"]) {
    const items = [session("plain", { isAgentSession: false, worktreeId: "w1" }), session("legacy", { isAgentSession: undefined, worktreeId: "w1", tabHidden: true })];
    const sources = { plain: { shell: "running" }, legacy: { shell: "failed" } };
    const result = actualDomain.summarizeWorktreeTerminals(items, "p1", "w1", { plain: "running", legacy: "error" }, { plain: "running", legacy: "failed" }, sources);
    assert.equal(result.total, 2); assert.equal(Object.values(result.counts).reduce((a,b) => a+b), 0);
    assert.equal(actualDomain.summarizeProjectTerminalStates(items, {}, {}, sources).size, 0);
    assert.equal(actualDomain.resolveSidebarTerminalState(items[0], "running", "running", sources.plain), null);
    const h = summaryHarness(language); h.store.sessions = items; h.store.tabStatuses = sources;
    const rendered = h.render();
    assert.deepEqual(summaryTokens(rendered).map(tokenText), ["2"]);
    assert.equal(summaryTokens(rendered)[0].props.children[0].type, icons.Terminal);
    assert.equal(rendered.props.title, rendered.props["aria-label"]);
    assert.equal(rendered.props.title, [catalogs[language]["sidebar.terminals.summaryTotal"].replace("{count}", "2"),
      catalogs[language]["sidebar.terminals.summaryHiddenIncluded"]].join(" · "));
    const row = renderList(language, { items: [session("plain", { isAgentSession: false, tabHidden: true })], notifications: { plain: "running" } });
    assert.equal(descendants(row.tree).filter(el => el.props.className === "sidebar-terminal-status").length, 0);
    const button = descendants(row.tree).find((el) => el.type === "button");
    assert.equal(button.props.title, `Terminal plain · ${catalogs[language]["sidebar.terminals.hidden"]}`);
    assert.ok(button.props["aria-label"].endsWith(button.props.title));
    assert.equal((renderToStaticMarkup(row.tree).match(/data-icon="EyeOff"/g) ?? []).length, 1);
  }
});

test("mixed summary totals all PTYs but counts six states only for current qualified Agents", () => {
  const states = ["running", "attention", "done", "failed", "none", "none"];
  const agents = states.map((hook, i) => session(`a${i}`, { worktreeId: "w1", isAgentSession: i === 0 ? false : true,
    ...(i === 5 ? { remoteHandoff: { phase: "running" } } : {}) }));
  const sources = Object.fromEntries(states.map((hook,i) => [`a${i}`, { hook, shell: "running", ...(i === 0 ? { agentIdentity: { source: "pi", sessionId: "live" } } : {}) }]));
  const items = [...agents, session("shell", { worktreeId: "w1", isAgentSession: false }), session("ended", { worktreeId: "w1", isAgentSession: true })];
  sources.ended = { hook: "done", agentExited: true };
  const result = actualDomain.summarizeWorktreeTerminals(items, "p1", "w1", {}, {}, sources);
  assert.equal(result.total, 8);
  assert.deepEqual(result.counts, { running: 1, wait: 1, completed: 1, failed: 1, idle: 1, remote: 1 });
});
