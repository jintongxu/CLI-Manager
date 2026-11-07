export type MessageStatus = "pending" | "completed" | "stopped" | "failed" | "interrupted";
export type ConversationOrigin = "workspace" | "sidebar" | "quick-chat";
export interface Conversation {
  origin: ConversationOrigin;
  id: string; title: string; draft: string; appType: string; providerId: string; model: string;
  createdAt: number; updatedAt: number; revision: number; requestId: string | null; leaseUntil: number | null;
}
export interface AssetDescriptor {
  assetId: string; mediaType: string; byteLength: number; width: number; height: number;
  ordinal: number; displayName: string | null;
}
export interface StagedAsset {
  stageId: string; mediaType: string; byteLength: number; width: number; height: number;
}
export interface Message {
  id: string; conversationId: string; ordinal: number; role: "user" | "assistant"; content: string;
  replyTo: string | null; requestId: string; status: MessageStatus; errorCode: string | null;
  finishReason: string | null; appType: string; providerId: string; model: string; createdAt: number; updatedAt: number;
  assets: AssetDescriptor[];
}
export interface BranchSummary {
  conversationId: string; parentConversationId: string | null; sourceMessageId: string | null;
  sourceOrdinal: number; createdAt: number;
}
export interface BranchLineage { current: BranchSummary | null; children: BranchSummary[] }
export interface Detail { conversation: Conversation; messages: Message[]; lineage: BranchLineage }
export type ProviderSource = "configured" | "pi-agent";
export type DraftStatus = "clean" | "debouncing" | "saving" | "failed";
export interface ProviderOption {
  appType: string; providerId: string; name: string; defaultModel: string | null;
  protocol: "messages" | "chat" | "responses" | null; available: boolean; reason: string | null;
  source?: ProviderSource;
}
export interface ChatEvent {
  conversationId: string; messageId: string; requestId: string; operationId?: string;
  sequence: number; content: string; status: MessageStatus; errorCode: string | null; finishReason: string | null; saved: boolean;
}
export interface UpdateInput {
  conversationId: string; revision: number; title?: string; draft?: string;
  appType?: string; providerId?: string; model?: string;
}
/** Mirrors the upstream reasoning controls: enum levels plus Anthropic-style token budgets. */
export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface GenerateInput {
  conversationId: string; revision: number; requestId: string; appType: string;
  providerId: string; model: string; text: string | null; retry: boolean;
  reasoning?: ReasoningEffort | null; stageIds?: string[];
}
export interface ForkEditInput {
  sourceConversationId: string; sourceRevision: number; targetMessageId: string; operationId: string; requestId: string;
  appType: string; providerId: string; model: string; text: string | null; reasoning?: ReasoningEffort | null; stageIds?: string[];
}
export interface ForkEditReceipt {
  operationId: string; sourceConversationId: string; sourceRevision: number; targetMessageId: string;
  childConversationId: string; answer: Message; replayed: boolean;
}
export interface AssetReadInput { conversationId: string; messageId: string; ordinal: number; assetId: string }
const STAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validStageIds(stageIds: readonly string[]): boolean {
  return stageIds.length <= 4 && stageIds.every(id => STAGE_UUID.test(id));
}

export interface ChatTransport {
  initialize(): Promise<{ conversations: Conversation[]; unsaved: ChatEvent[] }>;
  list(search: string, offset: number): Promise<Conversation[]>;
  get(conversationId: string): Promise<Detail>;
  create(origin?: ConversationOrigin): Promise<Detail>;
  update(input: UpdateInput): Promise<Detail>;
  delete(conversationId: string, revision: number): Promise<void>;
  providers(): Promise<ProviderOption[]>;
  stage(bytes: ArrayBuffer | Uint8Array): Promise<StagedAsset>;
  releaseAssets(stageIds: readonly string[]): Promise<void>;
  readAsset(input: AssetReadInput): Promise<ArrayBuffer>;
  generate(input: GenerateInput, onEvent: (event: ChatEvent) => void): Promise<Message>;
  forkEdit(input: ForkEditInput, onEvent: (event: ChatEvent) => void): Promise<ForkEditReceipt>;
  cancel(conversationId: string, requestId: string): Promise<void>;
  flush(drafts: UpdateInput[]): Promise<Conversation[]>;
}
export function errorCode(error: unknown): string {
  return typeof error === "string" && /^chat_[a-z_]+$/.test(error) ? error : "chat_storage";
}
