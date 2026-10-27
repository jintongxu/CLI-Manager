export const DND_ACTIVATION_CONSTRAINT = { distance: 3 } as const;

export const DND_SORTABLE_TRANSITION = {
  duration: 100,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export const POINTER_DRAG_START_PX = DND_ACTIVATION_CONSTRAINT.distance;

export const WORKSPAN_DRAG_PREFIX = "workspan:";
export const PROJECT_DRAG_PREFIX = "project:";
export const CURRENT_WORK_DRAG_PREFIX = "current-work:";
export const CURRENT_WORK_TAB_DRAG_PREFIX = "current-work-tab:";
export const CURRENT_WORK_ORDER_DRAG_PREFIX = "current-work-order:";
export const TERMINAL_TAB_DRAG_PREFIX = "terminal-tab:";
export const CURRENT_WORK_DROP_TARGET_ID = "current-work-target";
export const WORKSPAN_DRAG_AUTO_ACTIVATE_MS = 500;

export function parseProjectDragId(value: string): string | null {
  return value.startsWith(PROJECT_DRAG_PREFIX)
    ? value.slice(PROJECT_DRAG_PREFIX.length) || null
    : null;
}

export function parseTerminalTabDragId(value: string): string | null {
  return value.startsWith(TERMINAL_TAB_DRAG_PREFIX)
    ? value.slice(TERMINAL_TAB_DRAG_PREFIX.length) || null
    : null;
}

export function parseCurrentWorkDragId(value: string): string | null {
  const prefix = value.startsWith(CURRENT_WORK_TAB_DRAG_PREFIX) ? CURRENT_WORK_TAB_DRAG_PREFIX
    : value.startsWith(CURRENT_WORK_ORDER_DRAG_PREFIX) ? CURRENT_WORK_ORDER_DRAG_PREFIX
      : value.startsWith(CURRENT_WORK_DRAG_PREFIX) ? CURRENT_WORK_DRAG_PREFIX : null;
  return prefix ? value.slice(prefix.length) || null : null;
}

export function parseWorkspanDragId(value: string): string | null {
  return value.startsWith(WORKSPAN_DRAG_PREFIX)
    ? value.slice(WORKSPAN_DRAG_PREFIX.length) || null
    : null;
}

export function resolveWorkspanDragHoverTarget(sourceWorkspanId: string, overId: string): string | null {
  const targetWorkspanId = parseWorkspanDragId(overId);
  return targetWorkspanId && targetWorkspanId !== sourceWorkspanId ? targetWorkspanId : null;
}
