import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { orderProjectWorktrees } from "../api/worktreeOrder";
import { useProjectStore } from "../api/projectStore";
import { SidebarWorktreeTerminals } from "./SidebarWorktreeTerminals";
import { SidebarTerminalList } from "./SidebarTerminalList";

/** Pinned/narrow shortcuts carry Project only, so read linked Worktrees from the canonical project store. */
export function SidebarProjectTerminals({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const worktrees = useProjectStore((s) => s.worktrees);
  const order = useSettingsStore((s) => s.worktreeOrderByProject);
  return <>
    <SidebarTerminalList projectId={projectId} depth={1} compact={compact} />
    {orderProjectWorktrees(worktrees, projectId, order).map((worktree) => (
      <SidebarWorktreeTerminals key={worktree.id} projectId={projectId} worktree={worktree} compact={compact} />
    ))}
  </>;
}
