import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "pane-short-labels-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
const stub = `
export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = "fragment";
export const useCallback = fn => fn, useMemo = fn => fn(), useEffect = () => {}, useRef = value => ({ current: value });
export const useState = value => [globalThis.forcePaneOverflow && value?.isOverflowing === false ? { ...value, isOverflowing: true } : value, () => {}];
export const useI18n = () => ({ t: key => key });
export const useSortable = options => { globalThis.dragPayload = options.data; return { attributes: {}, listeners: {} }; };
export const useDroppable = () => ({});
export const useTerminalTabHoverCard = () => ({});
export const useSettingsStore = fn => fn({ workspanEnabled: true });
export const getTerminalTheme = () => ({}), normalizeTabMenuHex = () => "#000000", tabMenuHexToRgba = () => "";
export const inferVendor = () => null, inferSessionVendor = () => null, inferSessionCliToolIcon = () => null;
export const buildTerminalTabDisplayTitle = s => s.title, buildTerminalTabHoverInfo = () => ({});
export const PULSING_TAB_STATES = new Set(), TAB_NOTIFICATION_COLORS = {}, TAB_NOTIFICATION_LABELS = {}, CSS = { Transform: { toString: () => "" } };
`;
writeFileSync(join(temp, "stubs.mjs"), stub);
async function load(name) {
  const source = readFileSync(new URL(`../src/features/terminal/components/${name}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const names = new Set();
  const body = code.replace(/import\s*\{([^}]+)\}\s*from\s*"[^"]+";\n/g, (_, items) => {
    for (const item of items.split(",")) if (item.trim()) names.add(item.trim());
    return "";
  });
  const exports = new Set([...stub.matchAll(/export const (\w+)/g)].map(m => m[1]));
  // Multi-declaration hook/visual exports.
  for (const name of ["jsxs", "Fragment", "useMemo", "useEffect", "useRef", "useState", "normalizeTabMenuHex", "tabMenuHexToRgba", "inferSessionVendor", "inferSessionCliToolIcon", "buildTerminalTabHoverInfo", "TAB_NOTIFICATION_COLORS", "TAB_NOTIFICATION_LABELS", "CSS"]) exports.add(name);
  const preamble = [...names].map(name => {
    const [original, alias = original] = name.split(/\s+as\s+/);
    return exports.has(original) ? `import { ${name} } from "./stubs.mjs";` : `const ${alias} = ${JSON.stringify(original)};`;
  }).join("\n");
  writeFileSync(join(temp, `${name}.mjs`), preamble + "\n" + body);
  return import(pathToFileURL(join(temp, `${name}.mjs`)));
}
const sortable = await load("SortableTerminalTabs");
const overlay = await load("TerminalTabDragOverlay");
const pane = await load("PaneTabBar");
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const badge = { label: "Project / 十二字符别名 W2147483647", identity: "persistent-identity", color: "red" };
test("pane and workspan retain separate nonshrinking token in display and drag payload", () => {
  for (const render of [
    () => sortable.SortableTab({ id: "s", paneId: "p", title: "original title", worktreeBadge: badge, hoverInfo: {}, notification: "none", menuContent: () => null }),
    () => sortable.SortableWorkspanTab({ workspan: { id: "w" }, title: "original title", worktreeBadge: badge, notification: "none", menuContent: () => null }),
  ]) {
    const tree = render();
    const token = nodes(tree).find(n => n.props?.children === badge.label);
    assert.match(token.props.className, /shrink-0 whitespace-nowrap/);
    assert.ok(nodes(tree).some(n => n.props?.children === "original title"));
    assert.equal(globalThis.dragPayload.overlay.worktreeBadge.identity, badge.identity);
  }
});
test("overlay renders badge independently of truncated title", () => {
  const tree = overlay.DragOverlayTab({ title: "purpose", notification: "none", worktreeBadge: badge });
  assert.equal(tree.props["data-worktree-identity"], badge.identity);
  assert.doesNotMatch(tree.props.className, /max-w-/);
  assert.match(nodes(tree).find(n => n.props?.children === badge.label).props.className, /shrink-0 whitespace-nowrap/);
});
test("pane selected tab follows pane active even when focus belongs elsewhere", () => {
  const tree = pane.PaneTabBar({ pane: { id: "p", sessionIds: ["a", "b"], activeSessionId: "b" }, sessions: [{ id: "a", title: "A" }, { id: "b", title: "B" }], activeSessionId: "elsewhere", projects: [], worktrees: [], allPanes: [], tabNotifications: {}, sessionWorktreeBadges: new Map([["b", badge]]) });
  const tabs = nodes(tree).filter(n => n.type === "SortableTab");
  assert.equal(tabs[0].props.isActive, false);
  assert.equal(tabs[1].props.isActive, true);
  assert.equal(tabs[1].props.worktreeBadge, badge);
});

test("pane overflow keeps complete token in bounded column separate from purpose", async () => {
  globalThis.forcePaneOverflow = true;
  const label = "SameVeryLongProjectName".repeat(8) + " · duplicate-project-id / W2147483647 + 另一个长项目 / 审查";
  const tree = pane.PaneTabBar({ pane: { id: "p", sessionIds: ["a"], activeSessionId: "a" },
    sessions: [{ id: "a", title: "Purpose remains separate" }], projects: [], worktrees: [], allPanes: [],
    tabNotifications: {}, sessionWorktreeBadges: new Map([["a", { ...badge, label }]]) });
  delete globalThis.forcePaneOverflow;
  const column = nodes(tree).find(n => n.props?.className?.includes("ui-workspan-overflow-text"));
  assert.ok(column);
  assert.equal(column.props.children[0].props.children, label);
  assert.doesNotMatch(column.props.children[0].props.className, /truncate|nowrap|shrink-0/);
  assert.equal(column.props.children[1].props.children, "Purpose remains separate");
  if (process.env.TERMINAL_GEOMETRY_DIR) {
    const { saveOverflowFixture } = await import("./terminalOverflowGeometry.fixture.mjs");
    const menu = nodes(tree).find(n => n.props?.className?.includes("ui-terminal-tab-list-popover"));
    await saveOverflowFixture("pane-overflow", menu);
  }
});
