import { chatController } from "./lifecycle";
import { useConversationDefaultModel } from "../hooks/useConversationDefaultModel";
import type { ChatController } from "../lib/chatController";
import { ChatPanelSurface, type ChatPanelSurfaceProps } from "../components/ChatPanelSurface";

export type ChatPanelProps = Omit<ChatPanelSurfaceProps, "controller" | "catalog" | "defaultBindingManaged" | "catalogReady"> & {
  controller?: ChatController;
};
export function ChatPanel({ controller = chatController, ...props }: ChatPanelProps) {
  const { catalog, ready } = useConversationDefaultModel(controller);
  return <ChatPanelSurface {...props} controller={controller} catalog={catalog} catalogReady={ready} defaultBindingManaged />;
}
