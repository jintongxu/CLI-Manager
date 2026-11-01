import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useChatPanelStore } from "../store/chatPanelStore";

export const CHAT_FLOAT_WIDTH = 380;
const HEIGHT_RATIO = 0.8;
const EDGE = 12;
const KEY_STEP = 16;

export interface ChatFloatGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

function geometryFor(size: Size, position: { x: number; y: number } | null): ChatFloatGeometry {
  const width = Math.min(CHAT_FLOAT_WIDTH, Math.max(240, size.width - EDGE * 2));
  const height = Math.max(200, Math.round(size.height * HEIGHT_RATIO));
  const maxX = Math.max(0, size.width - width);
  const maxY = Math.max(0, size.height - height);
  const fallback = { x: Math.max(0, maxX - EDGE), y: EDGE };
  const wanted = position ?? fallback;
  return {
    x: Math.min(maxX, Math.max(0, Math.round(wanted.x))),
    y: Math.min(maxY, Math.max(0, Math.round(wanted.y))),
    width,
    height,
  };
}

/** Free drag for the floating chat panel, clamped to the workspace container. */
export function useChatPanelDrag(containerRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const stored = useChatPanelStore((s) => s.floatPosition);
  const setFloatPosition = useChatPanelStore((s) => s.setFloatPosition);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, enabled]);

  const geometry = useMemo(
    () => geometryFor(size.width && size.height ? size : { width: 0, height: 0 }, live ?? stored),
    [live, size, stored],
  );

  const moveTo = useCallback((x: number, y: number) => {
    setLive(geometryFor(size, { x, y }));
  }, [size]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    origin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: geometry.x,
      y: geometry.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setLive({ x: geometry.x, y: geometry.y });
  }, [enabled, geometry.x, geometry.y]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragging) return;
    moveTo(
      origin.current.x + (event.clientX - origin.current.pointerX),
      origin.current.y + (event.clientY - origin.current.pointerY),
    );
  }, [dragging, moveTo]);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setLive((current) => {
      if (current) setFloatPosition({ x: current.x, y: current.y });
      return null;
    });
  }, [dragging, setFloatPosition]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    const delta = event.key === "ArrowLeft" ? [-KEY_STEP, 0]
      : event.key === "ArrowRight" ? [KEY_STEP, 0]
        : event.key === "ArrowUp" ? [0, -KEY_STEP]
          : event.key === "ArrowDown" ? [0, KEY_STEP]
            : null;
    if (!delta) return;
    event.preventDefault();
    const next = geometryFor(size, { x: geometry.x + delta[0], y: geometry.y + delta[1] });
    setFloatPosition({ x: next.x, y: next.y });
  }, [enabled, geometry.x, geometry.y, setFloatPosition, size]);

  return { geometry, dragging, handlePointerDown, handlePointerMove, finish, handleKeyDown };
}
