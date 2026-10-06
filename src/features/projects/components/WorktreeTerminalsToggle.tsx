import type { SyntheticEvent } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { ChevronRight } from "../../../shared/ui/icons";
import { useTreeActions, worktreeTerminalsCollapseId } from "./TreeContext";

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

/** Native button activation owns Enter/Space; key handlers only isolate tree shortcuts. */
export function WorktreeTerminalsToggle({ worktreeId }: { worktreeId: string }) {
  const { t } = useI18n();
  const actions = useTreeActions();
  const key = worktreeTerminalsCollapseId(worktreeId);
  const expanded = !actions.collapsedIds.has(key);
  const label = t(expanded ? "sidebar.terminals.collapseWorktree" : "sidebar.terminals.expandWorktree");
  return (
    <button
      type="button"
      className="ui-tree-chevron ui-focus-ring inline-flex shrink-0 items-center justify-center"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        actions.toggleCollapsed(key);
      }}
      onDoubleClick={stopPropagation}
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
      onFocus={stopPropagation}
      onKeyDown={stopPropagation}
      onKeyUp={stopPropagation}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <ChevronRight size={12} strokeWidth={2} aria-hidden="true"
        style={{ transition: "transform 150ms", transform: expanded ? "rotate(90deg)" : "rotate(0)" }} />
    </button>
  );
}
