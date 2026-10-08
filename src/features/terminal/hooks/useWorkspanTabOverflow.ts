import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WorkspanTabOverflowState } from "../../workspace/api/WorkspanTabBar";

export function useWorkspanTabOverflow(
  barRef: RefObject<HTMLDivElement | null>, scrollRef: RefObject<HTMLDivElement | null>,
  draggingRef: RefObject<string | null>, enabled: boolean, activeId: string | null,
) {
  const [workspanTabListOpen, setWorkspanTabListOpen] = useState(false);
  const [workspanTabOverflow, setOverflow] = useState<WorkspanTabOverflowState>({ isOverflowing: false, hiddenIds: [] });
  const [signature, setSignature] = useState("");
  const frame = useRef<number | null>(null);
  const updateWorkspanTabOverflow = useCallback(() => {
    if (enabled && draggingRef.current) return;
    const scroller = scrollRef.current;
    const viewport = scroller?.getBoundingClientRect();
    const isOverflowing = Boolean(enabled && scroller && scroller.clientWidth > 0 && scroller.scrollWidth > scroller.clientWidth + 1);
    const hiddenIds = scroller && viewport && isOverflowing
      ? Array.from(scroller.querySelectorAll<HTMLElement>("[data-workspan-id]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const left = viewport.left + (scroller.clientLeft ?? 0);
          return rect.left < left - 1 || rect.right > left + scroller.clientWidth + 1;
        }).map((node) => node.dataset.workspanId!).filter(Boolean)
      : [];
    const uniqueHiddenIds = [...new Set(hiddenIds)];
    setOverflow((current) => current.isOverflowing === isOverflowing && current.hiddenIds.join("|") === uniqueHiddenIds.join("|")
      ? current : { isOverflowing, hiddenIds: uniqueHiddenIds });
  }, [draggingRef, enabled, scrollRef]);
  const onWorkspanRowChange = useCallback((next: string) => {
    setSignature(next);
    setWorkspanTabListOpen(false);
    setOverflow({ isOverflowing: false, hiddenIds: [] });
  }, []);
  useEffect(() => {
    const scroller = scrollRef.current;
    const schedule = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        updateWorkspanTabOverflow();
      });
    };
    if (enabled && !draggingRef.current && activeId && scroller && scroller.clientWidth > 0) {
      const node = Array.from(scroller.querySelectorAll<HTMLElement>("[data-workspan-id]"))
        .find((item) => item.dataset.workspanId === activeId);
      if (node) {
        const viewport = scroller.getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        const left = viewport.left + scroller.clientLeft;
        const delta = rect.width > scroller.clientWidth || rect.left < left ? rect.left - left
          : rect.right > left + scroller.clientWidth ? rect.right - left - scroller.clientWidth : 0;
        scroller.scrollLeft = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, scroller.scrollLeft + delta));
      }
    }
    schedule();
    scroller?.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (barRef.current) observer?.observe(barRef.current);
    if (scroller) {
      observer?.observe(scroller);
      scroller.querySelectorAll<HTMLElement>("[data-workspan-id]").forEach((node) => observer?.observe(node));
    }
    return () => {
      scroller?.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [activeId, barRef, enabled, scrollRef, signature, updateWorkspanTabOverflow]);
  useEffect(() => {
    if (!enabled || !workspanTabOverflow.hiddenIds.length) setWorkspanTabListOpen(false);
  }, [enabled, workspanTabOverflow.hiddenIds.length]);
  return { workspanTabListOpen, setWorkspanTabListOpen, workspanTabOverflow, updateWorkspanTabOverflow, onWorkspanRowChange };
}
