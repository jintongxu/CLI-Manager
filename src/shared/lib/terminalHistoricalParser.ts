import type { Terminal } from "@xterm/xterm";
import { createTerminalColorQueryFilter } from "./terminalColorQueryFilter";

/** Compatibility boundary: @xterm/xterm 6.1.0-beta.288, pinned in package.json.
 * InputHandler.parse is re-entered by WriteBuffer for every async continuation.
 * CoreService is the last common data/binary producer before public origin erasure.
 * Private access is confined here, checked at installation, never silently bypassed.
 */
type Parse = (data: string | Uint8Array, promiseResult?: boolean) => void | Promise<boolean>;
interface ParserShape {
  initialState: number;
  currentState: number;
  _transitions: { table: Uint16Array };
}
interface CoreShape {
  _inputHandler: { parse: Parse; _parser: ParserShape };
  coreService: {
    triggerDataEvent(data: string, wasUserInput?: boolean): void;
    triggerBinaryEvent(data: string): void;
  };
}
export type TerminalOutputOrigin = "history" | "live";
export type NormalizeTerminalOriginOutput = (data: string, origin: TerminalOutputOrigin) => string;
interface OriginOwner {
  write(data: string, origin: TerminalOutputOrigin, callback?: () => void, normalize?: NormalizeTerminalOriginOutput, isCurrent?: () => boolean): void;
  canEmit(): boolean;
  hasPendingWrites(): boolean;
  isSnapshotSafe(): boolean;
  capturePermission(): () => boolean;
  isProtocolEmission(): boolean;
  reset(): void;
}
const owners = new WeakMap<Terminal, OriginOwner>();
const compatibilityError = () => new Error("Incompatible xterm historical parser adapter: expected @xterm/xterm 6.1.0-beta.288");
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function checkedCore(terminal: Terminal): CoreShape {
  const candidate: unknown = terminal;
  if (!object(candidate) || !object(candidate._core)) throw compatibilityError();
  const core = candidate._core;
  const input = core._inputHandler;
  const service = core.coreService;
  if (!object(input) || typeof input.parse !== "function" || !object(input._parser)
    || !object(service) || typeof service.triggerDataEvent !== "function"
    || typeof service.triggerBinaryEvent !== "function") throw compatibilityError();
  const parser = input._parser;
  if (parser.initialState !== 0 || typeof parser.currentState !== "number"
    || !object(parser._transitions) || !(parser._transitions.table instanceof Uint16Array)
    || parser._transitions.table.length !== 4257) throw compatibilityError();
  // Only this exact, runtime-validated private shape crosses the integration boundary.
  return core as unknown as CoreShape;
}

/** Cold static snapshots belong to a different process. Do not inherit input reports.
 * Keep all drawing, alternate-buffer, cursor, SGR and unrelated modes intact.
 */
export const coldSnapshotInputModeReset = "\x1b[?9;1000;1002;1003;1004;1005;1006;1015;1016l";

/** Snapshot barriers must not serialize a partially parsed async chunk. */
export function hasPendingTerminalWrites(terminal: Terminal): boolean {
  return owners.get(terminal)?.hasPendingWrites() ?? false;
}
export function isTerminalSnapshotParserSafe(terminal: Terminal): boolean {
  return owners.get(terminal)?.isSnapshotSafe() ?? checkedCore(terminal)._inputHandler._parser.currentState === 0;
}
export function canEmitTerminalProtocol(terminal: Terminal): boolean {
  return owners.get(terminal)?.canEmit() ?? true;
}
export function isTerminalProtocolEmission(terminal: Terminal): boolean {
  return owners.get(terminal)?.isProtocolEmission() ?? false;
}
export function captureTerminalProtocolPermission(terminal: Terminal): () => boolean {
  return owners.get(terminal)?.capturePermission() ?? (() => true);
}
export function resetTerminalOutputOrigin(terminal: Terminal): void {
  owners.get(terminal)?.reset();
}
export function writeTerminalOutput(
  terminal: Terminal, data: string, origin: TerminalOutputOrigin, callback?: () => void,
  normalize?: NormalizeTerminalOriginOutput, isCurrent?: () => boolean,
): void {
  const owner = owners.get(terminal);
  if (!owner) throw compatibilityError();
  owner.write(data, origin, callback, normalize, isCurrent);
}

export function installTerminalHistoricalParser(terminal: Terminal, canAcceptInput: () => boolean = () => true): { dispose(): void } {
  if (owners.has(terminal)) throw new Error("xterm historical parser adapter already installed");
  const core = checkedCore(terminal);
  const input = core._inputHandler;
  const parser = input._parser;
  const service = core.coreService;
  const parse = input.parse;
  const dataEvent = service.triggerDataEvent;
  const binaryEvent = service.triggerBinaryEvent;
  const write = terminal.write;
  const fifo: { origin: TerminalOutputOrigin; data: string | Uint8Array; isCurrent?: () => boolean }[] = [];
  let protocolEmission = false;
  let executing: TerminalOutputOrigin | undefined;
  let executingIsCurrent: (() => boolean) | undefined;
  let queuedState = parser.currentState;
  let carryHistory = false;
  let wrapperPrefix = "";
  let tmux = false;
  let tmuxEscape = false;
  let disposed = false;
  let submitting = false;
  let pendingCommits = 0;
  const submissions: (() => void)[] = [];
  const colorQueries = createTerminalColorQueryFilter();

  // Partition only at the end of a historical carry into a live chunk. Derive
  // states from xterm's installed VT500 table, not a parallel query whitelist.
  // OSC/DCS/APC ESC terminators enter ESCAPE (matching EscapeSequenceParser.parse).
  function segments(text: string, origin: TerminalOutputOrigin) {
    const result: { data: string; origin: TerminalOutputOrigin }[] = [];
    let start = 0;
    let segmentOrigin = carryHistory ? "history" as const : origin;
    let offset = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      const transition = parser._transitions.table[(queuedState << 8) | Math.min(code, 0xa0)];
      const action = transition >> 8;
      let next = transition & 255;
      if (code === 0x1b && [6, 14, 17].includes(action)) next |= 1;
      // The production normalizer unwraps tmux DCS before xterm. Its doubled
      // ESC payload must not end the RAW provenance carry at an inner CSI.
      if (tmux) {
        next = 13;
        if (tmuxEscape && code === 0x5c) { next = 0; tmux = false; tmuxEscape = false; }
        else if (tmuxEscape && code === 0x1b) tmuxEscape = false;
        else tmuxEscape = code === 0x1b;
      } else {
        wrapperPrefix = code === 0x1b ? "" : wrapperPrefix + char;
        if (!"Ptmux;".startsWith(wrapperPrefix)) wrapperPrefix = "";
        if (wrapperPrefix === "Ptmux;") { tmux = true; wrapperPrefix = ""; next = 13; }
      }
      if (origin === "history" && next !== 0) carryHistory = true;
      queuedState = next;
      offset += char.length;
      if (next === 0 && carryHistory) {
        carryHistory = false;
        if (origin === "live") {
          result.push({ data: text.slice(start, offset), origin: segmentOrigin });
          start = offset;
          segmentOrigin = origin;
        }
      }
    }
    if (start < text.length || !text.length) result.push({ data: text.slice(start), origin: segmentOrigin });
    return result;
  }
  const owner: OriginOwner = {
    hasPendingWrites: () => fifo.length > 0 || submitting || pendingCommits > 0,
    // Raw provenance and the actual VT parser both matter: normalizers/filtering
    // can hold a prefix that has not reached xterm yet.
    isSnapshotSafe: () => parser.currentState === 0 && queuedState === 0 && !tmux
      && !wrapperPrefix && !colorQueries.hasPending(),
    isProtocolEmission: () => protocolEmission,
    canEmit: () => executing !== "history" && executingIsCurrent?.() !== false,
    capturePermission: () => {
      const historical = executing === "history";
      const isCurrent = executingIsCurrent;
      return () => !disposed && !historical && isCurrent?.() !== false;
    },
    reset: () => {
      queuedState = 0; carryHistory = false; wrapperPrefix = "";
      tmux = false; tmuxEscape = false; colorQueries.reset();
    },
    write: (text, origin, callback, normalize, isCurrent) => {
      if (disposed) throw compatibilityError();
      const parts = segments(text, origin).map(part => ({
        origin: part.origin, isCurrent, data: colorQueries.feed(normalize ? normalize(part.data, part.origin) : part.data, part.origin === "history"),
      }));
      // WriteBuffer may parse immediately after user input. Nested writes must
      // queue behind ALL pieces of this logical write, not between its tokens.
      submissions.push(() => {
        parts.forEach((part, index) => {
          fifo.push(part);
          write.call(terminal, part.data, () => {
            if (disposed) return;
            const token = fifo.shift();
            if (token !== part) throw new Error("xterm historical parser FIFO mismatch");
            // xterm advances WriteBuffer offset AFTER invoking its callback.
            // Consumer fit/resize synchronously flushes that buffer: defer only
            // the external commit to a microtask so it cannot reparse this token.
            if (index === parts.length - 1) {
              pendingCommits++;
              queueMicrotask(() => {
                try { if (!disposed) callback?.(); }
                finally { pendingCommits--; }
              });
            }
          });
        });
      });
      if (submitting) return;
      submitting = true;
      try { while (submissions.length) submissions.shift()!(); }
      finally { submitting = false; }
    },
  };
  input.parse = function (chunk, promiseResult) {
    if (disposed) return;
    const token = fifo[0];
    if (!token || token.data !== chunk) throw new Error("xterm write bypassed historical parser origin FIFO");
    const previous = executing;
    const previousIsCurrent = executingIsCurrent;
    executingIsCurrent = token.isCurrent;
    executing = token.isCurrent?.() === false ? "history" : token.origin;
    try { return parse.call(input, chunk, promiseResult); }
    finally { executing = previous; executingIsCurrent = previousIsCurrent; }
  };
  service.triggerDataEvent = function (data, wasUserInput) {
    if (disposed || (wasUserInput ? !canAcceptInput() : !owner.canEmit())) return;
    protocolEmission = !wasUserInput;
    try { dataEvent.call(service, data, wasUserInput); }
    finally { protocolEmission = false; }
  };
  service.triggerBinaryEvent = function (data) {
    if (!disposed && canAcceptInput() && owner.canEmit()) binaryEvent.call(service, data);
  };
  // Every ordinary write, including addon/controller writes, receives a live
  // token. Historical callers must use writeTerminalOutput explicitly.
  terminal.write = (data, callback) => {
    if (typeof data === "string") owner.write(data, "live", callback);
    else throw new Error("xterm adapter expects decoded string output; decode bytes with stream provenance first");
  };
  owners.set(terminal, owner);
  return { dispose() {
    if (disposed) return;
    disposed = true;
    owners.delete(terminal);
    // Dispose with the terminal; queued writes must never resume without their
    // origin guard. Leave wrappers installed until terminal disposal cancels them.
    fifo.length = 0;
    submissions.length = 0;
  } };
}
