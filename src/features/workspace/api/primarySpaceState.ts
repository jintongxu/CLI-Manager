import { create } from "zustand";

export type PrimarySpace = "projects" | "chat";

/** Presentation state only: never owns terminal/chat data or process lifetime. */
export const usePrimarySpaceStore = create<{
  space: PrimarySpace;
  setSpace: (space: PrimarySpace) => void;
}>((set) => ({
  space: "projects",
  setSpace: (space) => set({ space }),
}));

/** Explicit user navigation, not a subscription to arriving terminal output. */
export function showProjectSpace() {
  usePrimarySpaceStore.getState().setSpace("projects");
}
