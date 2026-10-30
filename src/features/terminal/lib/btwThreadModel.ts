/** In-memory thread state machine. Async work is fenced by object identity + generation. */
export interface BtwSource {
  terminalId: string | null;
  sessionId: string | null;
  reason: string | null;
}
export interface BtwContext {
  available: boolean;
  text: string;
  truncated: boolean;
  reason: string | null;
}
export interface BtwMessage { role: "user" | "assistant"; content: string }
export type BtwStatus = "idle" | "pending" | "done" | "failed" | "stopped";
export interface BtwThread {
  id: string;
  source: BtwSource;
  quote: string;
  title: string;
  inherit: boolean;
  context: BtwContext;
  contextLoading: boolean;
  messages: BtwMessage[];
  draft: string;
  status: BtwStatus;
  answer: string;
  error: string | null;
  pinned?: boolean;
  archived?: boolean;
  createdAt?: number;
  generation: number;
  requestId: string | null;
  contextRequestId: string | null;
}
export interface BtwReaderState { scrollTop: number; following: boolean; content: string; unread: boolean }
export const freshBtwReader = (): BtwReaderState => ({ scrollTop: 0, following: true, content: "", unread: false });
export interface BtwState {
  persistenceError: string | null;
  terminalId: string | null;
  drawerOpen: boolean;
  collapsed: boolean;
  question: string;
  quote: string;
  source: BtwSource;
  inherit: boolean;
  context: BtwContext;
  contextLoading: boolean;
  entries: BtwThread[];
  openId: string | null;
  openVersion: number;
  embeddedId: string | null;
  stageVersion: number;
}
export interface BtwProgress { requestId: string; threadId: string; text: string }
export interface BtwAsk {
  requestId: string;
  threadId: string;
  quote: string;
  context: string;
  messages: BtwMessage[];
}
export interface BtwContextRequest { requestId: string; sourceSessionId: string }
export interface BtwThreadPersistence {
  list: (options?: { query?: string; includeArchived?: boolean; limit?: number; offset?: number; terminalId?: string }) => Promise<BtwThread[]>;
  save: (thread: BtwThread) => Promise<void>;
  remove: (threadId: string) => Promise<void>;
  patch?: (threadId: string, patch: { pinned?: boolean; archived?: boolean; title?: string }) => Promise<void>;
}
export interface BtwTransport {
  context: (request: BtwContextRequest) => Promise<BtwContext>;
  ask: (request: BtwAsk) => Promise<string>;
  cancel: (requestId: string) => Promise<unknown>;
  listen: (callback: (event: BtwProgress) => void) => Promise<() => void>;
}
const missingSource = (): BtwSource => ({ terminalId: null, sessionId: null, reason: "no_source_session" });
const unavailable = (reason = "no_source_session"): BtwContext => ({ available: false, text: "", truncated: false, reason });
const initial = (): BtwState => ({ persistenceError: null, terminalId: null, drawerOpen: false, collapsed: false, question: "", quote: "", source: missingSource(), inherit: false,
  context: unavailable(), contextLoading: false, entries: [], openId: null, openVersion: 0, embeddedId: null, stageVersion: 0 });
let serial = 0;
const id = () => `btw-${Date.now()}-${++serial}`;

export class BtwThreadModel {
  private state = initial();
  // UI snapshots are session-memory only; source objects are captured, never re-resolved on switch.
  private terminalViews = new Map<string, Partial<BtwState>>();
  private readers = new Map<string, BtwReaderState>();
  getReader = (threadId: string) => this.readers.get(threadId) ?? freshBtwReader();
  setReader = (threadId: string, reader: BtwReaderState) => {
    if (this.find(threadId)) this.readers.set(threadId, reader);
  };
  setCollapsed = (collapsed: boolean) => this.publish({ collapsed });
  setDrawerOpen = (drawerOpen: boolean) => this.publish({ drawerOpen });
  activateTerminal = (terminalId: string | null) => {
    if (terminalId === this.state.terminalId) return;
    if (this.state.terminalId) {
      const { question, quote, source, inherit, context, contextLoading, embeddedId, drawerOpen, collapsed } = this.state;
      this.terminalViews.set(this.state.terminalId, { question, quote, source, inherit, context, contextLoading, embeddedId, drawerOpen, collapsed });
    }
    const saved = terminalId ? this.terminalViews.get(terminalId) : undefined;
    this.publish({ question: "", quote: "", source: { ...missingSource(), terminalId }, inherit: false,
      context: unavailable(), contextLoading: false, embeddedId: null, drawerOpen: false, collapsed: false,
      ...saved, terminalId, stageVersion: this.state.stageVersion + 1 });
  };
  reconcileTerminals = (terminalIds: string[]) => {
    const live = new Set(terminalIds);
    for (const key of this.terminalViews.keys()) if (!live.has(key)) this.terminalViews.delete(key);
    for (const thread of this.state.entries) if (thread.source.terminalId && !live.has(thread.source.terminalId)) this.readers.delete(thread.id);
    if (this.state.terminalId && !live.has(this.state.terminalId)) this.activateTerminal(null);
    // activateTerminal saved the closing view; it must not resurrect on an ID reuse.
    for (const key of this.terminalViews.keys()) if (!live.has(key)) this.terminalViews.delete(key);
  };
  private listeners = new Set<() => void>();
  private subscriptions = new Map<string, () => void>();
  private disposed = false;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private pendingWrites = new Map<string, () => Promise<void>>();
  private failedWrites = new Map<string, () => Promise<void>>();
  private scheduledWrites = new Set<string>();
  private historyError: string | null = null;
  private deletedIds = new Set<string>();
  private historyVersion = 0;
  private starting: Promise<void> | null = null;
  /** Coalesce streaming snapshots by thread; deletes share the same ordered queue. */
  private enqueue(key: string, work: () => Promise<void>) {
    this.pendingWrites.set(key, work);
    if (this.scheduledWrites.has(key)) return;
    this.scheduledWrites.add(key);
    this.persistenceQueue = this.persistenceQueue.then(async () => {
      this.scheduledWrites.delete(key);
      const next = this.pendingWrites.get(key);
      if (!next) return;
      this.pendingWrites.delete(key);
      try {
        await next();
        this.failedWrites.delete(key);
        if (!this.failedWrites.size) this.publish({ persistenceError: this.historyError });
      } catch (error) {
        this.failedWrites.set(key, next);
        this.publish({ persistenceError: String(error) });
      }
    });
  }
  private persist(thread: BtwThread) {
    if (!this.persistence || this.disposed) return;
    this.enqueue(thread.id, () => this.persistence!.save(thread));
  }
  /** Await accepted writes for reads/tests; this is not an application-exit barrier. */
  flushPersistence = async () => { do { const pending = this.persistenceQueue; await pending; if (pending === this.persistenceQueue) break; } while (true); };
  retryPersistence = async () => {
    for (const [key, work] of this.failedWrites) if (!this.pendingWrites.has(key)) this.enqueue(key, work);
    await this.flushPersistence();
    if (!this.failedWrites.size) await this.loadHistory("", true);
  };
  constructor(private transport: BtwTransport, private persistence?: BtwThreadPersistence) {}
  private recovered(thread: BtwThread): BtwThread {
    return { ...thread, status: thread.status === "pending" || thread.contextLoading || (thread.inherit && !thread.context.available && !!thread.draft) ? "stopped" : thread.status,
      contextLoading: false, requestId: null, contextRequestId: null, generation: 0 };
  }
  /** Hydration never suppresses concurrent user writes or invokes inference. */
  start = (): Promise<void> => {
    if (!this.starting) this.starting = this.loadHistory("", false);
    return this.starting;
  };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<BtwState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());

  }
  private replace(thread: BtwThread, update: Partial<BtwThread>) {
    const next = { ...thread, ...update };
    this.persist(next);
    this.publish({ entries: this.state.entries.map((item) => item === thread ? next : item) });
    return next;
  }
  private find(threadId: string) { return this.state.entries.find((item) => item.id === threadId); }
  private cancel(requestId: string | null) {
    if (!requestId) return;
    this.subscriptions.get(requestId)?.();
    this.subscriptions.delete(requestId);
    void this.transport.cancel(requestId).catch(() => {});
  }
  private loadContext(thread: BtwThread, autoSend: boolean) {
    const requestId = id();
    const generation = thread.generation;
    this.replace(thread, { contextRequestId: requestId, contextLoading: true, status: "idle", error: null });
    const current = () => {
      const value = this.find(thread.id);
      return !this.disposed && value?.generation === generation && value.contextRequestId === requestId ? value : null;
    };
    const finish = (context: BtwContext) => {
      const value = current();
      if (!value) { this.cancel(requestId); return; }
      this.replace(value, { context: { ...context }, contextLoading: false, contextRequestId: null,
        status: context.available ? "idle" : "failed", error: context.available ? null : context.reason ?? "source_unreadable" });
      // Requested inheritance must never silently degrade to a context-free send.
      if (context.available && autoSend) this.send(thread.id);
    };
    if (!current()) { this.cancel(requestId); return; }
    if (thread.source.reason || !thread.source.sessionId) {
      finish(unavailable(thread.source.reason ?? "no_source_session"));
      return;
    }
    try {
      void this.transport.context({ requestId, sourceSessionId: thread.source.sessionId })
        .then(finish, (error) => finish(unavailable(String(error))));
    } catch (error) { finish(unavailable(String(error))); }
  }
  stage = (quote: string, source: BtwSource) => {
    this.activateTerminal(source.terminalId);
    // Draft staging captures identity only, never transcript text. Snapshot at creation.
    this.publish({ question: "", quote, source: { ...source }, inherit: false,
      embeddedId: null, drawerOpen: true, collapsed: false, stageVersion: this.state.stageVersion + 1,
      context: unavailable(source.reason ?? "inherit_off"), contextLoading: false });
  };
  setQuestion = (question: string) => this.publish({ question });
  setInherit = (inherit: boolean) => this.publish({ inherit: inherit && !this.state.source.reason && !!this.state.source.sessionId });
  /** Embedded selection is owner state, independent of native-window reveal state. */
  submitEmbedded = (): string | null => {
    const embeddedId = this.submit();
    if (embeddedId) this.publish({ embeddedId });
    return embeddedId;
  };
  /** Restoring an embedded reader never changes the native reveal revision. */
  selectEmbedded = (embeddedId: string) => {
    const thread = this.find(embeddedId);
    if (!thread) return;
    // All-history records keep the current terminal UI/source identity.
    // The thread itself retains its original immutable source snapshot.
    if (!this.readers.has(embeddedId)) this.readers.set(embeddedId, { ...freshBtwReader(), following: false,
      content: JSON.stringify([thread.messages, thread.answer, thread.error]) });
    this.publish({ embeddedId, drawerOpen: true, collapsed: false, stageVersion: this.state.stageVersion + 1 });
  };
  open = (openId: string | null) => this.publish({ openId, openVersion: this.state.openVersion + 1 });
  rename = (threadId: string, title: string) => { const thread = this.find(threadId); if (thread) { this.replace(thread, { title }); } };
  pin = (threadId: string, pinned = true) => { const thread = this.find(threadId); if (thread) { this.replace(thread, { pinned }); } };
  archive = (threadId: string, archived = true) => { const thread = this.find(threadId); if (thread) { this.replace(thread, { archived }); } };
  search = async (query: string, options: { includeArchived?: boolean; limit?: number } = {}) => this.persistence?.list({ ...options, query }) ?? [];
  /** Latest query wins; projections never write stale rows back to storage. */
  loadHistory = async (query = "", includeArchived = false, terminalId?: string, offset = 0) => {
    if (!this.persistence || this.disposed) return;
    const version = ++this.historyVersion;
    try {
      await this.flushPersistence();
      const entries = await this.persistence.list({ query, includeArchived, limit: 100, terminalId, offset });
      if (this.disposed || version !== this.historyVersion) return;
      this.historyError = null;
      if (!this.failedWrites.size) this.publish({ persistenceError: null });
      const live = this.state.entries;
      const liveIds = new Set(live.map((thread) => thread.id));
      this.publish({ entries: [...live, ...entries.filter((thread) => !liveIds.has(thread.id) && !this.deletedIds.has(thread.id))
        .map((thread) => this.recovered(thread))] });
    } catch (error) { this.historyError = String(error); this.publish({ persistenceError: this.historyError }); }
  };
  setDraft = (threadId: string, draft: string) => {
    const thread = this.find(threadId);
    if (thread) this.replace(thread, { draft });
  };
  submit = (): string | null => {
    const question = this.state.question.trim();
    if (!question || (this.state.inherit && this.state.contextLoading)) return null;
    const thread: BtwThread = { id: id(), source: { ...this.state.source }, quote: this.state.quote, title: question,
      createdAt: Date.now(), inherit: this.state.inherit,
      context: unavailable(this.state.source.reason ?? "inherit_off"), contextLoading: this.state.inherit,
      messages: [], draft: question, status: "idle", answer: "", error: null, generation: 0, requestId: null, contextRequestId: null };
    this.persist(thread);
    this.publish({ entries: [...this.state.entries, thread], question: "", inherit: false });
    if (!thread.inherit) this.send(thread.id);
    else this.loadContext(thread, true);
    return thread.id;
  };
  send = (threadId: string, retry = false) => {
    const thread = this.find(threadId);
    if (!thread || thread.requestId || thread.contextLoading) return;
    if (retry && thread.status !== "failed" && thread.status !== "stopped") return;
    if (thread.inherit && !thread.context.available) {
      if (retry) this.loadContext(thread, true);
      return;
    }
    const question = thread.draft.trim();
    if (!retry && (!question || thread.messages[thread.messages.length - 1]?.role === "user")) return;
    const messages = retry ? thread.messages : [...thread.messages, { role: "user" as const, content: question }];
    if (messages[messages.length - 1]?.role !== "user") return;
    const requestId = id();
    const generation = thread.generation + 1;
    this.replace(thread, { messages, requestId, generation, draft: "", status: "pending", answer: "", error: null });
    const current = () => {
      const value = this.find(threadId);
      return !this.disposed && value?.requestId === requestId && value.generation === generation ? value : null;
    };
    void (async () => {
      let unlisten: (() => void) | undefined;
      try {
        // Listener must be installed before invoke, including synchronous backend progress.
        const release = await this.transport.listen((event) => {
          const value = current();
          if (value && event.requestId === requestId && event.threadId === threadId) this.replace(value, { answer: event.text });
        });
        let released = false;
        unlisten = () => { if (!released) { released = true; release(); } };
        if (!current()) return;
        this.subscriptions.set(requestId, unlisten);
        const answer = await this.transport.ask({ requestId, threadId, quote: thread.quote,
          context: thread.inherit ? thread.context.text : "", messages });
        const value = current();
        if (value) this.replace(value, { messages: [...messages, { role: "assistant", content: answer }],
          status: "done", requestId: null, answer, error: null });
      } catch (error) {
        const value = current();
        if (value) this.replace(value, { status: "failed", requestId: null, error: String(error) });
      } finally {
        if (this.subscriptions.get(requestId) === unlisten) this.subscriptions.delete(requestId);
        unlisten?.();
      }
    })();
  };
  stop = (threadId: string) => {
    const thread = this.find(threadId);
    if (!thread || (!thread.requestId && !thread.contextRequestId)) return;
    this.replace(thread, { status: "stopped", requestId: null, contextRequestId: null,
      contextLoading: false, generation: thread.generation + 1 });
    this.cancel(thread.requestId);
    this.cancel(thread.contextRequestId);
  };
  remove = (threadId: string) => {
    const thread = this.find(threadId);
    this.deletedIds.add(threadId);
    this.readers.delete(threadId);
    for (const view of this.terminalViews.values()) if (view.embeddedId === threadId) view.embeddedId = null;
    this.publish({ entries: this.state.entries.filter((item) => item.id !== threadId),
      openId: this.state.openId === threadId ? null : this.state.openId,
      embeddedId: this.state.embeddedId === threadId ? null : this.state.embeddedId });
    if (this.persistence) this.enqueue(threadId, () => this.persistence!.remove(threadId));
    this.cancel(thread?.requestId ?? null);
    this.cancel(thread?.contextRequestId ?? null);
  };
  /** Caller obtains explicit in-app confirmation before reset or mode changes. */
  reset = (threadId: string, inherit?: boolean) => {
    const thread = this.find(threadId);
    if (!thread) return;
    const generation = thread.generation + 1;
    const mode = inherit ?? thread.inherit;
    const next = this.replace(thread, { generation, requestId: null, contextRequestId: null, messages: [], answer: "", error: null,
      draft: thread.title, status: "idle", inherit: mode, contextLoading: mode, context: unavailable(thread.source.reason ?? "inherit_off") });
    this.cancel(thread.requestId);
    this.cancel(thread.contextRequestId);
    if (mode) this.loadContext(next, false);
  };
  clear = () => {
    const entries = this.state.entries;
    this.terminalViews.clear(); this.readers.clear();
    this.publish(initial());
    entries.forEach((thread) => { this.cancel(thread.requestId); this.cancel(thread.contextRequestId); });
    for (const thread of entries) {
      this.deletedIds.add(thread.id);
      if (this.persistence) this.enqueue(thread.id, () => this.persistence!.remove(thread.id));
    }
  };
  dispose = () => {
    // Teardown is not a user deletion. Accepted snapshots remain queued.
    this.disposed = true;
    for (const thread of this.state.entries) {
      this.cancel(thread.requestId);
      this.cancel(thread.contextRequestId);
    }
    for (const release of this.subscriptions.values()) release();
    this.subscriptions.clear();
    this.listeners.clear();
  };
}

export function btwThreadText(thread: BtwThread): string {
  return thread.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}
