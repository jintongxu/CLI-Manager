import type { ChatController, ChatSnapshot } from "./chatController";
import type { ChatProvider } from "./chatProviderCatalog";
import type { ReasoningEffort } from "./types";

/** Presentation contract: no transport or window-local request ownership. */
export type ChatPanelController = Pick<ChatController,
  "getSnapshot" | "subscribe" | "start" | "create" | "select" | "setDraft" |
  "update" | "generate" | "stop" | "report">;
export type QuickCommand =
  | { op: "hello" | "create" | "continue" }
  | { op: "select" | "stop"; conversationId: string }
  | { op: "draft"; conversationId: string; text: string }
  | { op: "update"; conversationId: string; providerId: string; model: string }
  | { op: "generate"; conversationId: string; retry: boolean; reasoning: ReasoningEffort; images: readonly string[] };
export interface CommandEnvelope { id: string; epoch?: string; seq?: number; command: QuickCommand }
export interface QuickSnapshot { epoch: string; version: number; state: ChatSnapshot; catalog: readonly ChatProvider[]; language: string; theme: string; lightPalette: string; darkPalette: string; defaultReasoningEffort?: ReasoningEffort }
export interface QuickAck { id: string; error: string | null }

export function selectedSnapshot(state: ChatSnapshot, selected: string | null = state.selected, quickOnly = false): ChatSnapshot {
  const id = selected;
  // Main history searches/pages must not discard the quick session's loaded summaries.
  const rows = quickOnly ? [...new Map([
    ...state.conversations, ...Object.values(state.details).map(detail => detail.conversation),
  ].filter(c => c.origin === "quick-chat").map(c => [c.id, c])).values()] : state.conversations;
  return { ...state, selected: id,
    conversations: rows.filter(c => !quickOnly || c.origin === "quick-chat").map(c => ({ ...c, draft: id === c.id ? c.draft : "" })),
    providers: [],
    dirty: state.dirty.filter(key => key === id),
    draftStatus: id && state.draftStatus[id] ? { [id]: state.draftStatus[id] } : {},
    busy: state.busy.filter(key => key === id), running: state.running.filter(key => key === id),
    details: id && state.details[id] ? { [id]: state.details[id] } : {},
    drafts: id ? { [id]: state.drafts[id] ?? "" } : {},
    unsaved: id && state.unsaved[id] ? { [id]: state.unsaved[id] } : {},
  };
}

/**
 * Bounded replay ledger. Recent command IDs dedupe exactly; the monotonic
 * `seq` watermark fails closed for anything older than the retained window, so
 * evicting a completed ID can never re-run an old mutation.
 */
export const COMMAND_LEDGER_WINDOW = 512;
export class CommandLedger {
  private results = new Map<string, Promise<QuickAck>>();
  private highWater = 0;
  run(envelope: CommandEnvelope, execute: () => Promise<void>): Promise<QuickAck> {
    const previous = this.results.get(envelope.id);
    if (previous) return previous;
    const seq = envelope.seq;
    // Envelopes without a seq cannot advance the watermark; they still dedupe
    // inside the window and are otherwise treated as fresh commands.
    if (typeof seq === "number") {
      if (seq <= this.highWater) return Promise.resolve({ id: envelope.id, error: "chat_quick_capacity" });
      this.highWater = seq;
    }
    const result = Promise.resolve().then(execute)
      .then(() => ({ id: envelope.id, error: null }), () => ({ id: envelope.id, error: "chat_quick_command_failed" }));
    this.results.set(envelope.id, result);
    while (this.results.size > COMMAND_LEDGER_WINDOW) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) break;
      this.results.delete(oldest);
    }
    return result;
  }
}
