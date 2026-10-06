import type { WorktreeRecord } from "../../../shared/types/index";
import { getWorktreeDisplayName } from "../api/worktreeMetadata";
import { useTreeActions, worktreeTerminalsCollapseId } from "./TreeContext";
import { SidebarTerminalList } from "./SidebarTerminalList";
import { WorktreeTerminalSummary } from "./WorktreeTerminalSummary";
import { WorktreeTerminalsToggle } from "./WorktreeTerminalsToggle";

/** Label-only Worktree shortcuts omit empty lists, but keep the label when folded. */
export function SidebarWorktreeTerminals({ projectId, worktree, depth = 1, compact = false }: {
  projectId: string; worktree: WorktreeRecord; depth?: number; compact?: boolean;
}) {
  const actions = useTreeActions();
  if (actions.getTerminals(projectId, worktree.id).length === 0) return null;
  return <div>
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-on-surface-variant">
      <span className="worktree-terminal-toggle-slot">
        <WorktreeTerminalsToggle worktreeId={worktree.id} />
      </span>
      <span className="worktree-terminal-heading">
        <span className="worktree-terminal-title-line">
          <span className="worktree-terminal-title truncate">{getWorktreeDisplayName(worktree)}</span>
        </span>
        <WorktreeTerminalSummary projectId={projectId} worktreeId={worktree.id} compact={compact} />
      </span>
    </div>
    {!actions.collapsedIds.has(worktreeTerminalsCollapseId(worktree.id)) && (
      <SidebarTerminalList projectId={projectId} worktreeId={worktree.id} depth={depth} compact={compact} />
    )}
  </div>;
}
