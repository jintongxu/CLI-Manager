import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { useSidebarShellStore } from "../store/sidebarShellStore";
import { XTermTerminal } from "./XTermTerminal";

/** One stable portal destination moves between the visible slot and a hidden
 * parking area. React never changes the parser's parent or portal key, even
 * when panel layout/dock mode replaces the slot. Every owner keeps consuming. */
export function SidebarShellHost({ target, contextKey, visible }: {
  target: HTMLElement | null;
  contextKey: string | null;
  visible: boolean;
}) {
  const owners = useSidebarShellStore(s => s.owners);
  const settings = useSettingsStore();
  const parking = useRef<HTMLDivElement>(null);
  const [surface] = useState(() => {
    const node = document.createElement("div");
    node.className = "relative h-full min-h-0 w-full";
    // The parser is portalled outside the panel; mark its actual DOM surface
    // so capture-phase workspace shortcuts cannot act on the main Pi session.
    node.setAttribute("data-sidebar-shell-surface", "");
    return node;
  });
  const [focused, setFocused] = useState(false);
  // Revealing another context or slot must not inherit the previous keyboard
  // owner; only focus/pointer interaction in the shell can activate its input.
  useLayoutEffect(() => { setFocused(false); }, [visible, contextKey, target]);
  useLayoutEffect(() => {
    (target ?? parking.current)?.appendChild(surface);
    return () => { parking.current?.appendChild(surface); };
  }, [surface, target]);
  useEffect(() => {
    const trackFocus = (event: FocusEvent) => setFocused(surface.contains(event.target as Node));
    document.addEventListener("focusin", trackFocus);
    // Native window deactivation is not an internal focus transfer. Keeping
    // logical ownership avoids isActive=false forcing terminal.blur() on Alt-Tab.
    // A real focusin elsewhere (or a context/tab hide above) still deactivates.
    return () => {
      document.removeEventListener("focusin", trackFocus);
    };
  }, [surface]);
  return <>
    <div ref={parking} style={{ display: "none" }} aria-hidden="true" data-sidebar-shell-parking />
    {createPortal(Object.values(owners).filter(owner => owner.sessionId).map(owner => {
      const shown = visible && Boolean(target) && owner.context.key === contextKey;
      return <div key={owner.sessionId} className="absolute inset-0" style={{ display: shown ? "block" : "none" }}
        aria-hidden={!shown} onPointerDown={() => setFocused(true)}>
        <XTermTerminal sessionId={owner.sessionId!} isVisible={shown} isActive={shown && focused}
          minTerminalCols={8} fontSize={settings.fontSize} fontFamily={settings.fontFamily}
          resolvedTheme={settings.resolvedTheme}
          terminalThemeName={settings.terminalThemeName} lightThemePalette={settings.lightThemePalette}
          darkThemePalette={settings.darkThemePalette} />
      </div>;
    }), surface)}
  </>;
}
