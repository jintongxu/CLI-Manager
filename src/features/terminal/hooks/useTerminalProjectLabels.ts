import { useMemo } from "react";
import type { SshHost } from "../../../shared/types/index";
import type { ProjectTabLabels } from "../api/terminalProjectTabsModel";

export function useTerminalProjectLabels(
  t: (key: "terminal.context.unboundProject" | "terminal.context.anonymousPi" | "terminal.context.worktreeMissing") => string,
  sshHosts: SshHost[],
): ProjectTabLabels {
  return useMemo(() => ({
    unboundProject: t("terminal.context.unboundProject"),
    anonymousPi: t("terminal.context.anonymousPi"),
    missingWorktree: t("terminal.context.worktreeMissing"),
    sshHostNames: new Map(sshHosts.map((host) => [host.id, host.name])),
  }), [sshHosts, t]);
}
