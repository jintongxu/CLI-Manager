import { useEffect, useRef, useState } from "react";
import { useXTermController } from "../hooks/useXTermController";
import { XTermView } from "./XTermView";
import type { Props } from "../types/xTermModel";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { createHiddenTerminalDisplayLifecycle } from "../lib/hiddenTerminalDisplayLifecycle";

export { HIDDEN_TERMINAL_DISPOSE_DELAY_MS } from "../lib/hiddenTerminalDisplayLifecycle";

/**
 * Keeps the PTY/session alive while allowing inactive displays to release the
 * xterm buffer and addons. The controller cleanup persists a snapshot before
 * this component is removed, and a later visible mount reattaches via replay.
 */
export function XTermTerminal(props: Props) {
  const lowMemoryMode = useSettingsStore((state) => state.lowMemoryMode);
  const [displayMounted, setDisplayMounted] = useState(true);
  const displayLifecycleRef = useRef<ReturnType<typeof createHiddenTerminalDisplayLifecycle> | null>(null);
  if (displayLifecycleRef.current === null) {
    displayLifecycleRef.current = createHiddenTerminalDisplayLifecycle(
      () => setDisplayMounted(false),
      () => setDisplayMounted(true),
    );
  }

  useEffect(() => {
    displayLifecycleRef.current?.update({ enabled: lowMemoryMode, visible: Boolean(props.isVisible) });
  }, [lowMemoryMode, props.isVisible]);

  useEffect(() => () => {
    displayLifecycleRef.current?.dispose();
  }, []);

  if (!displayMounted) return null;
  return <MountedXTermTerminal {...props} />;
}

function MountedXTermTerminal(props: Props) {
  return <XTermView {...useXTermController(props)} />;
}
