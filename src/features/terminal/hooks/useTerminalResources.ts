import { useLayoutEffect, useRef, useState } from "react";
import { getTerminalResources } from "../api/terminalResources";
import { terminalProcessManager } from "../api/TerminalProcessManager";
import { createTerminalResourcePoller, type ResourcePollState } from "../lib/terminalResourcePolling";

export function useTerminalResources(active: boolean, sessionIds: readonly string[], identity: string) {
  const [state, setState] = useState<ResourcePollState>({ snapshot: null, error: null, loading: false });
  const [transportGeneration, setTransportGeneration] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === "visible");
  const poller = useRef<ReturnType<typeof createTerminalResourcePoller> | null>(null);
  if (!poller.current) poller.current = createTerminalResourcePoller(getTerminalResources, setState);
  const idsKey = JSON.stringify(sessionIds);
  useLayoutEffect(() => {
    const visibility = () => {
      const visible = document.visibilityState === "visible";
      // Invalidate synchronously, before React can commit a queued result.
      if (!visible) poller.current!.configure(false, [], "document-hidden");
      setDocumentVisible(visible);
      setTransportGeneration((value) => value + 1);
    };
    const disconnect = terminalProcessManager.subscribeDisconnect(() => {
      poller.current!.configure(false, [], "transport-disconnected");
      setTransportGeneration((value) => value + 1);
    });
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); disconnect(); };
  }, []);
  useLayoutEffect(() => {
    poller.current!.configure(active && documentVisible && document.visibilityState === "visible", JSON.parse(idsKey), `${identity}:${transportGeneration}`);
    return () => poller.current!.dispose();
  }, [active, documentVisible, idsKey, identity, transportGeneration]);
  return { ...state, refresh: () => poller.current!.refresh() };
}
