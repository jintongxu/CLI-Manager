import { useEffect, useState } from "react";
import { chatController } from "./lifecycle";
import { loadChatProviderCatalog, type ChatProvider } from "../lib/chatProviderCatalog";
import { ChatPanelSurface, type ChatPanelSurfaceProps } from "../components/ChatPanelSurface";

export type ChatPanelProps = Omit<ChatPanelSurfaceProps, "controller" | "catalog"> & {
  controller?: ChatPanelSurfaceProps["controller"];
};
export function ChatPanel({ controller = chatController, ...props }: ChatPanelProps) {
  const [catalog, setCatalog] = useState<readonly ChatProvider[]>([]);
  useEffect(() => {
    let active = true;
    void loadChatProviderCatalog().then(value => { if (active) setCatalog(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <ChatPanelSurface {...props} controller={controller} catalog={catalog} />;
}
