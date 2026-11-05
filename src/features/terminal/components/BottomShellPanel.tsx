import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { clampAuxiliaryTerminalHeight, normalizeAuxiliaryTerminalHeight } from "../../../shared/preferences/auxiliaryTerminal";
import { useI18n } from "../../../shared/i18n/index";
import { SidebarShellPanel } from "./SidebarShellPanel";

type Props = Parameters<typeof SidebarShellPanel>[0];
/** This frame is a center-column child; side panels are never resized/covered. */
export function BottomShellPanel({ visible, onCollapse, ...panel }: Omit<Props, "onCollapse" | "maximized" | "onToggleMaximize"> & {
  visible: boolean;
  onCollapse: () => void;
}) {
  const { t } = useI18n();
  const savedHeight = useSettingsStore(s => s.auxiliaryTerminalHeight);
  const [height, setHeight] = useState(savedHeight);
  const [available, setAvailable] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const currentHeight = useRef(height);
  const persist = (next: number) => {
    void useSettingsStore.getState().update("auxiliaryTerminalHeight", next)
      .catch(() => toast.error(t("terminal.shell.heightSaveFailed")));
  };
  const resize = (next: number) => {
    const value = normalizeAuxiliaryTerminalHeight(clampAuxiliaryTerminalHeight(next, available));
    currentHeight.current = value;
    setHeight(value);
    return value;
  };
  useLayoutEffect(() => { setHeight(savedHeight); currentHeight.current = savedHeight; }, [savedHeight]);
  useLayoutEffect(() => {
    const parent = frame.current?.parentElement;
    if (!parent) return;
    const measure = () => setAvailable(parent.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const displayedHeight = clampAuxiliaryTerminalHeight(height, available, maximized);
  return <div ref={frame} data-bottom-shell-panel data-maximized={maximized}
    className="relative min-h-0 shrink-0 overflow-hidden border-t border-white/10"
    style={{ height: displayedHeight, display: visible ? "block" : "none" }}>
    <div role="separator" tabIndex={0} aria-orientation="horizontal"
      aria-label={t("terminal.shell.resize")} aria-valuemin={Math.min(80, displayedHeight)}
      aria-valuemax={Math.max(displayedHeight, available - 80, 0)} aria-valuenow={displayedHeight}
      className="ui-focus-ring absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize touch-none"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height: displayedHeight };
        setMaximized(false);
      }}
      onPointerMove={event => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY); }}
      onPointerUp={event => {
        if (!drag.current) return;
        persist(currentHeight.current); drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; currentHeight.current = savedHeight; setHeight(savedHeight); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); setMaximized(false);
        persist(resize(event.key === "Home" ? 80 : event.key === "End" ? available - 80
          : displayedHeight + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 40 : 10)));
      }} />
    <SidebarShellPanel {...panel} onCollapse={onCollapse} maximized={maximized}
      onToggleMaximize={() => setMaximized(value => !value)} />
  </div>;
}
