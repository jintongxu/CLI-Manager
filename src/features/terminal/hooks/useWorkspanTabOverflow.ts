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
    if (draggingRef.current) return;
    const scroller = scrollRef.current;
    const viewport = scroller?.getBoundingClientRect();
    const isOverflowing = Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 1);
    const hiddenIds = scroller && viewport && isOverflowing
      ? Array.from(scroller.querySelectorAll<HTMLElement>("[data-workspan-id]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < viewport.left + 1 || rect.right > viewport.right - 1;
        }).map((node) => node.dataset.workspanId!).filter(Boolean)
      : [];
    setOverflow((current) => current.isOverflowing === isOverflowing && current.hiddenIds.join("|") === hiddenIds.join("|")
      ? current : { isOverflowing, hiddenIds });
  }, [draggingRef, scrollRef]);
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
    if (activeId) Array.from(scroller?.querySelectorAll<HTMLElement>("[data-workspan-id]") ?? [])
      .find((node) => node.dataset.workspanId === activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
