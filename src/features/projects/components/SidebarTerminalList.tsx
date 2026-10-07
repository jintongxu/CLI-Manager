import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SidebarTerminalSortable } from "./SidebarTerminalSortable";
import { DND_ACTIVATION_CONSTRAINT } from "../../workspace/api/dragInteraction";
import { terminalDragCandidate, terminalDropAllowed } from "../lib/sidebarOrdering";
import { useState } from "react";
import { SidebarTerminalRenameDialog } from "./SidebarTerminalRenameDialog";
import { useTreeActions } from "./TreeContext";
import { useI18n } from "../../../shared/i18n/index";
import { EyeOff, Pin, Terminal } from "../../../shared/ui/icons";
import { useTerminalStore } from "../../terminal/state";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "../../../shared/ui/context-menu";
import { isSidebarTerminalLocked, resolveSidebarTerminalState, sidebarTerminalGlyphs } from "../lib/sidebarTerminals";

/** Kept independently tabbable: terminal keyboard actions never bubble to project tree selection/deletion. */
export function SidebarTerminalList({ projectId, worktreeId, depth = 0, compact = false }: {
  projectId: string; worktreeId?: string; depth?: number; compact?: boolean;
}) {
  const actions = useTreeActions();
  const { t } = useI18n();
  const notifications = useTerminalStore((store) => store.tabNotifications);
  const taskSources = useTerminalStore((store) => store.tabStatuses);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const sessions = actions.getTerminals(projectId, worktreeId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: DND_ACTIVATION_CONSTRAINT }));
  if (!sessions.length && !renameTarget) return null;
  return (
    <>
    <DndContext accessibility={{ screenReaderInstructions: { draggable: t("sidebar.order.terminalInstructions") } }} sensors={sensors} collisionDetection={(args) => closestCenter({ ...args,
      droppableContainers: args.droppableContainers.filter((item) => terminalDragCandidate(sessions, String(args.active.id), String(item.id))) })}
      onDragEnd={({ active, over }) => {
        if (over && terminalDropAllowed(actions.getTerminals(projectId, worktreeId), String(active.id), String(over.id)))
          actions.onReorderTerminal(String(active.id), String(over.id));
      }}>
    <SortableContext items={sessions.map((session) => session.id)} strategy={verticalListSortingStrategy}>
    <div role="group" aria-label={t("sidebar.terminals.list")} data-sidebar-terminals
      className="sidebar-terminal-list" data-density={compact ? "compact" : "comfortable"}
      style={{ marginInlineStart: 4 + depth * (compact ? 14 : 16) + (compact ? 18 : 20) }}
      onFocus={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
        if (!keys.includes(event.key)) return;
        const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button.sidebar-terminal-row"));
        const index = rows.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        rows[next]?.focus();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}>
      {sessions.map((session) => {
        const locked = isSidebarTerminalLocked(session);
        const status = resolveSidebarTerminalState(session, actions.terminalStatuses[session.id], notifications[session.id], taskSources[session.id]);
        const state = status ? t(`sidebar.terminals.${status}`) : "";
        const hidden = session.tabHidden ? t("sidebar.terminals.hidden") : "";
        const label = [session.title, state, hidden].filter(Boolean).join(" · ");
        return (
          <SidebarTerminalSortable key={session.id} session={session}>
          {(drag) => (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button type="button" ref={drag.ref} {...drag.attributes} style={drag.style}
                onPointerDown={drag.onPointerDown} className="sidebar-terminal-row" data-status={status ?? undefined}
                data-hidden={session.tabHidden ? "true" : "false"}
                data-selected={actions.activeTerminalId === session.id && !session.tabHidden ? "true" : "false"}
                aria-label={t("sidebar.terminals.open", { title: label })} title={label}
                onClick={(event) => { event.stopPropagation(); if (!drag.isDragging) actions.onOpenTerminal(session.id); }}
                onKeyDown={(event) => {
                  if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    actions.onMoveTerminal(session.id, event.key === "ArrowUp" ? -1 : 1);
                    return;
                  }
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left + 12, clientY: rect.bottom }));
                    return;
                  }
                  if (event.key === "Delete") { event.preventDefault(); actions.onDeleteTerminal(session.id); }
                }}>
                <Terminal size={13} className="sidebar-terminal-icon" aria-hidden="true" />
                <span className="sidebar-terminal-heading">
                  <span className="sidebar-terminal-title-line">
                    <span className="sidebar-terminal-title">{session.title}</span>
                    {session.sidebarPinned && <Pin size={11} className="sidebar-terminal-pin" aria-label={t("sidebar.terminals.pinned")} />}
                  </span>
                  <span className="sidebar-terminal-metadata" aria-hidden="true">
                    {status && <span className="sidebar-terminal-status" title={state}>{sidebarTerminalGlyphs[status]}</span>}
                    {session.tabHidden && <span className="sidebar-terminal-hidden" title={hidden}><EyeOff size={12} aria-hidden="true" /></span>}
                  </span>
                </span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent aria-label={label}>
              <ContextMenuItem onSelect={() => actions.onPinTerminal(session.id, !session.sidebarPinned)}>
                {t(session.sidebarPinned ? "sidebar.terminals.unpin" : "sidebar.terminals.pin")}
              </ContextMenuItem>
              {([-1, 1] as const).map((delta) => <ContextMenuItem key={delta}
                disabled={!sessions.some((item, index) => item.id === session.id && terminalDropAllowed(sessions, session.id, sessions[index + delta]?.id ?? ""))}
                onSelect={() => actions.onMoveTerminal(session.id, delta)}>
                {t(delta === -1 ? "sidebar.order.moveUp" : "sidebar.order.moveDown")}
              </ContextMenuItem>)}
              <ContextMenuItem onSelect={() => actions.onOpenTerminal(session.id)}>{t("sidebar.terminals.reopen")}</ContextMenuItem>
              <ContextMenuItem onSelect={() => setRenameTarget(actions.getTerminalRenameTarget(session.id))}>
                {t("sidebar.terminals.rename")}
              </ContextMenuItem>
              <ContextMenuItem danger disabled={locked} onSelect={() => actions.onDeleteTerminal(session.id)}>
                {t("sidebar.terminals.delete")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          )}
          </SidebarTerminalSortable>
        );
      })}
    </div>
    </SortableContext>
    </DndContext>
    {renameTarget && <SidebarTerminalRenameDialog key={renameTarget.id} target={renameTarget}
      onClose={() => setRenameTarget(null)} onConfirm={actions.onRenameTerminal} />}
    </>
  );
}
