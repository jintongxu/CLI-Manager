export type MessageStatus = "pending" | "completed" | "stopped" | "failed" | "interrupted";
export interface Conversation {
  id: string; title: string; draft: string; appType: string; providerId: string; model: string;
  createdAt: number; updatedAt: number; revision: number; requestId: string | null; leaseUntil: number | null;
}
export interface Message {
  id: string; conversationId: string; ordinal: number; role: "user" | "assistant"; content: string;
  replyTo: string | null; requestId: string; status: MessageStatus; errorCode: string | null;
  finishReason: string | null; appType: string; providerId: string; model: string; createdAt: number; updatedAt: number;
}
export interface Detail { conversation: Conversation; messages: Message[] }
export type ProviderSource = "configured" | "pi-agent";
export type DraftStatus = "clean" | "debouncing" | "saving" | "failed";
export interface ProviderOption {
  appType: string; providerId: string; name: string; defaultModel: string | null;
  protocol: "messages" | "chat" | "responses" | null; available: boolean; reason: string | null;
  source?: ProviderSource;
}
export interface ChatEvent {
  conversationId: string; messageId: string; requestId: string; sequence: number;
  content: string; status: MessageStatus; errorCode: string | null; finishReason: string | null; saved: boolean;
}
export interface UpdateInput {
  conversationId: string; revision: number; title?: string; draft?: string;
  appType?: string; providerId?: string; model?: string;
}
export interface GenerateInput {
  conversationId: string; revision: number; requestId: string; appType: string;
  providerId: string; model: string; text: string | null; retry: boolean;
}
export interface ChatTransport {
  initialize(): Promise<{ conversations: Conversation[]; unsaved: ChatEvent[] }>;
  list(search: string, offset: number): Promise<Conversation[]>;
  get(conversationId: string): Promise<Detail>;
  create(): Promise<Detail>;
  update(input: UpdateInput): Promise<Detail>;
  delete(conversationId: string, revision: number): Promise<void>;
  providers(): Promise<ProviderOption[]>;
  generate(input: GenerateInput, onEvent: (event: ChatEvent) => void): Promise<Message>;
  cancel(conversationId: string, requestId: string): Promise<void>;
  flush(drafts: UpdateInput[]): Promise<Conversation[]>;
}
export function errorCode(error: unknown): string {
  return typeof error === "string" && /^chat_[a-z_]+$/.test(error) ? error : "chat_storage";
}
