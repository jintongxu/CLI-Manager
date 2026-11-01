/** Latest non-empty workspace selection, exposed as a passive snapshot for UI hints. */
export const WORKSPACE_SELECTION_MAX = 8000;

interface WorkspaceSelection {
  sourceId: string | null;
  text: string;
}

let latest: WorkspaceSelection = { sourceId: null, text: "" };

export function recordWorkspaceSelection(sourceId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  latest = {
    sourceId,
    text: trimmed.length > WORKSPACE_SELECTION_MAX ? trimmed.slice(0, WORKSPACE_SELECTION_MAX) : trimmed,
  };
}

export function readWorkspaceSelection(): WorkspaceSelection {
  return latest;
}

export function clearWorkspaceSelection(sourceId?: string): void {
  if (sourceId && latest.sourceId !== sourceId) return;
  latest = { sourceId: null, text: "" };
}
