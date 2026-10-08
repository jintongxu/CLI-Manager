import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";

/** Pinned xterm 6.1.0-beta.288 / serialize 0.15 compatibility boundary.
 * SerializeAddon omits mouse encoding and Kitty stacks, and DECSTBM moves the
 * cursor after the addon's cursor restoration. Preserve these for live hydration.
 */
export function serializeTerminalContinuationImage(terminal: Terminal, addon: SerializeAddon, options?: { scrollback: number }): string {
  const image = addon.serialize(options);
  if (terminal.buffer.active.type !== "alternate") return image;
  const marker = "\x1b[?1049h\x1b[H";
  const split = image.indexOf(marker);
  if (split < 0) throw new Error("Incompatible xterm serialize alternate-buffer marker");
  const core = (terminal as unknown as { _core: {
    _inputHandler: { _curAttrData: unknown };
    _bufferService: { buffers: { normal: { savedCurAttrData: unknown; scrollTop: number; scrollBottom: number } } };
  } })._core;
  const current = core._inputHandler._curAttrData;
  const saved = core._bufferService.buffers.normal.savedCurAttrData;
  if (!current || !saved) throw new Error("Incompatible xterm saved cursor attributes");
  let normal: string;
  try {
    core._inputHandler._curAttrData = saved;
    normal = addon.serialize({ ...options, excludeAltBuffer: true, excludeModes: true });
  } finally { core._inputHandler._curAttrData = current; }
  // Save normal cursor attributes BEFORE resetting the erase background. 1047
  // activates alt without overwriting that saved cursor; later 1049l restores it.
  const region = core._bufferService.buffers.normal;
  const normalRegion = region.scrollTop !== 0 || region.scrollBottom !== terminal.rows - 1
    ? `\x1b[${region.scrollTop + 1};${region.scrollBottom + 1}r` : "";
  const repairNormal = normalRegion ? restoreCursor(terminal, terminal.buffer.normal, region.scrollTop, false, saved) : "";
  return normal + normalRegion + repairNormal + "7[0m[?1047h[H" + image.slice(split + marker.length);
}

export function serializeTerminalContinuationModes(terminal: Terminal): { before: string; after: string } {
  const core = (terminal as unknown as { _core: {
    mouseStateService: { activeEncoding: string };
    coreService: { kittyKeyboard: { flags: number; mainFlags: number; altFlags: number; mainStack: number[]; altStack: number[] } };
    _bufferService: { buffer: { scrollTop: number; scrollBottom: number } };
  } })._core;
  const encoding = core?.mouseStateService?.activeEncoding;
  const kitty = core?.coreService?.kittyKeyboard;
  const region = core?._bufferService?.buffer;
  if (!["DEFAULT", "SGR", "SGR_PIXELS"].includes(encoding) || !kitty
    || ![kitty.flags, kitty.mainFlags, kitty.altFlags].every(Number.isSafeInteger)
    || ![kitty.mainStack, kitty.altStack].every(s => Array.isArray(s) && s.length <= 16 && s.every(Number.isSafeInteger))
    || !region || !Number.isSafeInteger(region.scrollTop)) {
    throw new Error("Incompatible xterm continuation modes: expected 6.1.0-beta.288");
  }
  const flags = (stack: number[], current: number) => stack.map(f => `\x1b[=${f}u\x1b[>0u`).join("") + `\x1b[=${current}u`;
  const alt = terminal.buffer.active.type === "alternate";
  // Set inactive-screen state before serializing drawing; screen switching swaps
  // flags. The active stack is restored after addon mode/screen restoration.
  const hasKitty = kitty.flags !== 0 || kitty.mainFlags !== 0 || kitty.altFlags !== 0 || kitty.mainStack.length > 0 || kitty.altStack.length > 0;
  const before = !hasKitty ? "" : alt
    ? flags(kitty.mainStack, kitty.mainFlags)
    : `\x1b[?1049h${flags(kitty.altStack, kitty.altFlags)}\x1b[?1049l`;
  const mouse = encoding === "SGR" ? "\x1b[?1006h" : encoding === "SGR_PIXELS" ? "\x1b[?1016h" : "";
  const current = (terminal as unknown as { _core: { _inputHandler: { _curAttrData: unknown } } })._core._inputHandler._curAttrData;
  const cursor = region.scrollTop !== 0 || region.scrollBottom !== terminal.rows - 1 || terminal.modes.originMode
    ? restoreCursor(terminal, terminal.buffer.active, region.scrollTop, terminal.modes.originMode, current) : "";
  return { before, after: mouse + (hasKitty ? flags(alt ? kitty.altStack : kitty.mainStack, kitty.flags) : "") + cursor };
}

/** CUP cannot address x===cols. Reprint the existing final cell (including its
 * own attributes), then restore current SGR without moving the cursor again. */
function restoreCursor(terminal: Terminal, buffer: Terminal["buffer"]["active"], scrollTop: number, origin: boolean, current: unknown): string {
  const row = buffer.cursorY + 1 - (origin ? scrollTop : 0);
  if (buffer.cursorX < terminal.cols) return `\x1b[${row};${buffer.cursorX + 1}H`;
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  let column = terminal.cols - 1;
  let cell = line?.getCell(column);
  if (cell?.getWidth() === 0) cell = line?.getCell(--column);
  if (!cell) throw new Error("Incompatible xterm pending-wrap cell");
  return `\x1b[${row};${column + 1}H` + attributeSgr(cell) + (cell.getChars() || " ") + attributeSgr(current as typeof cell);
}

function attributeSgr(a: NonNullable<ReturnType<Terminal["buffer"]["active"]["getNullCell"]>>): string {
  const codes = ["0"];
  for (const [enabled, code] of [[a.isBold(),1],[a.isDim(),2],[a.isItalic(),3],[a.isBlink(),5],[a.isInverse(),7],[a.isInvisible(),8],[a.isStrikethrough(),9],[a.isOverline(),53]]) {
    if (enabled) codes.push(String(code));
  }
  if (a.isUnderline()) codes.push(`4:${a.getUnderlineStyle()}`);
  const rgb = (n: number) => `${n >> 16 & 255};${n >> 8 & 255};${n & 255}`;
  if (a.isFgRGB()) codes.push(`38;2;${rgb(a.getFgColor())}`);
  else if (a.isFgPalette()) codes.push(`38;5;${a.getFgColor()}`);
  if (a.isBgRGB()) codes.push(`48;2;${rgb(a.getBgColor())}`);
  else if (a.isBgPalette()) codes.push(`48;5;${a.getBgColor()}`);
  if (a.isUnderlineColorRGB()) codes.push(`58:2::${rgb(a.getUnderlineColor()).replace(/;/g, ":")}`);
  else if (a.isUnderlineColorPalette()) codes.push(`58:5:${a.getUnderlineColor()}`);
  return `\x1b[${codes.join(";")}m`;
}
