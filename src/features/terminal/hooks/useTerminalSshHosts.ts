import { useEffect } from "react";
import type { TerminalSession } from "../../../shared/types/index";
import { logError } from "../../../shared/platform/logger";
import { useSshHostStore } from "../../remote/api/sshHostStore";

export function useTerminalSshHosts(sessions: TerminalSession[]) {
  const hosts = useSshHostStore((state) => state.hosts);
  const loaded = useSshHostStore((state) => state.loaded);
  const fetchHosts = useSshHostStore((state) => state.fetchHosts);

  useEffect(() => {
    if (!loaded && sessions.some((session) => session.environmentType === "ssh" && session.sshHostId)) {
      void fetchHosts().catch((error) => logError("Failed to load SSH hosts for terminal file context", error));
    }
  }, [fetchHosts, loaded, sessions]);

  return hosts;
}
