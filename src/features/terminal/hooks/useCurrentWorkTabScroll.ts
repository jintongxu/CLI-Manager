import { useCallback, useEffect, useRef, useState } from "react";
import { attachTerminalTabWheelScroll } from "../lib/terminalTabWheelScroll";

export function useCurrentWorkTabScroll(enabled: boolean, activeId: string | null, signature: string) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelWheelScrollRef = useRef<(() => void) | null>(null);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });
  const update = useCallback(() => {
    const element = scrollRef.current;
    const max = element ? Math.max(0, element.scrollWidth - element.clientWidth) : 0;
    const left = element ? Math.max(0, element.scrollLeft) : 0;
    const next = { canScrollLeft: left > 1, canScrollRight: left < max - 1 };
    setScrollState((current) => current.canScrollLeft === next.canScrollLeft && current.canScrollRight === next.canScrollRight
      ? current : next);
  }, []);

  const scrollTabs = useCallback((direction: -1 | 1) => {
    const element = scrollRef.current;
    if (!element) return;
    cancelWheelScrollRef.current?.();
    element.scrollBy({ left: direction * Math.max(160, element.clientWidth * 0.72), behavior: "smooth" });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element) {
      update();
      return;
    }
    let frame: number | null = null;
    const revealActive = () => {
      const active = Array.from(element.querySelectorAll<HTMLElement>("[data-current-work-session-id]"))
        .find((node) => node.dataset.currentWorkSessionId === activeId);
      if (!active) return;
      const viewport = element.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      const left = viewport.left + element.clientLeft;
      const delta = rect.width > element.clientWidth || rect.left < left ? rect.left - left
        : rect.right > left + element.clientWidth ? rect.right - left - element.clientWidth : 0;
      element.scrollLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + delta));
    };
    const scheduleUpdate = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    const wheelScroll = attachTerminalTabWheelScroll(element, scheduleUpdate);
    cancelWheelScrollRef.current = wheelScroll.cancel;
    const handleResize = () => {
      wheelScroll.cancel();
      revealActive();
      scheduleUpdate();
    };
    revealActive();
    scheduleUpdate();
    element.addEventListener("scroll", scheduleUpdate, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(handleResize);
    observer?.observe(element);
    element.querySelectorAll<HTMLElement>("[data-current-work-session-id]").forEach((node) => observer?.observe(node));
    return () => {
      wheelScroll.dispose();
      cancelWheelScrollRef.current = null;
      element.removeEventListener("scroll", scheduleUpdate);
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [enabled, activeId, signature, update]);

  return { scrollRef, scrollState, scrollTabs };
}
