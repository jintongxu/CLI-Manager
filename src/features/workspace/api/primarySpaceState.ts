import { create } from "zustand";
import type { ChatHistorySource } from "../../chat/api/historySource";

export type PrimarySpace = "projects" | "chat";

/** Presentation state only: never owns terminal/chat data or process lifetime. */
export const usePrimarySpaceStore = create<{
  space: PrimarySpace;
  chatHistorySource: ChatHistorySource;
  setChatHistorySource: (source: ChatHistorySource) => void;
  setSpace: (space: PrimarySpace, source?: ChatHistorySource) => void;
}>((set) => ({
  space: "projects",
  chatHistorySource: "workspace",
  setChatHistorySource: (chatHistorySource) => set({ chatHistorySource }),
  setSpace: (space, source = "workspace") => set(space === "chat"
    ? { space, chatHistorySource: source } : { space }),
}));

/** Explicit user navigation, not a subscription to arriving terminal output. */
export function showProjectSpace() {
  usePrimarySpaceStore.getState().setSpace("projects");
}
