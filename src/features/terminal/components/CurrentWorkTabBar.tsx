import type { CSSProperties } from "react";
import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import type { TabNotificationState } from "../state";
import { X, Trash2 } from "../../../shared/ui/icons";
import { buildTerminalTabHoverInfo, type TerminalTabContextLabels } from "../lib/terminalTabsModel";
import { formatTerminalTabContext } from "../lib/currentWorkPresentation";
import { useSortable, SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CURRENT_WORK_DRAG_PREFIX, DND_SORTABLE_TRANSITION } from "../../workspace/api/dragInteraction";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../../shared/ui/context-menu";

interface CurrentWorkTabBarProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  notifications: Record<string, TabNotificationState>;
  projects: Project[];
  worktrees: WorktreeRecord[];
  selectedSessionIds: ReadonlySet<string>;
  tabStyle?: CSSProperties;
  onActivate: (sessionId: string) => void;
  onToggleSelected: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
  onRename: (session: TerminalSession) => void;
  onClear: () => void;
  onCloseOtherTerminals: () => void;
  canCloseOtherTerminals: boolean;
  onExit: () => void;
  label: string;
  exitLabel: string;
  clearLabel: string;
  closeOtherLabel: string;
  selectedLabel: (count: number) => string;
  removeLabel: (title: string) => string;
  renameLabel: string;
  statusLabels: { hidden: string; sshDisconnected: string; worktreeMissing: string };
  contextLabels: TerminalTabContextLabels;
  compact?: boolean;
}

interface SortableCurrentWorkItemProps {
  session: TerminalSession;
  active: boolean;
  selected: boolean;
  notification: TabNotificationState;
  project?: Project;
  worktree: WorktreeRecord | null;
  selectedLabel: (count: number) => string;
  removeLabel: (title: string) => string;
  statusLabels: CurrentWorkTabBarProps["statusLabels"];
  contextLabels: TerminalTabContextLabels;
  onActivate: (sessionId: string) => void;
  onToggleSelected: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
  onRename: (session: TerminalSession) => void;
  renameLabel: string;
}

function SortableCurrentWorkItem({
  session, active, selected, notification, project, worktree, selectedLabel, removeLabel, renameLabel,
  statusLabels, contextLabels, onActivate, onToggleSelected, onRemove, onRename,
}: SortableCurrentWorkItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${CURRENT_WORK_DRAG_PREFIX}${session.id}`,
    data: {
      type: "current-work",
      sessionId: session.id,
      overlay: { title: session.title, notification },
    },
    transition: DND_SORTABLE_TRANSITION,
  });
  const context = formatTerminalTabContext(session, project, worktree, contextLabels);
  const statusLabel = session.tabHidden
    ? statusLabels.hidden
    : session.worktreeId && worktree?.status === "missing"
      ? statusLabels.worktreeMissing
      : session.environmentType === "ssh" && (session.connectionState === "disconnected" || session.connectionState === "failed")
        ? statusLabels.sshDisconnected
        : null;
  const hover = buildTerminalTabHoverInfo(session, project, worktree, contextLabels);
  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform ? { ...transform, y: 0 } : transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 10 : undefined,
  } as CSSProperties;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
      ref={setNodeRef}
      style={style}
      className="ui-current-work-item ui-interactive inline-flex h-10 max-w-72 shrink-0 cursor-grab items-center rounded-lg active:cursor-grabbing"
      data-dragging={isDragging ? "true" : "false"}
      data-selected={active ? "true" : "false"}
      {...attributes}
      {...listeners}
    >
      <input
        type="checkbox"
        className="ui-current-work-select mx-1 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
        aria-label={selectedLabel(1)}
        checked={selected}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleSelected(session.id)}
      />
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="ui-current-work-main inline-flex h-10 min-w-0 flex-col items-start justify-center gap-0 overflow-visible rounded-md px-2 py-1 text-xs leading-tight"
        data-selected={active ? "true" : "false"}
        onClick={() => onActivate(session.id)}
        title={`${context}${statusLabel ? ` · ${statusLabel}` : ""}\n${hover.path}`}
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          {statusLabel ? <span className="ui-workspan-status-failed" title={statusLabel}>!</span> : notification === "running" ? <span className="ui-workspan-status-running">●</span> : null}
          <span className="truncate">{session.title}</span>
        </span>
        <span className="ui-current-work-tab-context max-w-56 truncate text-[10px] opacity-65">{context}</span>
      </button>
      <button
        type="button"
        className="ui-current-work-remove ui-focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-70 hover:opacity-100"
        aria-label={removeLabel(session.title)}
        title={removeLabel(session.title)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onRemove(session.id); }}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onRename(session)}>{renameLabel}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CurrentWorkTabBar({
  sessions, activeSessionId, notifications, projects, worktrees, selectedSessionIds, tabStyle,
  onActivate, onToggleSelected, onRemove, onRename, onClear, onCloseOtherTerminals, canCloseOtherTerminals, onExit, label, exitLabel,
  clearLabel, closeOtherLabel, selectedLabel, removeLabel, renameLabel, statusLabels, contextLabels, compact = false,
}: CurrentWorkTabBarProps) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]));
  return (
    <div
      className="ui-terminal-pane-chrome ui-current-workbar relative flex min-h-10 shrink-0 items-center gap-2 overflow-visible px-2 py-1.5"
      style={{ height: compact ? 40 : 58, minHeight: compact ? 40 : 58, flexBasis: compact ? 40 : 58 }}
      role="tablist"
      aria-label={label}
    >
      <div className="ui-current-work-heading shrink-0" aria-hidden="true">
        <span className="ui-current-work-heading-dot">●</span>
        <span>{label}</span>
        {!compact && <span className="ui-current-work-count">{sessions.length}</span>}
      </div>
      {!compact && (
        <div className="ui-current-work-list flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <SortableContext items={sessions.map((session) => `${CURRENT_WORK_DRAG_PREFIX}${session.id}`)} strategy={horizontalListSortingStrategy}>
            {sessions.map((session) => (
              <SortableCurrentWorkItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                selected={selectedSessionIds.has(session.id)}
                notification={notifications[session.id] ?? "none"}
                project={session.projectId ? projectById.get(session.projectId) : undefined}
                worktree={session.worktreeId ? worktreeById.get(session.worktreeId) ?? null : null}
                selectedLabel={selectedLabel}
                removeLabel={removeLabel}
                renameLabel={renameLabel}
                statusLabels={statusLabels}
                contextLabels={contextLabels}
                onActivate={onActivate}
                onToggleSelected={onToggleSelected}
                onRemove={onRemove}
                onRename={onRename}
              />
            ))}
          </SortableContext>
        </div>
      )}
      {!compact && selectedSessionIds.size > 0 && (
        <button type="button" className="ui-current-work-clear ui-focus-ring shrink-0 rounded-md px-2 py-1 text-xs opacity-80 hover:opacity-100" onClick={onClear} title={clearLabel}>
          <Trash2 size={13} aria-hidden="true" />
          <span className="sr-only">{clearLabel}</span>
        </button>
      )}
      <button type="button" className="ui-current-work-close-others ui-focus-ring shrink-0 rounded-md px-2 py-1 text-xs opacity-80 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={onCloseOtherTerminals} title={closeOtherLabel} aria-label={closeOtherLabel} disabled={!canCloseOtherTerminals}>
        <X size={13} aria-hidden="true" />
        <span className="sr-only">{closeOtherLabel}</span>
      </button>
      <button
        type="button"
        className="ui-current-work-exit ui-focus-ring shrink-0 rounded-md px-2 py-1 text-xs opacity-80 hover:opacity-100"
        style={tabStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onExit(); }}
      >
        {exitLabel}
      </button>
    </div>
  );
}

export type { CurrentWorkTabBarProps };
