import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "drawer-intent-"));
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
writeFileSync(join(temp, "react.mjs"), `
let cells = [], cursor = 0, effects = [], cleanups = [];
export function reset() { runCleanups(); cells = []; }
export function runCleanups() { cleanups.forEach(fn => fn?.()); cleanups = []; }
export function render(fn) { cursor = 0; effects = []; const value = fn(); const pending = effects; effects = []; pending.forEach(run => run()); return value; }
export function useRef(initial) { const i = cursor++; return cells[i] ??= { current: initial }; }
export function useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
 return [cells[i], next => { cells[i] = typeof next === "function" ? next(cells[i]) : next; }]; }
export function useCallback(fn, deps) { const i = cursor++; const old = cells[i];
 if (!old || deps.some((d, n) => d !== old.deps[n])) cells[i] = { fn, deps }; return cells[i].fn; }
export function useEffect(fn, deps) { const i = cursor++; const old = cells[i];
 if (!old || deps.some((d, n) => d !== old[n])) { cells[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } }
`);
const source = readFileSync(new URL("../src/features/terminal/hooks/useTerminalDrawerIntent.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(join(temp, "hook.mjs"), code.replace('from "react"', 'from "./react.mjs"'));
const { useTerminalDrawerIntent, TERMINAL_DRAWER_OPEN_DELAY_MS, TERMINAL_DRAWER_CLOSE_DELAY_MS } = await import(pathToFileURL(join(temp, "hook.mjs")));
const react = await import(pathToFileURL(join(temp, "react.mjs")));

let timers = [], now = 0, focusHits = 0;
globalThis.window = {
  setTimeout(fn, ms) { const id = { fn, at: now + ms, ms }; timers.push(id); return id; },
  clearTimeout(id) { if (id) timers = timers.filter((t) => t !== id); },
};
function advance(ms) {
  now += ms;
  const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
  timers = timers.filter((t) => t.at > now);
  due.forEach((t) => t.fn());
}
function pendingTimers() { return [...timers]; }
// render() re-runs the hook, so hooks() always returns closures capturing the CURRENT pinned/open
// state; re-render between interactions is required because useCallback identity is stable across renders.
function setup({ enabled = true } = {}) {
  react.reset(); timers = []; now = 0; focusHits = 0;
  let currentEnabled = enabled;
  const hooks = () => react.render(() => useTerminalDrawerIntent({ enabled: currentEnabled, onRequestFocusAnchor: () => { focusHits++; } }));
  hooks(); // first mount registers effects
  return { hooks, setEnabled(v) { currentEnabled = v; return hooks(); } };
}

test("hover opens after the intent delay and leaves close it after the close delay", () => {
  const s = setup();
  s.hooks().anchorProps.onPointerEnter();
  assert.deepEqual(pendingTimers().map((t) => t.ms), [TERMINAL_DRAWER_OPEN_DELAY_MS]);
  assert.equal(s.hooks().open, false);
  advance(TERMINAL_DRAWER_OPEN_DELAY_MS);
  assert.equal(s.hooks().open, true);
  assert.equal(s.hooks().pinned, false);
  s.hooks().anchorProps.onPointerLeave();
  assert.equal(s.hooks().open, true); // still closing
  advance(TERMINAL_DRAWER_CLOSE_DELAY_MS);
  assert.equal(s.hooks().open, false);
});

test("hover that leaves before the open delay never opens", () => {
  const s = setup();
  s.hooks().anchorProps.onPointerEnter();
  s.hooks().anchorProps.onPointerLeave();
  advance(TERMINAL_DRAWER_OPEN_DELAY_MS + TERMINAL_DRAWER_CLOSE_DELAY_MS);
  assert.equal(s.hooks().open, false);
  assert.deepEqual(pendingTimers(), []);
});

test("content hover keeps a transient drawer open; leaving starts the close again", () => {
  const s = setup();
  s.hooks().anchorProps.onPointerEnter(); advance(TERMINAL_DRAWER_OPEN_DELAY_MS);
  s.hooks().anchorProps.onPointerLeave(); // schedules close
  s.hooks().contentProps.onPointerEnter(); // cancels close
  advance(TERMINAL_DRAWER_CLOSE_DELAY_MS);
  assert.equal(s.hooks().open, true);
  s.hooks().contentProps.onPointerLeave();
  advance(TERMINAL_DRAWER_CLOSE_DELAY_MS);
  assert.equal(s.hooks().open, false);
});

test("clicking a hover-open drawer pins it instead of closing it", () => {
  const s = setup();
  s.hooks().anchorProps.onPointerEnter();
  advance(TERMINAL_DRAWER_OPEN_DELAY_MS);
  assert.equal(s.hooks().open, true);
  s.hooks().anchorProps.onClick();
  assert.equal(s.hooks().pinned, true);
  s.hooks().anchorProps.onPointerLeave();
  advance(TERMINAL_DRAWER_CLOSE_DELAY_MS * 2);
  assert.equal(s.hooks().open, true);
});

test("click pins the drawer so pointer leave keeps it open; clicking again closes", () => {
  const s = setup();
  s.hooks().anchorProps.onClick();
  assert.equal(s.hooks().open, true);
  assert.equal(s.hooks().pinned, true);
  s.hooks().anchorProps.onPointerLeave(); // pinned => no close scheduled
  s.hooks().contentProps.onPointerLeave();
  assert.deepEqual(pendingTimers(), []);
  advance(TERMINAL_DRAWER_CLOSE_DELAY_MS * 3);
  assert.equal(s.hooks().open, true);
  assert.equal(s.hooks().pinned, true);
  s.hooks().anchorProps.onClick(); // toggle closes and unpins
  assert.equal(s.hooks().open, false);
  assert.equal(s.hooks().pinned, false);
});

test("keyboard Enter/Space/ArrowDown opens pinned; Escape closes and refocuses the anchor", () => {
  const s = setup();
  for (const key of ["Enter", " ", "ArrowDown"]) {
    let prevented = 0;
    s.hooks().anchorProps.onKeyDown({ key, preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(s.hooks().open, true);
    assert.equal(s.hooks().pinned, true);
  }
  let stop = 0;
  s.hooks().contentProps.onKeyDown({ key: "Escape", stopPropagation() { stop++; } });
  assert.equal(stop, 1);
  assert.equal(s.hooks().open, false);
  assert.equal(focusHits, 1);
});

test("hover-intent fires once when the pointer re-enters before the first timer resolves", () => {
  const s = setup();
  s.hooks().anchorProps.onPointerEnter();
  s.hooks().anchorProps.onPointerEnter();
  assert.equal(pendingTimers().length, 1);
  advance(TERMINAL_DRAWER_OPEN_DELAY_MS);
  assert.equal(s.hooks().open, true);
  assert.equal(pendingTimers().length, 0);
});

test("disabling the trigger closes an open drawer and blocks hover/click/keyboard reopening", () => {
  const s = setup();
  s.hooks().anchorProps.onClick();
  assert.equal(s.hooks().open, true);
  s.setEnabled(false);
  // Re-render after the disabling effect ran: the mock returns state captured before effects mutate.
  assert.equal(s.hooks().open, false);
  assert.equal(s.hooks().pinned, false);
  s.hooks().anchorProps.onPointerEnter();
  s.hooks().anchorProps.onClick();
  let prevented = 0;
  s.hooks().anchorProps.onKeyDown({ key: "Enter", preventDefault() { prevented++; } });
  assert.equal(prevented, 0); // disabled must pass keyboard through so the terminal keeps focus
  advance(TERMINAL_DRAWER_OPEN_DELAY_MS * 3);
  assert.equal(s.hooks().open, false);
  assert.deepEqual(pendingTimers(), []);
});

test("unmount clears pending open/close timers", () => {
  const s = setup();
  s.hooks().anchorProps.onPointerEnter();
  assert.equal(pendingTimers().length, 1);
  react.runCleanups(); // cleanup effect calls window.clearTimeout on the pending timer
  assert.equal(pendingTimers().length, 0);
});
