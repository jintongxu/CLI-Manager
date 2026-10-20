import type { ResolvedPtyLaunch } from "../types/terminalStoreTypes";
import { useSshHostStore } from "../../remote/api/sshHostStore";

export function sshHostNameForLaunch(launch: ResolvedPtyLaunch): string | undefined {
  if (launch.environmentType !== "ssh" || !launch.sshHostId) return undefined;
  return useSshHostStore.getState().hosts.find((host) => host.id === launch.sshHostId)?.name;
}
