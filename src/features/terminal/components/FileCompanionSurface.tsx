import { toast } from "sonner";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useFileCompanionStore } from "../api/fileCompanionState";
import { setFileCompanionFocused } from "../api/fileCompanionFocus";
import { useTerminalStore } from "../state";
import { useFileExplorerStore } from "../../files/api/fileExplorerStore";
import { isSameProjectFileContext } from "../api/terminalProject";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { clampFileCompanionRatio } from "../../../shared/preferences/fileCompanion";
import { useI18n } from "../../../shared/i18n/index";
import { FileEditorPane } from "./lazyTerminalPanels";

/** One stable editor/controller beside the canonical terminal owners; never owns a PTY. */
export function FileCompanionSurface({ children, hasTerminal, visible, background }: {
  children: ReactNode; hasTerminal: boolean; visible: boolean; background: string;
}) {
  const { t } = useI18n();
  const companion = useFileCompanionStore();
  const session = useTerminalStore((state) => state.sessions.find((item) => item.id === companion.sessionId));
  const project = useFileExplorerStore((state) => state.project);
  const savedRatio = useSettingsStore((state) => state.fileCompanionPrimaryRatio);
  const [draftRatio, setDraftRatio] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(1000);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; start: number } | null>(null);
  const sameContext = isSameProjectFileContext(project, companion.project);
  const shown = companion.open && Boolean(session) && sameContext;
  const full = companion.mode === "current" || !hasTerminal;
  const ratio = draftRatio ?? savedRatio;
  // Physical clamping is display-only: restoring a wide window restores the logical preference.
  const minimum = Math.min(0.45, 240 / Math.max(width, 1));
  const renderedRatio = Math.max(minimum, Math.min(1 - minimum, ratio));
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!sameContext && companion.open) companion.collapse();
  }, [sameContext, companion.open, companion.collapse]);
  useEffect(() => {
    if (!shown || !visible) { setFocused(false); setFileCompanionFocused(false); }
  }, [shown, visible]);
  const persist = (value: number) => {
    void useSettingsStore.getState().update("fileCompanionPrimaryRatio", clampFileCompanionRatio(value))
      .catch(() => toast.error(t("terminal.companion.ratioSaveFailed")));
  };
  const cancelDrag = () => { dragRef.current = null; setDraftRatio(null); };
  return <div ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-file-companion-surface>
    <div className="relative min-h-0 min-w-0 overflow-hidden" style={{
      flex: shown && !full ? `0 0 ${renderedRatio * 100}%` : "1 1 0%",
      display: shown && full ? "none" : undefined,
    }} onPointerDownCapture={() => { setFocused(false); setFileCompanionFocused(false); }}>
      {children}
    </div>
    {shown && !full && <div role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={t("terminal.companion.resize")} aria-valuemin={15} aria-valuemax={85}
      aria-valuenow={Math.round(ratio * 100)}
      className="z-10 w-1 shrink-0 cursor-col-resize touch-none bg-border focus:outline focus:outline-1"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { id: event.pointerId, start: savedRatio };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraftRatio(savedRatio);
      }} onPointerMove={(event) => {
        if (dragRef.current?.id !== event.pointerId) return;
        const rect = containerRef.current!.getBoundingClientRect();
        setDraftRatio(clampFileCompanionRatio((event.clientX - rect.left) / rect.width));
      }} onPointerUp={(event) => {
        if (dragRef.current?.id !== event.pointerId) return;
        persist(draftRatio ?? dragRef.current.start);
        cancelDrag();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); cancelDrag(); return; }
        const next = event.key === "ArrowLeft" ? ratio - 0.02 : event.key === "ArrowRight" ? ratio + 0.02
          : event.key === "Home" ? 0.15 : event.key === "End" ? 0.85 : null;
        if (next === null) return;
        event.preventDefault(); persist(next);
      }} />}
    <section data-file-companion="true" aria-label={t("terminal.companion.title")}
      className="min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      style={{ display: shown ? "flex" : "none" }}
      onPointerDownCapture={() => { setFocused(true); setFileCompanionFocused(true); }}
      onFocusCapture={() => { setFocused(true); setFileCompanionFocused(true); }}
      onBlurCapture={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false); setFileCompanionFocused(false);
        }
      }}>
      <div className="min-h-0 flex-1">
        {session && <Suspense fallback={null}><FileEditorPane session={session} companion
          isActive={visible && shown && focused} terminalThemeBackground={background}
          onClose={companion.collapse} /></Suspense>}
      </div>
    </section>
  </div>;
}
