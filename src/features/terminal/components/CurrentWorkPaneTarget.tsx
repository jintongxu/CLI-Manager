import { useCallback, type CSSProperties, type PointerEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { useI18n } from "../../../shared/i18n/index";
import { Maximize2, Minimize2, Undo2, X } from "../../../shared/ui/icons";
import { CURRENT_WORK_DRAG_PREFIX } from "../../workspace/api/dragInteraction";
import type { PaneDropPreview } from "../lib/terminalTabsModel";
import { formatTerminalTabContext } from "../lib/currentWorkPresentation";
import { PaneContentDropZones } from "./PaneContentDropZones";

interface CurrentWorkPaneHeaderProps {
  session: TerminalSession;
  context: string;
  active: boolean;
  fullscreen: boolean;
  onActivate: (sessionId: string) => void;
  onRestoreSinglePane: () => void;
  onToggleFullscreen: () => void;
  onRemove: (sessionId: string) => void;
}

function CurrentWorkPaneHeader({
  session,
  context,
  active,
  fullscreen,
  onActivate,
  onRestoreSinglePane,
  onToggleFullscreen,
  onRemove,
}: CurrentWorkPaneHeaderProps) {
  const { t } = useI18n();
  const draggable = useDraggable({
    id: `${CURRENT_WORK_DRAG_PREFIX}${session.id}`,
    data: { type: "current-work", sessionId: session.id },
  });
  const style = draggable.transform
    ? { transform: CSS.Translate.toString(draggable.transform) } as CSSProperties
    : undefined;
  const stopPointerDown = (event: PointerEvent) => event.stopPropagation();
  return (
    <div className="ui-current-work-pane-chrome flex h-8 min-h-8 items-end overflow-hidden px-1.5 pt-1">
      <button
        ref={draggable.setNodeRef}
        type="button"
        className="ui-current-work-pane-header ui-focus-ring flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-t-md px-2.5 text-left"
        style={style}
        title={`${session.title}\n${context}`}
        onClick={() => onActivate(session.id)}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        <span className="ui-current-work-pane-indicator" aria-hidden="true" />
        <span className="max-w-52 truncate text-[11px] font-medium">{session.title}</span>
        <span className="ui-current-work-pane-context min-w-0 truncate text-[10px]">{context}</span>
      </button>
      <div className="ui-current-work-pane-actions flex h-7 shrink-0 items-center" data-active={active ? "true" : "false"}>
        <button type="button" className="ui-focus-ring ui-icon-action" onPointerDown={stopPointerDown} onClick={onRestoreSinglePane} title={t("terminal.tab.unsplit")} aria-label={t("terminal.tab.unsplit")}>
          <Undo2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" className="ui-focus-ring ui-icon-action" data-active={fullscreen ? "true" : "false"} onPointerDown={stopPointerDown} onClick={onToggleFullscreen} title={t(fullscreen ? "terminal.toolbar.exitTerminalFullscreen" : "terminal.toolbar.enterTerminalFullscreen")} aria-label={t(fullscreen ? "terminal.toolbar.exitTerminalFullscreen" : "terminal.toolbar.enterTerminalFullscreen")}>
          {fullscreen ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" /> : <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />}
        </button>
        <button type="button" className="ui-focus-ring ui-icon-action" onPointerDown={stopPointerDown} onClick={() => onRemove(session.id)} title={t("terminal.currentWork.removeNamed", { title: session.title })} aria-label={t("terminal.currentWork.removeNamed", { title: session.title })}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function CurrentWorkPaneTarget({
  paneId,
  activeDropPreview,
  session,
  project,
  worktree,
  active,
  showHeader,
  fullscreen,
  onActivate,
  onRestoreSinglePane,
  onToggleFullscreen,
  onRemove,
  registerTarget,
}: {
  paneId: string;
  activeDropPreview: PaneDropPreview;
  session: TerminalSession;
  project?: Project;
  worktree: WorktreeRecord | null;
  active: boolean;
  showHeader: boolean;
  fullscreen: boolean;
  onActivate: (sessionId: string) => void;
  onRestoreSinglePane: () => void;
  onToggleFullscreen: () => void;
  onRemove: (sessionId: string) => void;
  registerTarget: (paneId: string, element: HTMLElement | null) => void;
}) {
  const setTarget = useCallback((element: HTMLDivElement | null) => {
    registerTarget(paneId, element);
  }, [paneId, registerTarget]);
  const context = formatTerminalTabContext(session, project, worktree);
  return (
    <div className="ui-current-work-pane relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" data-active={active ? "true" : "false"}>
      {showHeader && (
        <CurrentWorkPaneHeader
          session={session}
          context={context}
          active={active}
          fullscreen={fullscreen}
          onActivate={onActivate}
          onRestoreSinglePane={onRestoreSinglePane}
          onToggleFullscreen={onToggleFullscreen}
          onRemove={onRemove}
        />
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={setTarget} className="absolute inset-0 min-h-0 min-w-0 overflow-hidden" />
        <PaneContentDropZones paneId={paneId} enabled activeDropPreview={activeDropPreview} />
      </div>
    </div>
  );
}
