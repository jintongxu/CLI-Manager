import { create } from "zustand";
import type { ReasoningEffort } from "../../chat/api/chatReasoning";

/** Panel chrome state only; conversation data stays in the chat controller. */
export type ChatPanelMode = "dock" | "float";

interface ChatPanelState {
  mode: ChatPanelMode;
  floatOpen: boolean;
  attachedSelection: string;
  reasoningEffort: ReasoningEffort;
  floatPosition: { x: number; y: number } | null;
  setMode: (mode: ChatPanelMode) => void;
  setFloatOpen: (open: boolean) => void;
  toggleFloat: () => void;
  setAttachedSelection: (text: string) => void;
  clearAttachedSelection: () => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setFloatPosition: (pos: { x: number; y: number } | null) => void;
}

export const useChatPanelStore = create<ChatPanelState>((set) => ({
  mode: "dock",
  floatOpen: false,
  attachedSelection: "",
  reasoningEffort: "medium",
  floatPosition: null,
  setMode: (mode) => set({ mode }),
  setFloatOpen: (floatOpen) => set({ floatOpen }),
  toggleFloat: () => set((state) => ({ floatOpen: !state.floatOpen })),
  setAttachedSelection: (attachedSelection) => set({ attachedSelection }),
  clearAttachedSelection: () => set({ attachedSelection: "" }),
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort }),
  setFloatPosition: (floatPosition) => set({ floatPosition }),
}));

/** Single owner of the dock/float toggle decision so the button and the shortcut cannot drift. */
export function toggleChatPanel(dock: {
  merged: boolean;
  chatTabActive: boolean;
  openChatTab: () => void;
  closePanel: () => void;
}): void {
  const { mode, toggleFloat } = useChatPanelStore.getState();
  if (!dock.merged || mode === "float") { toggleFloat(); return; }
  if (dock.chatTabActive) dock.closePanel();
  else dock.openChatTab();
}
