export type CurrentWorkAction =
  | "toggle-view"
  | "next"
  | "previous"
  | "clear"
  | "add-active"
  | "remove-active";

export const CURRENT_WORK_ACTION_EVENT = "cli-manager:current-work-action";

export function dispatchCurrentWorkAction(action: CurrentWorkAction): void {
  window.dispatchEvent(new CustomEvent<CurrentWorkAction>(CURRENT_WORK_ACTION_EVENT, { detail: action }));
}
