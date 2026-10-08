import type { Terminal } from "@xterm/xterm";

/** One display owner, with event-driven barriers. Rejected input is never queued. */
const states = new WeakMap<Terminal, { alive: boolean; epoch: number; hydrated: boolean; output: boolean; fitted: boolean }>();
export function beginTerminalContinuation(terminal: Terminal): void {
  states.set(terminal, { alive: true, epoch: 0, hydrated: false, output: false, fitted: false });
}
export function isTerminalContinuationHydrated(terminal: Terminal): boolean {
  const s = states.get(terminal);
  return s?.alive === true && s.hydrated && s.output;
}
export function canAcceptTerminalInput(terminal: Terminal): boolean {
  const s = states.get(terminal);
  return !!s && s.alive && s.hydrated && s.output && s.fitted;
}
export function captureTerminalInputPermission(terminal: Terminal): () => boolean {
  const s = states.get(terminal);
  const epoch = s?.epoch;
  const accepted = canAcceptTerminalInput(terminal);
  return () => accepted && states.get(terminal) === s && s?.epoch === epoch && canAcceptTerminalInput(terminal);
}
export function invalidateTerminalFit(terminal: Terminal): void {
  const s = states.get(terminal);
  if (s) { s.epoch++; s.fitted = false; }
}
export function suspendTerminalContinuation(terminal: Terminal): void {
  const s = states.get(terminal);
  if (s) { s.epoch++; s.output = false; s.fitted = false; }
}
export function markTerminalContinuation(terminal: Terminal, barrier: "hydrated" | "output" | "fitted"): void {
  const s = states.get(terminal);
  if (s?.alive) s[barrier] = true;
}
export function disposeTerminalContinuation(terminal: Terminal): void {
  const s = states.get(terminal);
  if (s) { s.alive = false; s.epoch++; }
}
