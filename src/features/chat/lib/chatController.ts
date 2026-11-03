import { errorCode } from "./types";
import { BoundedSet } from "./boundedSet";
import type { ChatEvent, ChatTransport, Conversation, ConversationOrigin, Detail, DraftStatus, Message, ProviderOption, ReasoningEffort, UpdateInput } from "./types";

interface Run { requestId: string; messageId?: string; sequence: number; terminal: boolean; stopped: boolean; completion: Promise<void>; settle: () => void }
export interface ChatSnapshot {
  ready: boolean; selected: string | null; conversations: Conversation[]; details: Record<string, Detail>;
  providers: ProviderOption[]; drafts: Record<string, string>; dirty: string[]; draftStatus: Record<string, DraftStatus>; unsaved: Record<string, ChatEvent>;
  busy: string[]; running: string[]; error: string | null; suspended: boolean; search: string; hasMore: boolean;
  searching: boolean;
}

/** Window-lifetime owner. React subscriptions (including StrictMode replay) never own requests. */
export class ChatController {
  private state: ChatSnapshot = {
    ready: false, selected: null, conversations: [], details: {}, providers: [], drafts: {}, dirty: [], draftStatus: {},
    unsaved: {}, busy: [], running: [], error: null, suspended: false, search: "", hasMore: false, searching: false,
  };
  private listeners = new Set<() => void>();
  private starting?: Promise<void>;
  private queues = new Map<string, Promise<unknown>>();
  private runs = new Map<string, Run>();
  private deleted = new BoundedSet(512);
  private deleting = new BoundedSet(512);
  private removing = new Set<string>();
  private deferredTerminals = new Map<string, { event: ChatEvent; run: Run }>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private query = 0;
  private offset = 0;
  private selection = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  constructor(private api: ChatTransport, private uuid: () => string = () => crypto.randomUUID()) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<ChatSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  report(error: unknown) { this.patch({ error: errorCode(error) }); }
  clearError() { this.patch({ error: null }); }
  private editable(id: string) {
    if (this.state.suspended) throw "chat_shutting_down";
    if (this.deleted.has(id) || this.deleting.has(id)) throw "chat_not_found";
  }
  private enqueue<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.queues.set(id, next);
    this.patch({ busy: [...this.queues.keys()] });
    void next.finally(() => {
      if (this.queues.get(id) === next) this.queues.delete(id);
      this.patch({ busy: [...this.queues.keys()] });
    }).catch(() => {});
    return next;
  }
  private accept(detail: Detail, includeInHistory = true) {
    const c = detail.conversation;
    if (this.deleted.has(c.id)) return;
    const old = this.state.details[c.id];
    if (old && old.conversation.revision > c.revision) return;
    // Do not replace channel snapshots with an older get/receipt during a run or save failure.
    const run = this.runs.get(c.id);
    const snapshot = this.state.unsaved[c.id];
    const messages = detail.messages.map(message => {
      const local = old?.messages.find(item => item.id === message.id);
      return local && ((run && local.requestId === run.requestId) || snapshot?.messageId === local.id) ? local : message;
    });
    this.patch({
      details: { ...this.state.details, [c.id]: { conversation: c, messages } },
      conversations: this.state.conversations.some(item => item.id === c.id)
        ? this.state.conversations.map(item => item.id === c.id ? c : item)
        : includeInHistory ? [c, ...this.state.conversations] : this.state.conversations,
      drafts: this.state.dirty.includes(c.id) ? this.state.drafts : { ...this.state.drafts, [c.id]: c.draft },
    });
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        const [initial, providers] = await Promise.all([this.api.initialize(), this.api.providers()]);
        const unsaved = Object.fromEntries(initial.unsaved.map(event => [event.conversationId, event]));
        this.offset = initial.conversations.length;
        this.patch({ ready: true, conversations: initial.conversations, providers, unsaved,
          hasMore: initial.conversations.length === 50, error: null });
        if (initial.conversations[0]) await this.select(initial.conversations[0].id);
      } catch (error) { this.starting = undefined; this.report(error); }
    })();
    return this.starting;
  }
  async loadHistory(search = this.state.search, more = false) {
    clearTimeout(this.searchTimer);
    const token = ++this.query;
    const offset = more ? this.offset : 0;
    this.patch({ search, searching: true });
    try {
      const rows = await this.api.list(search, offset);
      if (token !== this.query) return;
      this.offset = offset + rows.length;
      const list = more ? [...this.state.conversations, ...rows] : rows;
      this.patch({ conversations: [...new Map(list.filter(c => !this.deleted.has(c.id)).map(c => [c.id, c])).values()],
        hasMore: rows.length === 50, searching: false });
    } catch (error) {
      if (token === this.query) {
        this.report(error);
        this.patch({ searching: false });
      }
    }
  }
  searchHistory(query: string, delayMs = 250): Promise<void> {
    clearTimeout(this.searchTimer);
    this.patch({ search: query, searching: true });
    return new Promise((resolve) => {
      this.searchTimer = setTimeout(() => {
        resolve(this.loadHistory(query, false));
      }, delayMs);
    });
  }
  clearSearch(): Promise<void> {
    clearTimeout(this.searchTimer);
    return this.loadHistory("", false);
  }
  /** Default callers report and swallow errors; continuation requires confirmed selection. */
  async select(id: string, options: { strict?: boolean } = {}) {
    const token = ++this.selection;
    const previous = this.state.selected;
    this.patch({ selected: id });
    if (previous && previous !== id) void this.flushDraft(previous).catch(error => this.report(error));
    try {
      const detail = await this.api.get(id);
      if (token === this.selection && !this.deleted.has(id)) {
        this.accept(detail);
        const event = this.state.unsaved[id];
        if (event) this.applySnapshot(event);
      }
    } catch (error) {
      if (token === this.selection) this.report(error);
      if (options.strict) throw error;
    }
    if (options.strict && (token !== this.selection || this.deleted.has(id) || this.state.selected !== id)) throw "chat_conflict";
  }
  async loadDetail(id: string) {
    this.editable(id);
    const detail = await this.api.get(id);
    this.editable(id);
    this.accept(detail, false);
    const event = this.state.unsaved[id];
    if (event) this.applySnapshot(event);
    return detail;
  }
  async createUnselected(origin: ConversationOrigin = "workspace") {
    if (this.state.suspended) throw "chat_shutting_down";
    const detail = await this.api.create(origin);
    this.accept(detail, false);
    return detail.conversation.id;
  }
  async refreshProviders() { this.patch({ providers: await this.api.providers() }); }
  async create(origin: ConversationOrigin = "workspace") {
    await this.select(await this.createUnselected(origin));
  }
  setDraft(id: string, draft: string) {
    this.editable(id);
    this.patch({ drafts: { ...this.state.drafts, [id]: draft }, dirty: [...new Set([...this.state.dirty, id])], draftStatus: { ...this.state.draftStatus, [id]: "debouncing" } });
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      void this.flushDraft(id).catch(error => this.report(error));
    }, 250));
  }
  flushDraft(id: string): Promise<void> {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    return this.enqueue(id, () => this.saveDraft(id));
  }
  private async saveDraft(id: string) {
    if (!this.state.dirty.includes(id) || this.deleted.has(id)) return;
    this.patch({ draftStatus: { ...this.state.draftStatus, [id]: "saving" } });
    const draft = this.state.drafts[id];
    const c = this.state.details[id]?.conversation;
    if (!c) throw "chat_not_found";
    try {
      const input = { conversationId: id, revision: c.revision, draft };
      // Exit admission permits the explicit persistence command, not general mutations.
      const detail = this.state.suspended
        ? (await this.api.flush([input]), await this.api.get(id))
        : await this.api.update(input);
      if (this.state.drafts[id] === draft) this.patch({ dirty: this.state.dirty.filter(key => key !== id), draftStatus: { ...this.state.draftStatus, [id]: "clean" } });
      this.accept(detail);
    } catch (error) {
      // Refresh CAS base only; the user's local dirty draft remains authoritative until explicit retry.
      if (error === "chat_conflict") this.accept(await this.api.get(id));
      this.patch({ draftStatus: { ...this.state.draftStatus, [id]: "failed" } });
      throw error;
    }
  }
  update(id: string, values: Omit<UpdateInput, "conversationId" | "revision" | "draft">) {
    this.editable(id);
    return this.enqueue(id, async () => {
      await this.saveDraft(id);
      const c = this.state.details[id].conversation;
      try { this.accept(await this.api.update({ ...values, conversationId: id, revision: c.revision })); }
      catch (error) {
        if (error === "chat_conflict") this.accept(await this.api.get(id));
        throw error;
      }
    });
  }
  /** Quick Chat's main owner may initialize its new ID without changing main selection. */
  bindQuickDefaultModel(id: string, values: { providerId: string; model: string }, isCurrent: () => boolean) {
    return this.bindDefaultModelQueued(id, values, isCurrent, true);
  }
  /** Check again inside the per-conversation queue, after any pending explicit edit. */
  bindDefaultModel(id: string, values: { providerId: string; model: string }, isCurrent: () => boolean = () => true) {
    return this.bindDefaultModelQueued(id, values, isCurrent, false);
  }
  private bindDefaultModelQueued(id: string, values: { providerId: string; model: string }, isCurrent: () => boolean, quick: boolean) {
    this.editable(id);
    return this.enqueue(id, async () => {
      await this.saveDraft(id);
      const c = this.state.details[id]?.conversation;
      if (!isCurrent() || !c || c.model) return;
      if (quick ? c.origin !== "quick-chat" : c.origin === "quick-chat" || this.state.selected !== id) return;
      this.editable(id);
      try {
        this.accept(await this.api.update({ ...values, appType: "chat", conversationId: id, revision: c.revision }));
      } catch (error) {
        if (error === "chat_conflict") this.accept(await this.api.get(id));
        throw error;
      }
    });
  }
  async remove(id: string) {
    this.editable(id);
    if (this.removing.has(id)) throw "chat_not_found";
    this.removing.add(id);
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    try {
      // Cancellation acknowledgement only signals the runtime. Wait for the terminal
      // event and its queued revision refresh before establishing the delete boundary.
      const run = this.runs.get(id);
      await this.stop(id);
      if (run) await run.completion;
      this.deleting.add(id);
      await this.enqueue(id, async () => {
        const latest = await this.api.get(id);
        await this.api.delete(id, latest.conversation.revision);
        this.deleted.add(id); this.runs.delete(id); ++this.query;
        const details = { ...this.state.details }; delete details[id];
        const drafts = { ...this.state.drafts }; delete drafts[id];
        const unsaved = { ...this.state.unsaved }; delete unsaved[id];
        const draftStatus = { ...this.state.draftStatus }; delete draftStatus[id];
        this.patch({ conversations: this.state.conversations.filter(c => c.id !== id), details, drafts, draftStatus, unsaved,
          dirty: this.state.dirty.filter(key => key !== id), running: [...this.runs.keys()],
          selected: this.state.selected === id ? null : this.state.selected });
      });
    } finally {
      this.removing.delete(id);
      this.deleting.delete(id);
      const terminal = this.deferredTerminals.get(id);
      this.deferredTerminals.delete(id);
      // A failed delete still owns its final answer and persistence outcome. Successful
      // deletion discards the deferred event; the deleted fence rejects later delivery.
      if (terminal && !this.deleted.has(id)) this.event(terminal.event, terminal.run);
    }
  }
  async generate(id: string, retry = false, reasoning: ReasoningEffort = "off", images?: readonly string[]) {
    this.editable(id);
    if (this.runs.has(id)) throw "chat_busy";
    if (this.state.unsaved[id] || this.state.dirty.includes(id) && this.state.error) throw "chat_storage";
    let settle!: () => void;
    const completion = new Promise<void>(resolve => { settle = resolve; });
    const run: Run = { requestId: this.uuid(), sequence: -1, terminal: false, stopped: false, completion, settle };
    this.runs.set(id, run); this.patch({ running: [...this.runs.keys()], error: null });
    let accepted = false;
    try {
      await this.enqueue(id, async () => {
        await this.saveDraft(id);
        this.editable(id);
        if (run.stopped) throw "chat_cancelled";
        const c = this.state.details[id].conversation;
        const text = retry ? null : this.state.drafts[id] ?? c.draft;
        if (!retry && !text?.trim()) throw "chat_invalid_input";
        const reasoningValue = reasoning === "off" ? null : reasoning;
        const receipt = await this.api.generate({ conversationId: id, revision: c.revision,
          requestId: run.requestId, appType: c.appType, providerId: c.providerId, model: c.model, text, retry,
          reasoning: reasoningValue,
          images: images?.length ? [...images] : undefined },
        event => this.event(event, run));
        accepted = true;
        if (this.deleted.has(id)) return;
        if (!run.messageId) run.messageId = receipt.id;
        if (run.sequence < 0) this.applyMessage(receipt);
        if (!retry && this.state.drafts[id] === text) {
          this.patch({ drafts: { ...this.state.drafts, [id]: "" }, dirty: this.state.dirty.filter(key => key !== id) });
        }
        const detail = await this.api.get(id);
        // Early channel terminal may precede receipt; never regress it to pending.
        this.accept(detail);
        if (!detail.messages.some(m => m.id === run.messageId)) this.applyMessage(receipt);
      });
    } catch (error) {
      if (!accepted && this.runs.get(id) === run) this.runs.delete(id);
      if (!accepted) run.settle();
      this.patch({ running: [...this.runs.keys()] });
      throw error;
    }
  }
  private applyMessage(message: Message) {
    const detail = this.state.details[message.conversationId];
    if (!detail || this.deleted.has(message.conversationId)) return;
    const messages = detail.messages.some(m => m.id === message.id)
      ? detail.messages.map(m => m.id === message.id ? message : m) : [...detail.messages, message];
    this.patch({ details: { ...this.state.details, [message.conversationId]: { ...detail, messages } } });
  }
  private applySnapshot(event: ChatEvent) {
    const detail = this.state.details[event.conversationId];
    if (!detail || this.deleted.has(event.conversationId)) return;
    const base = detail.messages.find(m => m.id === event.messageId);
    const c = detail.conversation;
    this.applyMessage({ ...(base ?? { id: event.messageId, conversationId: c.id, ordinal: detail.messages.length,
      role: "assistant", replyTo: null, appType: c.appType, providerId: c.providerId, model: c.model,
      createdAt: Date.now(), updatedAt: Date.now() }), requestId: event.requestId, content: event.content,
      status: event.status, errorCode: event.errorCode, finishReason: event.finishReason });
  }
  private event(event: ChatEvent, run: Run) {
    const id = event.conversationId;
    if (this.deleted.has(id) || this.runs.get(id) !== run || run.terminal
      || event.requestId !== run.requestId || event.sequence <= run.sequence
      || (run.messageId && run.messageId !== event.messageId)) return;
    if (this.deleting.has(id)) {
      // Keep the first valid terminal immutable, just as normal event admission does.
      if (event.status !== "pending" && !this.deferredTerminals.has(id)) this.deferredTerminals.set(id, { event, run });
      return;
    }
    run.messageId = event.messageId; run.sequence = event.sequence;
    this.applySnapshot(event);
    if (event.status !== "pending") {
      run.terminal = true;
      const unsaved = { ...this.state.unsaved };
      if (!event.saved) unsaved[id] = event; else delete unsaved[id];
      this.patch({ unsaved });
      // Queue after generate receipt and any draft CAS writes, refresh terminal revision once.
      void this.enqueue(id, async () => {
        try {
          if (!this.deleted.has(id) && !this.deleting.has(id)) this.accept(await this.api.get(id));
        } catch (error) {
          // Only an acknowledged local deletion can make this late refresh obsolete.
          if (error !== "chat_not_found" || !this.deleted.has(id)) throw error;
        } finally {
          if (this.runs.get(id) === run) this.runs.delete(id);
          this.patch({ running: [...this.runs.keys()] });
          run.settle();
        }
      }).catch(error => this.report(error));
    }
  }
  async stop(id: string) {
    const run = this.runs.get(id);
    if (!run) return;
    run.stopped = true;
    await this.api.cancel(id, run.requestId);
  }
  async retryPersistence() {
    // Explicit action only: never reissues a model request.
    const ids = Object.keys(this.state.unsaved);
    await this.api.flush([]);
    for (const id of ids) {
      if (this.deleted.has(id)) continue;
      const detail = await this.api.get(id);
      const unsaved = { ...this.state.unsaved }; delete unsaved[id]; this.patch({ unsaved });
      this.accept(detail);
    }
    await this.loadHistory();
    await this.flush(); this.clearError();
  }
  /** Exit authority integration: freeze editing/new requests, then flush; resume only on abort. */
  suspend() { this.patch({ suspended: true }); }
  async flush() {
    this.timers.forEach(timer => clearTimeout(timer)); this.timers.clear();
    // Prepared native exit has already saved terminal partials. Drain event refresh/CAS
    // queues before writing drafts, so their revisions include the terminal save.
    await Promise.all([...this.queues.values()]);
    if (this.state.suspended) {
      const ids = new Set([...this.state.dirty, ...Object.keys(this.state.unsaved)]);
      await this.api.flush([]);
      for (const id of ids) {
        const detail = await this.api.get(id);
        const unsaved = { ...this.state.unsaved }; delete unsaved[id];
        this.patch({ unsaved }); this.accept(detail);
      }
    }
    await Promise.all([...this.state.dirty].map(id => this.flushDraft(id)));
    await Promise.all([...this.queues.values()]);
    if (Object.keys(this.state.unsaved).length) throw "chat_storage";
  }
  resume() { this.patch({ suspended: false }); }
}
