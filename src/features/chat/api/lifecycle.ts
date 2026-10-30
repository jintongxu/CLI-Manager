import { ChatController } from "../lib/chatController";
import { chatTransport } from "../lib/transport";

// App startup has already completed Database.load/migrations before the workspace mounts.
// Lazy requests, stable module owner: StrictMode and hidden workspaces never cancel a run.
export const chatController = new ChatController(chatTransport);
export function suspendChatEditing(): void { chatController.suspend(); }
export function flushChatPersistence(): Promise<void> { return chatController.flush(); }
export function resumeChatEditing(): void { chatController.resume(); }
