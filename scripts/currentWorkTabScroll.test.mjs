import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "current-work-scroll-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
writeFileSync(join(temp, "react.mjs"), `
let cells = [], cursor = 0, effects = [], cleanups = [];
export function reset() { unmount(); cells = []; }
export function unmount() { cleanups.forEach(fn => fn?.()); cleanups = []; }
export function render(fn) { cursor = 0; effects = []; const value = fn(); effects.forEach(fn => fn()); return value; }
export function useRef(initial) { const i = cursor++; return cells[i] ??= {current: initial}; }
export function useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
 return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; }
export function useCallback(fn, deps) { const i = cursor++; const old = cells[i];
 if (!old || deps.some((dep, n) => dep !== old.deps[n])) cells[i] = {fn, deps}; return cells[i].fn; }
export function useEffect(fn, deps) { const i = cursor++; const old = cells[i];
 if (!old || deps.some((dep, n) => dep !== old[n])) {
 cells[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } }
`);
const source = readFileSync(new URL("../src/features/terminal/hooks/useCurrentWorkTabScroll.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const wheelSource = readFileSync(new URL("../src/features/terminal/lib/terminalTabWheelScroll.ts", import.meta.url), "utf8");
writeFileSync(join(temp, "wheel.mjs"), ts.transpileModule(wheelSource, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText);
writeFileSync(join(temp, "hook.mjs"), code.replace('from "react"', 'from "./react.mjs"')
 .replace('from "../lib/terminalTabWheelScroll"', 'from "./wheel.mjs"'));
const { useCurrentWorkTabScroll } = await import(pathToFileURL(join(temp, "hook.mjs")));
const react = await import(pathToFileURL(join(temp, "react.mjs")));
let frames = new Map(), nextFrame = 0, time = 0, resize;
globalThis.window = {
 requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
 cancelAnimationFrame(id) { frames.delete(id); },
};
let disconnected = false;
globalThis.ResizeObserver = class {
 constructor(fn) { resize = fn; disconnected = false; }
 observe() {}
 disconnect() { disconnected = true; }
};
function flush() { time += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); }
function settle() { for (let i = 0; frames.size && i < 100; i++) flush(); assert.equal(frames.size, 0); }
function setup() {
 react.reset(); frames.clear();
 const listeners = new Map();
 const element = {
  scrollWidth: 900, clientWidth: 300, clientLeft: 0, scrollLeft: 0,
  getBoundingClientRect: () => ({ left: 10 }),
  querySelectorAll: () => [{ dataset: {currentWorkSessionId: "last"}, getBoundingClientRect: () => ({left: 810 - element.scrollLeft, right: 910 - element.scrollLeft, width: 100}) }],
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
  scrollBy({left, behavior}) { assert.equal(behavior, "smooth"); element.scrollLeft = Math.max(0, Math.min(600, element.scrollLeft + left)); listeners.get("scroll")?.(); },
 };
 let enabled = true, active = null, signature = "a";
 const render = () => react.render(() => useCurrentWorkTabScroll(enabled, active, signature));
 let hook = render(); hook.scrollRef.current = element;
 signature = "b"; hook = render(); flush();
 return {element, listeners, render, hook, activate(id) {active = id; return render();}, compact() {enabled = false; hook.scrollRef.current = null; return render();}};
}

test("overflow navigation pages both directions and disables at edges", () => {
 const s = setup();
 assert.deepEqual(s.render().scrollState, {canScrollLeft: false, canScrollRight: true});
 s.hook.scrollTabs(1); flush();
 assert.equal(s.element.scrollLeft, 216);
 assert.deepEqual(s.render().scrollState, {canScrollLeft: true, canScrollRight: true});
 s.hook.scrollTabs(1); s.hook.scrollTabs(1); flush();
 assert.deepEqual(s.render().scrollState, {canScrollLeft: true, canScrollRight: false});
 s.hook.scrollTabs(-1); flush(); assert.equal(s.element.scrollLeft, 384);
});

test("wheel handles vertical/horizontal, line/page units and preserves Ctrl zoom", () => {
 const s = setup(); let prevented = 0;
 const wheel = (extra) => s.listeners.get("wheel")({deltaX: 0, deltaY: 30, deltaMode: 0, ctrlKey: false, preventDefault() {prevented++;}, ...extra});
 wheel({}); assert.equal(s.element.scrollLeft, 0); settle(); assert.equal(s.element.scrollLeft, 30);
 wheel({deltaX: 50, deltaY: 10}); assert.equal(s.element.scrollLeft, 80);
 wheel({deltaY: -2, deltaMode: 1}); settle(); assert.equal(s.element.scrollLeft, 48);
 wheel({deltaY: 1, deltaMode: 2}); settle(); assert.equal(s.element.scrollLeft, 348);
 wheel({ctrlKey: true}); assert.equal(s.element.scrollLeft, 348); assert.equal(prevented, 4);
 s.element.scrollWidth = 300; wheel({}); assert.equal(prevented, 4);
});

test("vertical wheel bursts ease across frames, accumulate and reverse without losing distance", () => {
 const s = setup();
 const wheel = (deltaY) => s.listeners.get("wheel")({deltaX: 0, deltaY, deltaMode: 0, preventDefault() {}});
 wheel(120); flush();
 assert.ok(s.element.scrollLeft > 0 && s.element.scrollLeft < 120);
 wheel(120); settle(); assert.equal(s.element.scrollLeft, 240);
 wheel(-120); settle(); assert.equal(s.element.scrollLeft, 120);
 wheel(1000); settle(); assert.equal(s.element.scrollLeft, 600);
 wheel(-120); settle(); assert.equal(s.element.scrollLeft, 480);
});

test("direct input, navigation buttons and compact mode cancel pending wheel animation", () => {
 const s = setup();
 const wheel = () => s.listeners.get("wheel")({deltaX: 0, deltaY: 120, deltaMode: 0, preventDefault() {}});
 wheel(); flush(); s.listeners.get("pointerdown")(); const stopped = s.element.scrollLeft;
 settle(); assert.equal(s.element.scrollLeft, stopped);
 wheel(); s.hook.scrollTabs(1); const buttonTarget = s.element.scrollLeft;
 settle(); assert.equal(s.element.scrollLeft, buttonTarget);
 wheel(); s.compact(); settle(); assert.equal(s.listeners.size, 0);
});

test("reduced motion uses immediate scrolling", () => {
 const s = setup(); window.matchMedia = () => ({matches: true});
 try {
  s.listeners.get("wheel")({deltaX: 0, deltaY: 120, deltaMode: 0, preventDefault() {}});
  assert.equal(s.element.scrollLeft, 120); settle();
 } finally { delete window.matchMedia; }
});

test("activation and resize reveal active tab without scrolling ancestors", () => {
 const s = setup(); s.activate("last"); flush();
 assert.equal(s.element.scrollLeft, 600);
 s.element.clientWidth = 200; resize(); flush();
 assert.equal(s.element.scrollLeft, 700);
 s.element.clientWidth = 1000; resize(); flush();
 assert.equal(s.element.scrollLeft, 0);
 assert.deepEqual(s.render().scrollState, {canScrollLeft: false, canScrollRight: false});
});

test("compact transition and unmount release observers, events and frames", () => {
 const s = setup(); s.listeners.get("scroll")();
 assert.equal(frames.size, 1);
 s.compact(); flush();
 assert.equal(disconnected, true); assert.equal(s.listeners.size, 0); assert.equal(frames.size, 0);
 assert.deepEqual(s.render().scrollState, {canScrollLeft: false, canScrollRight: false});
 react.unmount();
});

test("ordinary and current-work bars share wheel controller without render-driven active-tab snapping", () => {
 const pane = readFileSync(new URL("../src/features/terminal/components/PaneTabBar.tsx", import.meta.url), "utf8");
 assert.match(pane, /attachTerminalTabWheelScroll\(element, scheduleUpdate\)/);
 assert.match(pane, /wheelScroll.dispose\(\)/);
 assert.match(pane, /cancelWheelScrollRef.current\?\.\(\)/);
 // Scroll-state renders must not recreate the active reveal callback and snap back mid-wheel.
 assert.match(pane, /\[activePaneTabId, pane.id, lastPaneTabId, updateTabScrollState\]/);
 assert.doesNotMatch(pane, /element.scrollLeft \+= delta/);
 assert.match(source, /attachTerminalTabWheelScroll\(element, scheduleUpdate\)/);
});

test("current work wiring preserves sortable IDs and bilingual navigation labels", () => {
 const component = readFileSync(new URL("../src/features/terminal/components/CurrentWorkTabBar.tsx", import.meta.url), "utf8");
 assert.match(component, /data-current-work-session-id=\{session.id\}/);
 assert.match(component, /ref=\{scrollRef\}/);
 assert.match(component, /!compact && isOverflowing/);
 for (const direction of ["Left", "Right"]) assert.ok(component.includes(`t("terminal.tab.scroll${direction}")`));
});
