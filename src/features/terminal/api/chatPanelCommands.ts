/** Decoupled toggle channel so keyboard and other features never import panel state. */
export const CHAT_PANEL_TOGGLE_EVENT = "cli-manager:chat-panel-toggle";

export function dispatchChatPanelToggle(): void {
  window.dispatchEvent(new CustomEvent(CHAT_PANEL_TOGGLE_EVENT));
}

export function subscribeChatPanelToggle(handler: () => void): () => void {
  window.addEventListener(CHAT_PANEL_TOGGLE_EVENT, handler);
  return () => window.removeEventListener(CHAT_PANEL_TOGGLE_EVENT, handler);
}
