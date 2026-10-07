import type { CSSProperties, ReactNode, PointerEvent } from "react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TerminalSession } from "../../../shared/types/index";
import { DND_SORTABLE_TRANSITION } from "../../workspace/api/dragInteraction";

interface TerminalRowDragProps {
  ref: (element: HTMLButtonElement | null) => void;
  attributes: DraggableAttributes;
  style: CSSProperties;
  isDragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}

/** The terminal button itself is the sortable node/activator, just like terminal tabs. */
export function SidebarTerminalSortable({ session, children }: {
  session: TerminalSession; children: (props: TerminalRowDragProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id, data: { type: "sidebar-terminal", projectId: session.projectId,
      worktreeId: session.worktreeId, pinned: session.sidebarPinned === true },
    transition: DND_SORTABLE_TRANSITION,
  });
  return children({
    ref: (element) => { setNodeRef(element); setActivatorNodeRef(element); },
    attributes,
    style: { transform: CSS.Transform.toString(transform), transition: isDragging ? undefined : transition,
      opacity: isDragging ? 0.5 : 1 },
    isDragging,
    onPointerDown: (event) => {
      event.stopPropagation();
      if (event.button !== 0 || !event.isPrimary) return;
      listeners?.onPointerDown?.(event);
    },
  });
}
