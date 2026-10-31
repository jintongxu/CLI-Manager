import { normalizeRect, type CropBounds } from "./crop";

export type Handle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export const HANDLES: Handle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
export interface Point { x: number; y: number }
export interface Viewport { width: number; height: number }
export const MIN_SELECTION = 8;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

export function selectionGeometry(mode: "draw" | "move" | Handle, start: Point, end: Point,
  initial: CropBounds | null, view: Viewport): CropBounds {
  const point = { x: clamp(end.x, 0, view.width), y: clamp(end.y, 0, view.height) };
  if (mode === "draw" || !initial) {
    return normalizeRect(clamp(start.x, 0, view.width), clamp(start.y, 0, view.height), point.x, point.y);
  }
  const dx = end.x - start.x, dy = end.y - start.y;
  if (mode === "move") return { ...initial,
    x: clamp(initial.x + dx, 0, view.width - initial.width),
    y: clamp(initial.y + dy, 0, view.height - initial.height) };
  let { x, y, width, height } = initial;
  const right = x + width, bottom = y + height;
  if (mode.includes("w")) x = clamp(x + dx, 0, right - MIN_SELECTION);
  if (mode.includes("n")) y = clamp(y + dy, 0, bottom - MIN_SELECTION);
  width = mode.includes("e") ? clamp(right + dx, x + MIN_SELECTION, view.width) - x : right - x;
  height = mode.includes("s") ? clamp(bottom + dy, y + MIN_SELECTION, view.height) - y : bottom - y;
  return { x, y, width, height };
}

/** Pointer ownership and latest geometry are synchronous; React paints at most once per frame. */
export class SelectionInteraction {
  bounds: CropBounds | null = null;
  private drag: { id: number; mode: "draw" | "move" | Handle; start: Point; initial: CropBounds | null } | null = null;
  private frame: number | null = null;
  constructor(private paint: (bounds: CropBounds | null) => void,
    private schedule: (fn: FrameRequestCallback) => number = (fn) => window.requestAnimationFrame(fn),
    private unschedule: (id: number) => void = (id) => window.cancelAnimationFrame(id)) {}
  get dragging() { return this.drag !== null; }
  begin(id: number, point: Point, mode: "draw" | "move" | Handle, view: Viewport) {
    if (this.drag) return false;
    this.drag = { id, start: point, mode, initial: this.bounds };
    this.update(id, point, view);
    return true;
  }
  update(id: number, point: Point, view: Viewport) {
    const d = this.drag;
    if (!d || d.id !== id) return;
    this.bounds = selectionGeometry(d.mode, d.start, point, d.initial, view);
    if (this.frame === null) this.frame = this.schedule(() => { this.frame = null; this.paint(this.bounds); });
  }
  end(id: number, point: Point, view: Viewport) {
    if (this.drag?.id !== id) return;
    this.update(id, point, view);
    this.drag = null;
    if (this.bounds && (this.bounds.width < MIN_SELECTION || this.bounds.height < MIN_SELECTION)) this.bounds = null;
    this.flush();
  }
  cancel(id: number) {
    if (this.drag?.id !== id) return;
    this.bounds = this.drag.initial;
    this.drag = null;
    this.flush();
  }
  private flush() {
    if (this.frame !== null) this.unschedule(this.frame);
    this.frame = null;
    this.paint(this.bounds);
  }
  dispose() {
    if (this.frame !== null) this.unschedule(this.frame);
    this.frame = null;
    this.drag = null;
  }
}

/** Flip at the viewport edge, then clamp using the actual measured chrome dimensions. */
export function selectionChrome(rect: CropBounds, view: Viewport, size: Viewport, toolbar: boolean): Point {
  const preferredY = toolbar ? rect.y + rect.height + 8 : rect.y - size.height - 6;
  const flippedY = toolbar ? rect.y - size.height - 8 : rect.y + 6;
  const y = preferredY < 0 || preferredY + size.height > view.height ? flippedY : preferredY;
  return { x: clamp(toolbar ? rect.x + rect.width - size.width : rect.x, 0, Math.max(0, view.width - size.width)),
    y: clamp(y, 0, Math.max(0, view.height - size.height)) };
}
