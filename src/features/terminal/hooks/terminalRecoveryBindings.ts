import { resolveRecoveryEnvironment } from "../lib/terminalRecoveryEnvironment";
import { resolveShellForPty } from "../lib/terminalLaunch";
import { getOsPlatform } from "../../../shared/platform/shell";
import { useProjectStore } from "../../projects/api/projectStore";
import { useTerminalStore } from "../state";
import type { TerminalSession } from "../../../shared/types/index";

/** Live reads shared by pane and navigation handlers, including the confirmation window. */
export const terminalRecoveryBindings = {
  getSession: (id: string) => useTerminalStore.getState().sessions.find(item => item.id === id),
  isBusy: (id: string) => Boolean(useTerminalStore.getState().recoveryBusy[id]),
  setBusy: (id: string, busy: boolean) => {
    const recoveryBusy = { ...useTerminalStore.getState().recoveryBusy };
    if (busy) recoveryBusy[id] = true; else delete recoveryBusy[id];
    useTerminalStore.setState({ recoveryBusy });
  },
  resolveContext: async (session: TerminalSession) => {
    const resolved = resolveRecoveryEnvironment(session, useProjectStore.getState());
    const shell = resolveShellForPty(resolved.shell, Boolean(resolved.projectId), await getOsPlatform());
    return {
      cwd: resolved.cwd,
      environment: `${shell ?? "system shell"} · ${resolved.shell === "wsl" ? "wsl" : session.environmentType ?? "local"} · ${session.wslDistroName ?? ""}`,
      signature: JSON.stringify(resolved),
    };
  },
};
