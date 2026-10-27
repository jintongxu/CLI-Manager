import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const states = [];
let focusCount = 0;
let managementMode = "normal";
function load(path) {
  const filename = resolve(path); const exports = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, getComputedStyle: () => ({ getPropertyValue: name => ({ "--terminal-theme-background": "#111111", "--terminal-theme-foreground": "#eeeeee", "--terminal-theme-accent": "#6688ff" })[name] }), require: (name) => {
    if (name === 'react') return { useId: () => 'test', useRef: () => ({ current: { focus: () => focusCount++, querySelectorAll: () => [] } }),
      useState: (initial) => [initial === "normal" ? managementMode : initial, (value) => states.push(value)],
      useCallback: (fn) => fn, useEffect: () => {} };
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('/lib/terminalTabsModel')) return { buildTerminalTabContext: () => ({ projectColor: '#6688ff' }) };
    if (name.endsWith('/lib/currentWorkPresentation')) return { formatTerminalTabContext: () => 'ctx' };
    if (name.endsWith('/hooks/useCurrentWorkTabScroll')) return { useCurrentWorkTabScroll: () => ({ scrollRef: { current: null }, scrollState: { canScrollLeft: false, canScrollRight: false }, scrollTabs() {} }) };
    if (name === '@dnd-kit/core') return { useDroppable: () => ({ setNodeRef() {}, isOver: false }) };
    if (name === '@dnd-kit/sortable') return { useSortable: ({ id }) => ({ attributes: { 'data-sortable-id': id }, listeners: {}, setNodeRef() {}, transform: null, transition: null, isDragging: false }), SortableContext: 'SortableContext', horizontalListSortingStrategy: 'horizontal' };
    if (name === '@dnd-kit/utilities') return { CSS: { Transform: { toString: () => undefined } } };
    if (name.includes('i18n')) return { useI18n: () => ({ t: (key) => key }) };
    if (name.includes('/ui/')) return Object.fromEntries(['Button', 'Input', 'Select', 'Popover', 'PopoverTrigger', 'PopoverContent'].map(key => [key, key]));
    if (name.endsWith('.css')) return {};
    const extension = name.includes('Panels') || name.includes('Bar') || name.includes('TabRow') || name.includes('NavigationDrawer') ? '.tsx' : '.ts';
    return load(resolve(dirname(filename), `${name}${extension}`));
  } });
  return exports;
}
const root = 'src/features/terminal/components/';
const model = load(`${root}terminalNavigationUiModel.ts`);
const panels = load(`${root}TerminalNavigationPanels.tsx`);
const bar = load(`${root}TerminalNavigationBar.tsx`);
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
const entry = (id, extra = {}) => ({ id, session: { id, title: id, cwd: 'C:/repo' }, project: { name: 'Alpha', path: 'C:/repo' }, worktree: { branch: 'feature', display_name: 'Tree' }, ...extra });
const a = entry('a', { current: true, pinned: true, inCurrentWork: true }); const b = entry('b');
const groups = { recent: [a], currentWork: [a], other: [b] };
function callbacks() { const calls = []; return { calls, onActivate: id => calls.push(['activate', id]), onTogglePin: id => calls.push(['pin', id]), onAddToCurrentWork: id => calls.push(['add', id]), renderSessionActions: e => `menu:${e.id}` }; }

test('popup filtering searches metadata and deduplicates without mutating source', () => {
  for (const query of ['alpha', 'tree', 'feature', 'c:\\repo']) assert.equal(Object.values(model.filterNavigationGroups(groups, query)).flat().length, 2);
  assert.equal(Object.values(model.filterNavigationGroups(groups, 'missing')).flat().length, 0);
  assert.equal(groups.currentWork.length, 1);
});
test('keyboard index wraps and handles empty lists', () => {
  assert.equal(model.navigationResultIndex(0, 'ArrowUp', 2), 1);
  assert.equal(model.navigationResultIndex(1, 'ArrowDown', 2), 0);
  assert.equal(model.navigationResultIndex(0, 'End', 2), 1);
  assert.equal(model.navigationResultIndex(1, 'Home', 2), 0);
  assert.equal(model.navigationResultIndex(0, 'ArrowDown', 0), -1);
});
test('switcher autofocus, keyboard activation and explicit pin do not implicitly add membership', () => {
  const cb = callbacks(); const tree = panels.TerminalNavigationSwitcher({ ...cb, groups, side: 'top' });
  const all = nodes(tree); const popup = all.find(n => n.type === 'PopoverContent');
  popup.props.onOpenAutoFocus({ preventDefault() {} }); assert.equal(focusCount, 1);
  assert.equal(popup.props.side, 'top');
  const input = all.find(n => n.type === 'Input');
  input.props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} });
  assert.deepEqual(cb.calls, [['activate', 'a']]); assert.equal(states.at(-1), false);
  all.find(n => n.type === 'Button' && n.props['aria-pressed']).props.onClick();
  assert.deepEqual(cb.calls.at(-1), ['pin', 'a']);
  assert.equal(all.filter(n => n.props.role === 'option').length, 2);
  // Radix owns Escape and close autofocus; no preventDefault override that steals trigger restoration.
  assert.equal(popup.props.onCloseAutoFocus, undefined);
});
test('management has one list, explicit selection and mutually exclusive ordering', () => {
  const cb = callbacks(); const pi = entry('pi', { inCurrentWork: true, session: { id: 'pi', title: 'Pi', kind: 'ephemeral-pi' } });
  let orderingCalls = 0;
  const props = { ...cb, entries: [a, b, pi], selectedIds: ['a', 'pi', 'outside', 'b'], side: 'bottom',
    onToggleSelection: id => cb.calls.push(['select', id]), onRemoveFromCurrentWork: id => cb.calls.push(['remove', id]),
    onRemoveSelected: ids => cb.calls.push(['batch', Array.from(ids)]), onCloseOthers() {},
    renderOrderingSurface: () => { orderingCalls++; return 'legacy-ordering'; } };
  let all = nodes(panels.TerminalNavigationManagement(props));
  assert.equal(orderingCalls, 0);
  assert.equal(all.filter(n => n.props.className === 'ui-terminal-navigation-management-row').length, 3);
  assert.equal(all.filter(n => n.type === 'input').length, 0);
  assert.ok(all.some(n => n.props.children === 'terminal.navigation.removeAndClose'));
  managementMode = 'select';
  all = nodes(panels.TerminalNavigationManagement(props));
  assert.equal(all.filter(n => n.type === 'input').length, 2);
  all.find(n => n.props.children === 'terminal.navigation.removeSelected').props.onClick();
  assert.deepEqual(cb.calls, [['batch', ['a', 'pi']]]);
  const zero = nodes(panels.TerminalNavigationManagement({ ...props, selectedIds: ['b', 'outside'] })).find(n => n.props.children === 'terminal.navigation.removeSelected');
  assert.equal(zero.props.disabled, true); zero.props.onClick(); assert.equal(cb.calls.length, 1);
  managementMode = 'order';
  all = nodes(panels.TerminalNavigationManagement(props));
  assert.equal(orderingCalls, 1); assert.equal(all.filter(n => n.props.className === 'ui-terminal-navigation-management-row').length, 0);
  managementMode = 'normal';
});
test('explicit add picker adds outsider without activating or exiting', () => {
  const cb = callbacks();
  const tree = panels.TerminalNavigationSwitcher({ ...cb, picker: true, groups: { recent: [], currentWork: [], other: [b] }, side: 'bottom' });
  nodes(tree).find(n => n.props.role === 'option').props.onClick();
  assert.deepEqual(cb.calls, [['add', 'b']]);
});
test('empty current-work renders a real tab row and a single drawer entry point', () => {
  const source = readFileSync(`${root}TerminalNavigationBar.tsx`, 'utf8');
  assert.match(source, /TerminalTabRow/);
  assert.match(source, /TerminalNavigationDrawer/);
  assert.doesNotMatch(source, /<TerminalNavigationSwitcher(?:\s|\/|>)/);
  assert.doesNotMatch(source, /<TerminalNavigationManagement(?:\s|\/|>)/);
  assert.doesNotMatch(source, /<Select(?:\s|\/|>)/);
});
test('single row renders the complete passed collection without quick caps or more-count', () => {
  const source = readFileSync(`${root}TerminalTabRow.tsx`, 'utf8');
  assert.match(source, /entries\.map/);
  assert.doesNotMatch(source, /quickEntries|hiddenCount|moreCount/);
  assert.match(source, /useCurrentWorkTabScroll/);
  assert.match(source, /data-current-work-session-id/);
  const css = readFileSync(`${root}terminalNavigation.css`, 'utf8');
  assert.match(css, /ui-terminal-tab-row-list/); assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /nth-of-type/);
});
test('context contains disambiguating project identity, path and missing worktree state', () => {
  const tree = panels.TerminalNavigationContext({ entry: { ...a, project: { id: 'unique', name: 'Same', path: '/full/path' }, worktree: null, session: { ...a.session, worktreeId: 'gone' } }, side: 'bottom' });
  const text = JSON.stringify(tree); assert.match(text, /unique/); assert.match(text, /full\/path/); assert.match(text, /worktreeMissing/);
});

test('integration mounts one navigation for empty/ordinary/current-work modes and keeps terminal bodies stable', () => {
  const view = readFileSync(`${root}TerminalTabsView.tsx`, 'utf8');
  const adapter = readFileSync(`${root}TerminalNavigationAdapter.tsx`, 'utf8');
  const pane = readFileSync('src/features/terminal/hooks/useTerminalPaneAdapter.tsx', 'utf8');
  const controller = readFileSync('src/features/terminal/hooks/useTerminalTabsController.tsx', 'utf8');
  assert.equal((view.match(/<TerminalNavigationAdapter/g) ?? []).length, 1);
  assert.doesNotMatch(view, /<TerminalCurrentContext|mountedWorkspanLayouts.length > 0/);
  assert.match(view, /key=\{layout.workspan.id\}/);
  assert.match(view, /currentWorkSessionPortalTargets/);
  assert.match(pane, /hideTabBar=\{!options\?\.forceTabBar && state\.workspanEnabled && allPanes\.length <= 1/);
  assert.doesNotMatch(adapter, /DndContext|orderingDnd/);
  assert.equal((view.match(/<DndContext/g) ?? []).length, 1);
  assert.match(adapter, /layout.visiblePanes.length <= 1/);
  assert.match(view, /onAdd=\{\(id\) => \{ if \(!currentWorkSessionIds.includes\(id\)\) toggleCurrentWork\(id\); \}\}/);
  assert.match(adapter, /props.legacyOrdering/);
  assert.match(adapter, /actionSessionId=\{actionSessionId\}/);
  const activation = adapter.slice(adapter.indexOf('const activate ='), adapter.indexOf('const panes ='));
  assert.match(activation, /useTerminalStore.getState\(\)\.showSessions/);
  assert.match(activation, /exitCurrentWork\) props.leaveCurrentWork/);
  assert.doesNotMatch(activation, /onAdd|addCurrentWork/);
  const ordinary = controller.slice(controller.indexOf('const handleActivateSession ='), controller.indexOf('const handleTogglePaneFullscreen ='));
  assert.doesNotMatch(ordinary, /addCurrentWork/);
  assert.ok(controller.split('\n').length <= 2000);
});


test('ordinary navigation is the not-in-current-work candidate set and current-work is member-only', () => {
  const adapter = readFileSync(`${root}TerminalNavigationAdapter.tsx`, 'utf8');
  assert.match(adapter, /props\.currentWorkMode \? entry\.inCurrentWork : !entry\.inCurrentWork/);
  assert.match(adapter, /totalCount: visibleEntries\.length/);
  const messages = readFileSync('src/shared/i18n/messages/terminal.zh-CN.ts', 'utf8');
  assert.match(messages, /terminal\.navigation\.available/);
});

test('ordinary navigation order is supplied by the navigation hook and passed to the row', () => {
  const hook = readFileSync(`${root}../hooks/useTerminalNavigation.ts`, 'utf8');
  const adapter = readFileSync(`${root}TerminalNavigationAdapter.tsx`, 'utf8');
  assert.match(hook, /terminal-navigation-order/);
  assert.match(hook, /reorderNavigation/);
  assert.match(adapter, /onReorder=\{navigation\.reorderNavigation\}/);
});

test('terminal tab drag end uses sortable data session IDs before DOM IDs', () => {
  const controller = readFileSync(`${root}../hooks/useTerminalTabsController.tsx`, 'utf8');
  assert.match(controller, /const terminalTabActive = active\.data\.current\?\.type === "terminal-tab"/);
  assert.match(controller, /const sourceSessionId = terminalTabSourceId \?\? String\(active\.data\.current\?\.sessionId/);
  assert.match(controller, /if \(sourcePane\.id === targetPane\.id\) reorderSessions\(sourceSessionId, targetSessionId\)/);
});

test('terminal tab collision excludes the active tab so drag end can reach a sibling target', () => {
  const tabsModel = readFileSync(`${root}../lib/terminalTabsModel.ts`, 'utf8');
  assert.match(tabsModel, /const id = String\(collision\.id\);[\s\S]*?return id !== activeId/);
});

test('drag source lookup uses complete mounted pane trees, including hidden sessions', () => {
  const controller = readFileSync(`${root}../hooks/useTerminalTabsController.tsx`, 'utf8');
  assert.match(controller, /const allMountedPanes = mountedWorkspanLayouts\.flatMap\(\(layout\) => collectPaneLeaves\(layout\.paneTree\)\)/);
  assert.match(controller, /allMountedPanes\.find\(\(pane\) => pane\.sessionIds\.includes\(sessionId\)\)/);
});

test('empty navigation omits the special top-right action while preserving global new-terminal wiring', () => {
  const bar = readFileSync(`${root}TerminalNavigationBar.tsx`, 'utf8');
  const css = readFileSync(`${root}terminalNavigation.css`, 'utf8');
  const adapter = readFileSync(`${root}TerminalNavigationAdapter.tsx`, 'utf8');
  assert.doesNotMatch(bar, /navigation\.totalCount === 0/);
  assert.doesNotMatch(bar, /ui-terminal-navigation-empty-add/);
  assert.doesNotMatch(css, /ui-terminal-navigation-empty-add/);
  assert.match(adapter, /onNewTab=\{props\.onNewTab\}/);
});

test('drawer close hides project terminals but destroys independent terminals', () => {
  const view = readFileSync(`${root}TerminalTabsView.tsx`, 'utf8');
  assert.match(view, /const session = sessions\.find\(\(item\) => item\.id === id\)/);
  assert.match(view, /handleCloseSessions\(\[id\], undefined, \[\], !session\?\.projectId\)/);
});

test('current-work drop target accepts pending terminal tabs without opening the drawer', () => {
  const barSource = readFileSync(`${root}TerminalNavigationBar.tsx`, 'utf8');
  const controller = readFileSync('src/features/terminal/hooks/useTerminalTabsController.tsx', 'utf8');
  assert.match(barSource, /CURRENT_WORK_DROP_TARGET_ID/);
  assert.match(barSource, /useDroppable/);
  assert.match(controller, /overId === CURRENT_WORK_DROP_TARGET_ID/);
  assert.match(controller, /toggleCurrentWork\(droppedSessionId\)/);
});

test('single drawer replaces range, quick, finder and management entry points', () => {
  const source = readFileSync(`${root}TerminalNavigationBar.tsx`, 'utf8');
  assert.match(source, /TerminalNavigationDrawer/);
  assert.match(source, /TerminalTabRow/);
  for (const legacy of ['<TerminalNavigationSwitcher(?:\\s|\\/|>)', '<TerminalNavigationManagement(?:\\s|\\/|>)', '<Select(?:\\s|\\/|>)', 'quickEntries', 'moreCount']) {
    assert.doesNotMatch(source, new RegExp(legacy));
  }
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = readFileSync(`src/shared/i18n/messages/terminal.${locale}.ts`, 'utf8');
    for (const key of ['drawerTitle', 'pinned', 'hoverOpen']) assert.ok(messages.includes(`"terminal.navigation.${key}"`));
  }
});

test('navigation theme uses project accents and floating drawer affordances', () => {
  const css = readFileSync(`${root}terminalNavigation.css`, 'utf8');
  assert.match(css, /ui-terminal-tab-row-item\[data-active="true"\]/);
  assert.match(css, /var\(--tab-accent/);
  assert.match(css, /ui-terminal-navigation-drawer/);
  assert.match(css, /ui-terminal-navigation-drawer-row/);
  assert.match(css, /overflow: auto/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /pointer: coarse/);
});
