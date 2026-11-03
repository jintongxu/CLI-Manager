export type CurrentWorkAction =
  | "toggle-view"
  | "next"
  | "previous"
  | "clear"
  | "add-active"
  | "remove-active";

export interface CurrentWorkTarget {
  sessionId: string;
  activate?: boolean;
}

export const CURRENT_WORK_ACTION_EVENT = "cli-manager:current-work-action";
export const CURRENT_WORK_TARGET_EVENT = "cli-manager:current-work-target";
export const CURRENT_WORK_SESSION_CREATED_EVENT = "cli-manager:current-work-session-created";

export function dispatchCurrentWorkAction(action: CurrentWorkAction): void {
  window.dispatchEvent(new CustomEvent<CurrentWorkAction>(CURRENT_WORK_ACTION_EVENT, { detail: action }));
}

export function dispatchCurrentWorkTarget(sessionId: string): void {
  window.dispatchEvent(new CustomEvent<CurrentWorkTarget>(CURRENT_WORK_TARGET_EVENT, {
    detail: { sessionId },
  }));
}

export function dispatchCurrentWorkSessionCreated(sessionId: string, activate = false): void {
  window.dispatchEvent(new CustomEvent<CurrentWorkTarget>(CURRENT_WORK_SESSION_CREATED_EVENT, {
    detail: { sessionId, activate },
  }));
}

/** Synchronous notification: runtime membership has already been replaced. */
export const CURRENT_WORK_SESSION_REPLACED_EVENT = "cli-manager:current-work-session-replaced";
export function dispatchCurrentWorkSessionReplaced(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CURRENT_WORK_SESSION_REPLACED_EVENT));
}
