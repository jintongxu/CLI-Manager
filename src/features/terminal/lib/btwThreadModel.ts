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
  generation: number;
  requestId: string | null;
  contextRequestId: string | null;
}
export interface BtwState {
  question: string;
  quote: string;
  source: BtwSource;
  inherit: boolean;
  context: BtwContext;
  contextLoading: boolean;
  entries: BtwThread[];
  openId: string | null;
  openVersion: number;
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
  list: (options?: { query?: string; includeArchived?: boolean; limit?: number }) => Promise<BtwThread[]>;
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
const initial = (): BtwState => ({ question: "", quote: "", source: missingSource(), inherit: false,
  context: unavailable(), contextLoading: false, entries: [], openId: null, openVersion: 0 });
let serial = 0;
const id = () => `btw-${Date.now()}-${++serial}`;

export class BtwThreadModel {
  private state = initial();
  private listeners = new Set<() => void>();
  private subscriptions = new Map<string, () => void>();
  private disposed = false;
  private persistenceQueue: Promise<unknown> = Promise.resolve();
  private hydrating = false;
  private persist(thread: BtwThread | null) {
    if (this.hydrating || !this.persistence || this.disposed) return;
    const work = thread ? () => this.persistence!.save(thread) : () => Promise.resolve();
    this.persistenceQueue = this.persistenceQueue.then(work, work).catch(() => {});
  }
  constructor(private transport: BtwTransport, private persistence?: BtwThreadPersistence) {}
  /** Hydration is display-only: it never invokes context or inference. */
  async start() {
    if (!this.persistence || this.disposed) return;
    this.hydrating = true;
    try { const entries = await this.persistence.list(); if (!this.disposed) this.publish({ entries: entries.map((thread) => ({ ...thread, contextLoading: false, requestId: null, contextRequestId: null, generation: 0 })) }); }
    finally { this.hydrating = false; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<BtwState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
    if (update.entries) update.entries.forEach((thread) => this.persist(thread));
  }
  private replace(thread: BtwThread, update: Partial<BtwThread>) {
    const next = { ...thread, ...update };
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
    // Draft staging captures identity only, never transcript text. Snapshot at creation.
    this.publish({ question: "", quote, source: { ...source }, inherit: true,
      context: unavailable(source.reason ?? "inherit_off"), contextLoading: false });
  };
  setQuestion = (question: string) => this.publish({ question });
  setInherit = (inherit: boolean) => this.publish({ inherit });
  open = (openId: string | null) => this.publish({ openId, openVersion: this.state.openVersion + 1 });
  rename = (threadId: string, title: string) => { const thread = this.find(threadId); if (thread) { this.replace(thread, { title }); this.patchPersist(threadId, { title }); } };
  pin = (threadId: string, pinned = true) => { const thread = this.find(threadId); if (thread) { this.replace(thread, { pinned }); this.patchPersist(threadId, { pinned }); } };
  archive = (threadId: string, archived = true) => { const thread = this.find(threadId); if (thread) { this.replace(thread, { archived }); this.patchPersist(threadId, { archived }); } };
  search = async (query: string, options: { includeArchived?: boolean; limit?: number } = {}) => this.persistence?.list({ ...options, query }) ?? [];
  /** Replace the visible history from the repository; hydration never invokes inference. */
  loadHistory = async (query = "", includeArchived = false) => {
    if (!this.persistence) return;
    const entries = await this.persistence.list({ query, includeArchived, limit: 100 });
    if (!this.disposed) this.publish({ entries: entries.slice().sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) });
  };
  private patchPersist(threadId: string, patch: { pinned?: boolean; archived?: boolean; title?: string }) {
    if (this.persistence?.patch) void this.persistence.patch(threadId, patch).catch(() => {});
  }
  setDraft = (threadId: string, draft: string) => {
    const thread = this.find(threadId);
    if (thread) this.replace(thread, { draft });
  };
  submit = () => {
    const question = this.state.question.trim();
    if (!question || (this.state.inherit && this.state.contextLoading)) return;
    const thread: BtwThread = { id: id(), source: { ...this.state.source }, quote: this.state.quote, title: question,
      inherit: this.state.inherit, context: unavailable(this.state.source.reason ?? "inherit_off"), contextLoading: this.state.inherit,
      messages: [], draft: question, status: "idle", answer: "", error: null, generation: 0, requestId: null, contextRequestId: null };
    this.publish({ entries: [...this.state.entries, thread], question: "", inherit: true });
    if (!thread.inherit) this.send(thread.id);
    else this.loadContext(thread, true);
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
    if (!thread?.requestId) return;
    this.replace(thread, { status: "stopped", requestId: null, generation: thread.generation + 1 });
    this.cancel(thread.requestId);
  };
  remove = (threadId: string) => {
    const thread = this.find(threadId);
    this.publish({ entries: this.state.entries.filter((item) => item.id !== threadId),
      openId: this.state.openId === threadId ? null : this.state.openId });
    if (this.persistence && !this.hydrating) this.persistenceQueue = this.persistenceQueue.then(() => this.persistence!.remove(threadId), () => this.persistence!.remove(threadId)).catch(() => {});
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
    this.publish(initial());
    entries.forEach((thread) => { this.cancel(thread.requestId); this.cancel(thread.contextRequestId); });
    if (this.persistence && !this.hydrating) for (const thread of entries) this.persistenceQueue = this.persistenceQueue.then(() => this.persistence!.remove(thread.id), () => this.persistence!.remove(thread.id)).catch(() => {});
  };
  dispose = () => {
    this.clear();
    this.disposed = true;
    this.listeners.clear();
  };
}

export function btwThreadText(thread: BtwThread): string {
  return thread.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}
