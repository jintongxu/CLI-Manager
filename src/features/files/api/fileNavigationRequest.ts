import { useEffect, useRef } from "react";
import type { Project } from "../../../shared/types/index";
import { useFileExplorerStore } from "./fileExplorerStore";
import { isSameProjectFileContext } from "../../terminal/api/terminalProject";

/** Fence the entire async navigation chain, including a context departure and return. */
export function useFileNavigationRequest() {
  const revision = useRef(0);
  const watching = useRef<(() => void) | null>(null);
  useEffect(() => () => { revision.current += 1; watching.current?.(); }, []);
  return (project: Project) => {
    const id = ++revision.current;
    watching.current?.();
    const unsubscribe = useFileExplorerStore.subscribe((state) => {
      if (!isSameProjectFileContext(state.project, project)) revision.current += 1;
    });
    watching.current = unsubscribe;
    return {
      current: () => id === revision.current && isSameProjectFileContext(useFileExplorerStore.getState().project, project),
      finish: unsubscribe,
    };
  };
}
