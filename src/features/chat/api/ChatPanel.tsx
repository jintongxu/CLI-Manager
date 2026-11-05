import { useSyncExternalStore } from "react";
import { chatController } from "./lifecycle";
import { useConversationReasoning } from "../hooks/useConversationReasoning";
import { useConversationDefaultModel } from "../hooks/useConversationDefaultModel";
import type { ChatController } from "../lib/chatController";
import { ChatPanelSurface, type ChatPanelSurfaceProps } from "../components/ChatPanelSurface";

export type ChatPanelProps = Omit<ChatPanelSurfaceProps, "controller" | "catalog" | "defaultBindingManaged" | "catalogReady"> & {
  controller?: ChatController;
};
export function ChatPanel({ controller = chatController, ...props }: ChatPanelProps) {
  const { catalog, ready } = useConversationDefaultModel(controller);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [reasoning, setReasoning] = useConversationReasoning(state.selected);
  return <ChatPanelSurface {...props} reasoningEffort={reasoning}
    onReasoningEffortChange={(value) => { setReasoning(value); props.onReasoningEffortChange(value); }}
    controller={controller} catalog={catalog} catalogReady={ready} defaultBindingManaged />;
}
