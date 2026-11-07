import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatSnapshot } from "./chatController";
import type { ChatPanelController, QuickCommand, QuickSnapshot, QuickAck } from "./panelController";
import type { ChatProvider } from "./chatProviderCatalog";
import { errorCode, type AssetReadInput, type ReasoningEffort, type UpdateInput } from "./types";
import { chatTransport } from "./transport";
import { resolveSnapshotError } from "./chatErrors";

const empty: ChatSnapshot = { ready: false, selected: null, conversations: [], details: {}, providers: [], drafts: {},
  dirty: [], draftStatus: {}, unsaved: {}, busy: [], running: [], error: null, suspended: false, search: "", hasMore: false, searching: false };
export class QuickChatRemote implements ChatPanelController {
  private state = empty;
  private listeners = new Set<() => void>();
  private pending = new Map<string, { resolve: () => void; reject: (error: string) => void; timer: ReturnType<typeof setTimeout> }>();
  private version = -1;
  private epoch?: string;
  private retiredEpochs = new Set<string>();
  private draftEdits = new Map<string, { text: string; token: object }>();
  private draftTail: Promise<void> = Promise.resolve();
  private creating?: Promise<void>;
  private generating = new Map<string, Promise<void>>();
  private drainingDrafts = false;
  private starting?: Promise<void>;
  private seq = 0;
  private inFlightError: { version: number; code: string } | null = null;
  catalog: readonly ChatProvider[] = [];
  presentation?: QuickSnapshot;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.listeners.forEach(listener => listener()); }
  report = (error: unknown) => {
    const code = errorCode(error);
    this.inFlightError = { version: this.version, code };
    this.state = { ...this.state, error: code };
    this.notify();
  };
  clearError = () => {
    this.inFlightError = null;
    if (this.state.error) {
      this.state = { ...this.state, error: null };
      this.notify();
    }
  };
  accept(snapshot: QuickSnapshot) {
    if (this.retiredEpochs.has(snapshot.epoch)) return;
    if (snapshot.epoch !== this.epoch) {
      if (this.retiredEpochs.size >= 128) { this.report("chat_quick_capacity"); return; }
      if (this.epoch) {
        this.retiredEpochs.add(this.epoch);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject("chat_quick_owner_changed"); }
        this.pending.clear();
      }
      this.epoch = snapshot.epoch; this.version = -1;
    }
    if (snapshot.version <= this.version) return;
    this.version = snapshot.version;
    this.catalog = snapshot.catalog;
    this.presentation = snapshot;
    const recoveredSelection = Boolean(
      snapshot.state.ready &&
      snapshot.state.selected &&
      snapshot.state.details[snapshot.state.selected]
    );
    const resolved = resolveSnapshotError(
      this.state.error,
      snapshot.state.error,
      snapshot.state.ready,
      recoveredSelection,
      this.inFlightError,
      snapshot.version
    );
    if (resolved.clearInFlight) {
      this.inFlightError = null;
    }
    if (recoveredSelection) {
      for (const id of this.draftEdits.keys()) if (!snapshot.state.details[id]) this.draftEdits.delete(id);
    }
    this.state = {
      ...snapshot.state,
      error: resolved.error,
      drafts: {
        ...snapshot.state.drafts,
        ...Object.fromEntries([...this.draftEdits].map(([id, edit]) => [id, edit.text])),
      },
    };
    this.notify();
  }
  start = (): Promise<void> => {
    this.inFlightError = null;
    return this.starting ??= (async () => {
    const channel = new Channel<{ kind: string; payload: QuickSnapshot | QuickAck }>();
    channel.onmessage = ({ kind, payload }) => {
      if (kind === "snapshot") this.accept(payload as QuickSnapshot);
      if (kind === "ack") {
        const ack = payload as QuickAck;
        const pending = this.pending.get(ack.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(ack.id);
        if (ack.error) pending.reject(ack.error); else pending.resolve();
      }
    };
    try {
      await invoke("quick_chat_connect", { channel });
      await this.command({ op: "hello" });
    } catch (error) {
      this.starting = undefined;
      this.report(error);
    }
  })();
  };
  command(command: QuickCommand, expectedEpoch = this.epoch): Promise<void> {
    if (command.op !== "hello" && expectedEpoch !== this.epoch) return Promise.reject("chat_quick_owner_changed");
    if (this.pending.size >= 128) return Promise.reject("chat_quick_capacity");
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject("chat_quick_timeout"); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      void invoke("quick_chat_command", { envelope: { id, epoch: expectedEpoch, seq: ++this.seq, command } }).catch(() => {
        clearTimeout(timer); this.pending.delete(id); reject("chat_quick_not_ready");
      });
    });
  }
  private afterDraft(command: QuickCommand) {
    const epoch = this.epoch;
    return this.draftTail.then(() => this.command(command, epoch));
  }
  continueInMain = () => this.afterDraft({ op: "continue" });
  create = () => this.creating ??= this.afterDraft({ op: "create" }).finally(() => { this.creating = undefined; });
  select = (conversationId: string) => this.afterDraft({ op: "select", conversationId });
  setDraft = (conversationId: string, text: string) => {
    const token = {};
    this.draftEdits.set(conversationId, { text, token });
    this.state = { ...this.state, drafts: { ...this.state.drafts, [conversationId]: text } }; this.notify();
    // One in-flight draft plus the latest edit: do not retain every keystroke/text in a promise chain.
    if (!this.drainingDrafts) {
      this.drainingDrafts = true;
      const epoch = this.epoch;
      this.draftTail = (async () => {
        while (this.draftEdits.size) {
          const [id, edit] = this.draftEdits.entries().next().value!;
          if (!this.state.conversations.some(conversation => conversation.id === id)) { this.draftEdits.delete(id); continue; }
          await this.command({ op: "draft", conversationId: id, text: edit.text }, epoch);
          if (this.draftEdits.get(id)?.token === edit.token) this.draftEdits.delete(id);
        }
      })().finally(() => { this.drainingDrafts = false; });
      void this.draftTail.catch(this.report);
    }
  };

  stageAttachment = (bytes: ArrayBuffer | Uint8Array) => chatTransport.stage(bytes);
  releaseAssets = (stageIds: readonly string[]) => chatTransport.releaseAssets(stageIds);
  readAsset = (input: AssetReadInput) => chatTransport.readAsset(input);

  update = (conversationId: string, values: Omit<UpdateInput, "conversationId" | "revision" | "draft">) =>
    this.command({ op: "update", conversationId, providerId: values.providerId ?? "", model: values.model ?? "" });
  generate = (conversationId: string, retry = false, reasoning: ReasoningEffort = "medium", stageIds: readonly string[] = []) => {
    const pending = this.generating.get(conversationId);
    if (pending) return pending;
    const generation = this.afterDraft({ op: "generate", conversationId, retry, reasoning, stageIds })
      .finally(() => { this.generating.delete(conversationId); });
    this.generating.set(conversationId, generation);
    return generation;
  };
  editAndRegenerate = (conversationId: string, targetMessageId: string, text: string | null,
    reasoning: ReasoningEffort = "medium", stageIds: readonly string[] = [],
    ids: { operationId?: string; requestId?: string } = {}) => {
    const operationId = ids.operationId ?? crypto.randomUUID();
    const requestId = ids.requestId ?? crypto.randomUUID();
    return this.afterDraft({ op: "forkEdit", conversationId, targetMessageId, text, reasoning, stageIds, operationId, requestId });
  };
  stop = (conversationId: string) => this.command({ op: "stop", conversationId });
}
