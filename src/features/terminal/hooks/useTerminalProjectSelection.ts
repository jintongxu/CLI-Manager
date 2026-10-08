import { useCallback, useEffect, useRef } from "react";
import type { ProjectWorkspanTabModel } from "../lib/workspanTabModel";
import { resolveProjectWorkspanTarget, type ProjectWorkspanTarget } from "../api/terminalProjectTabsModel";
import { resolveActiveProjectTarget } from "../api/terminalProjectSelection";

// Window-local only: never writes preferences or workspace snapshots.
export function useTerminalProjectSelection(
  models: ProjectWorkspanTabModel[], activeSessionId: string | null,
  activate: (workspanId: string, sessionId?: string) => void,
) {
  const recent = useRef(new Map<string, ProjectWorkspanTarget>());
  const active = resolveActiveProjectTarget(models, activeSessionId);
  const selectedProjectKey = active?.projectKey ?? models[0]?.projectKeys[0] ?? null;
  useEffect(() => {
    if (active) recent.current.set(active.projectKey, active.target);
  }, [active?.projectKey, active?.target.workspanId, active?.target.sessionId]);
  const activateProject = useCallback((key: string) => {
    const target = resolveProjectWorkspanTarget(models, key, recent.current.get(key));
    if (target) activate(target.workspanId, target.sessionId);
  }, [activate, models]);
  const activateWorkspanTab = useCallback((id: string, sessionId?: string) => {
    const model = models.find((item) => item.workspan.id === id);
    if (sessionId && model?.members.some((member) => member.sessionId === sessionId)) {
      activate(id, sessionId);
      return;
    }
    const target = selectedProjectKey
      ? resolveProjectWorkspanTarget(model ? [model] : [], selectedProjectKey, recent.current.get(selectedProjectKey))
      : null;
    activate(id, target?.sessionId);
  }, [activate, models, selectedProjectKey]);
  return { selectedProjectKey, activateProject, activateWorkspanTab };
}
