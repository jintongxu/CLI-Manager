import type { ReactNode } from "react";
import type { TerminalNavigationEntry } from "../lib/terminalNavigationModel";
import { useI18n } from "../../../shared/i18n/index";
import { useSortable, SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DND_SORTABLE_TRANSITION, CURRENT_WORK_TAB_DRAG_PREFIX, TERMINAL_TAB_DRAG_PREFIX } from "../../workspace/api/dragInteraction";
import { buildTerminalTabContext } from "../lib/terminalTabsModel";
import { formatTerminalTabContext } from "../lib/currentWorkPresentation";

import { useCurrentWorkTabScroll } from "../hooks/useCurrentWorkTabScroll";

export interface TerminalTabRowProps {
  /** Single source of truth: exactly the entries the drawer counts. Row does no secondary filter. */
  entries: readonly TerminalNavigationEntry[];
  activeId: string | null;
  contextLabels: Parameters<typeof buildTerminalTabContext>[3];
  projectsById?: ReadonlyMap<string, { name: string; path: string; cli_tool?: string; shell?: string; environment_type?: string; remote_path?: string }>;
  /** Only current-work mode rows are reorderable; ordinary rows render as stable tabs. */
  sortable?: boolean;
  /** Membership add is only offered while NOT in current-work mode; removal only while in it. */
  mode: "ordinary" | "current-work";
  onActivate: (sessionId: string) => void;
  onClose?: (sessionId: string) => void;
  closeLabel?: (title: string) => string;
  /** Extra trailing element, typically the drawer trigger button. */
  trailing?: ReactNode;
  ariaLabel?: string;
  onReorder?: (fromId: string, toId: string) => void;
}

function projectColorOf(entry: TerminalNavigationEntry, contextLabels: TerminalTabRowProps["contextLabels"]): string {
  return buildTerminalTabContext(entry.session, entry.project ?? undefined, entry.worktree, contextLabels).projectColor;
}

function TabItem({
  entry, active, sortable, mode, contextLabels, onActivate, onReorder, onClose, closeLabel,
}: {
  entry: TerminalNavigationEntry; active: boolean; sortable: boolean; mode: TerminalTabRowProps["mode"];
  contextLabels: TerminalTabRowProps["contextLabels"]; onActivate: (id: string) => void;
  onReorder?: (fromId: string, toId: string) => void;
  onClose?: (id: string) => void;
  closeLabel?: (title: string) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortable ? `${mode === "current-work" ? CURRENT_WORK_TAB_DRAG_PREFIX : TERMINAL_TAB_DRAG_PREFIX}${entry.id}` : entry.id,
    disabled: !sortable,
    data: { type: "terminal-tab", sessionId: entry.id, onReorder, overlay: { title: entry.session.title, notification: "none" } },
    transition: DND_SORTABLE_TRANSITION,
  });
  const context = formatTerminalTabContext(entry.session, entry.project ?? undefined, entry.worktree, contextLabels);
  const style = {
    ...(sortable && !isDragging ? { transform: CSS.Transform.toString(transform), transition } : {}),
    "--tab-accent": projectColorOf(entry, contextLabels),
  } as React.CSSProperties;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="ui-terminal-tab-row-item"
      data-active={active ? "true" : "false"}
      data-dragging={isDragging ? "true" : "false"}
      data-drag-hidden={isDragging ? "true" : "false"}
      data-sortable={sortable ? "true" : "false"}
      data-current-work-session-id={entry.id}
      data-terminal-tab-id={entry.id}
      {...(sortable ? attributes : {})}
      {...(sortable ? listeners : {})}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="ui-terminal-tab-row-main"
        title={`${entry.session.title}\n${context}`}
        onClick={() => onActivate(entry.id)}
      >
        <span className="ui-terminal-tab-row-title">{entry.session.title}</span>
      </button>
      {onClose && <button
        type="button"
        className="ui-terminal-tab-row-close ui-focus-ring"
        aria-label={closeLabel?.(entry.session.title) ?? entry.session.title}
        title={closeLabel?.(entry.session.title)}
        onClick={(event) => { event.stopPropagation(); onClose(entry.id); }}
      >×</button>}
    </div>
  );
}

/**
 * Single real tab row for the terminal set. It renders exactly the entries handed in (the same
 * list the drawer counts), with project accent, activate, current-work removal, and shared smooth
 * wheel + reveal-active. No secondary filter and no "N more" affordance.
 */
export function TerminalTabRow({
  entries, activeId, contextLabels, sortable = false, mode, onActivate, onClose, closeLabel, trailing, ariaLabel, onReorder,
}: TerminalTabRowProps) {
  const { t } = useI18n();
  const { scrollRef, scrollState, scrollTabs } = useCurrentWorkTabScroll(true, activeId, JSON.stringify(entries.map((entry) => [entry.id, entry.session.title])));
  return (
    <nav className="ui-terminal-tab-row" aria-label={ariaLabel ?? t("terminal.navigation.label")}>
      {sortable && scrollState.canScrollLeft && (
        <button type="button" className="ui-terminal-tab-row-scroll" disabled={!scrollState.canScrollLeft} onClick={() => scrollTabs(-1)} aria-label={t("terminal.tab.scrollLeft")} title={t("terminal.tab.scrollLeft")}>‹</button>
      )}
      <div ref={scrollRef} className="ui-terminal-tab-row-list" role="tablist">
        <SortableContext items={sortable ? entries.map((entry) => `${mode === "current-work" ? CURRENT_WORK_TAB_DRAG_PREFIX : TERMINAL_TAB_DRAG_PREFIX}${entry.id}`) : []} strategy={horizontalListSortingStrategy}>
          {entries.map((entry) => (
            <TabItem
              key={entry.id}
              entry={entry}
              active={entry.id === activeId}
              sortable={sortable}
              mode={mode}
              contextLabels={contextLabels}
              onActivate={onActivate}
              onClose={onClose}
              closeLabel={closeLabel}
              onReorder={onReorder}
            />
          ))}
        </SortableContext>
      </div>
      {sortable && scrollState.canScrollRight && (
        <button type="button" className="ui-terminal-tab-row-scroll" disabled={!scrollState.canScrollRight} onClick={() => scrollTabs(1)} aria-label={t("terminal.tab.scrollRight")} title={t("terminal.tab.scrollRight")}>›</button>
      )}
      {trailing}
    </nav>
  );
}
