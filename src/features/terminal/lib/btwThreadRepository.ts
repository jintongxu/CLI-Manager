import { getDb } from "../../../shared/platform/db";
import type { BtwContext, BtwMessage, BtwStatus, BtwThread } from "./btwThreadModel";

export const BTW_LIMITS = { title: 512, quote: 32_000, question: 32_000, message: 128_000, context: 128_000, error: 16_000 } as const;
export interface BtwThreadPatch { title?: string; draft?: string; status?: BtwStatus; error?: string | null; pinned?: boolean; archived?: boolean; inherit?: boolean; context?: BtwContext; }
export interface BtwThreadSearchOptions { query?: string; includeArchived?: boolean; limit?: number; offset?: number; terminalId?: string; }
let writeQueue: Promise<unknown> = Promise.resolve();
const serialized = <T>(work: () => Promise<T>): Promise<T> => {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
};
const text = (value: string | null | undefined, limit: number, field: string) => {
  const result = value ?? "";
  if (result.length > limit) throw new Error(`btw_${field}_too_long`);
  return result;
};
const bool = (v: unknown) => Number(v) !== 0;
function mapThread(row: Record<string, unknown>, messages: BtwMessage[] = []): BtwThread {
  const context: BtwContext = { available: Boolean(row.context_snapshot), text: String(row.context_snapshot ?? ""), truncated: bool(row.context_truncated), reason: row.context_reason == null ? null : String(row.context_reason) };
  const status = String(row.status ?? "idle") as BtwStatus;
  // A pending/stopped trailing assistant row is a durable partial, not a completed turn.
  const partial = (status === "pending" || status === "stopped" || status === "failed") && messages[messages.length - 1]?.role === "assistant"
    ? messages[messages.length - 1]!.content : "";
  if (partial) messages = messages.slice(0, -1);
  return {
    id: String(row.id), pinned: bool(row.pinned), archived: bool(row.archived), createdAt: Number(row.created_at),
    source: {
      terminalId: row.source_terminal_id == null ? null : String(row.source_terminal_id),
      sessionId: row.source_session_id == null ? null : String(row.source_session_id),
      reason: row.source_reason == null ? null : String(row.source_reason),
    },
    quote: String(row.quote ?? ""), title: String(row.title ?? ""), inherit: bool(row.inherit),
    context, contextLoading: false, messages, draft: String(row.draft ?? ""),
    status: status === "pending" ? "stopped" : status,
    answer: partial || (status === "done" ? ([...messages].reverse().find((message) => message.role === "assistant")?.content ?? "") : ""),
    error: row.error == null ? null : String(row.error), generation: 0,
    requestId: null, contextRequestId: null,
  };
}
async function loadMessages(ids: string[]): Promise<Map<string, BtwMessage[]>> {
  const result = new Map<string, BtwMessage[]>(); if (!ids.length) return result;
  const db = await getDb(); const slots = ids.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT thread_id, role, content
     FROM btw_messages
     WHERE thread_id IN (${slots})
     ORDER BY thread_id, ordinal`, ids);
  for (const row of rows) { const list = result.get(String(row.thread_id)) ?? []; list.push({ role: String(row.role) as BtwMessage["role"], content: String(row.content) }); result.set(String(row.thread_id), list); }
  return result;
}
export async function listBtwThreads(options: BtwThreadSearchOptions = {}): Promise<BtwThread[]> {
  const db = await getDb(); const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50))); const args: unknown[] = [];
  let where = options.includeArchived ? "1=1" : "archived = 0";
  // Filter before LIMIT so other projects cannot crowd out this terminal's history.
  if (options.terminalId !== undefined) {
    args.push(options.terminalId);
    where += ` AND source_terminal_id = $${args.length}`;
  }
  if (options.query?.trim()) {
    const q = `%${options.query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    args.push(q);
    const slot = `$${args.length}`;
    where += ` AND (title LIKE ${slot} ESCAPE '\\'
      OR draft LIKE ${slot} ESCAPE '\\'
      OR quote LIKE ${slot} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM btw_messages m
        WHERE m.thread_id = btw_threads.id AND m.content LIKE ${slot} ESCAPE '\\'))`;
  }
  args.push(limit, Math.max(0, Math.trunc(options.offset ?? 0))); const rows = await db.select<Record<string, unknown>[]>(`SELECT * FROM btw_threads WHERE ${where} ORDER BY pinned DESC, updated_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  const messages = await loadMessages(rows.map(r => String(r.id))); return rows.map(r => mapThread(r, messages.get(String(r.id)) ?? []));
}
export async function getBtwThread(id: string): Promise<BtwThread | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM btw_threads WHERE id=$1 LIMIT 1", [id]);
  if (!rows[0]) return null;
  const messages = await loadMessages([id]);
  return mapThread(rows[0], messages.get(id) ?? []);
}
async function createThread(thread: Pick<BtwThread, "id" | "source" | "quote" | "title" | "inherit" | "context" | "messages" | "draft" | "status" | "error">): Promise<void> {
  const db = await getDb(); const now = Date.now(); const title = text(thread.title, BTW_LIMITS.title, "title"); const quote = text(thread.quote, BTW_LIMITS.quote, "quote"); const context = text(thread.context.text, BTW_LIMITS.context, "context");
    await db.execute(
      "INSERT INTO btw_threads " +
      "(id,source_terminal_id,source_session_id,source_reason,quote,title,inherit," +
      "context_snapshot,context_reason,context_truncated,status,draft,error,pinned,archived," +
      "created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,$14,$14)",
      [thread.id, thread.source.terminalId, thread.source.sessionId, thread.source.reason,
        quote, title, thread.inherit ? 1 : 0, context, thread.context.reason,
        thread.context.truncated ? 1 : 0, thread.status,
        text(thread.draft, BTW_LIMITS.question, "question"),
        thread.error == null ? null : text(thread.error, BTW_LIMITS.error, "error"), now],
    );
    await replaceBtwMessages(thread.id, thread.messages);
}
/** One complete save is serialized, including existence check and message replacement. */
export async function saveBtwThread(thread: BtwThread): Promise<void> {
  return serialized(async () => {
    const messages = thread.status !== "done" && thread.answer
      ? [...thread.messages, { role: "assistant" as const, content: thread.answer }] : thread.messages;
    const existing = await getBtwThread(thread.id);
    if (!existing) return createThread({ ...thread, messages });
    await replaceBtwMessages(thread.id, messages);
    await updateThread(thread.id, {
      title: thread.title, draft: thread.draft, status: thread.status,
      error: thread.error, inherit: thread.inherit, context: thread.context,
      pinned: thread.pinned, archived: thread.archived,
    });
  });
}
export const createBtwThread = (thread: Parameters<typeof createThread>[0]) => serialized(() => createThread(thread));
export const updateBtwThread = (id: string, patch: BtwThreadPatch) => serialized(() => updateThread(id, patch));
async function updateThread(id: string, patch: BtwThreadPatch): Promise<void> {
    const db = await getDb(); const sets: string[] = []; const values: unknown[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); sets.push(`${sql}=$${values.length}`); };
    if (patch.title !== undefined) add("title", text(patch.title, BTW_LIMITS.title, "title"));
    if (patch.draft !== undefined) add("draft", text(patch.draft, BTW_LIMITS.question, "question"));
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.error !== undefined) add("error", patch.error == null ? null : text(patch.error, BTW_LIMITS.error, "error"));
    if (patch.pinned !== undefined) add("pinned", patch.pinned ? 1 : 0);
    if (patch.archived !== undefined) add("archived", patch.archived ? 1 : 0);
    if (patch.inherit !== undefined) add("inherit", patch.inherit ? 1 : 0);
    if (patch.context) {
      add("context_snapshot", text(patch.context.text, BTW_LIMITS.context, "context"));
      add("context_reason", patch.context.reason); add("context_truncated", patch.context.truncated ? 1 : 0);
    }
    if (!sets.length) return;
    values.push(Date.now(), id);
    await db.execute(`UPDATE btw_threads SET ${sets.join(",")}, updated_at=$${values.length - 1} WHERE id=$${values.length}`, values);
}
export async function replaceBtwMessages(threadId: string, messages: readonly BtwMessage[]): Promise<void> {
  if (messages.length > 500) throw new Error("btw_messages_too_many");
  for (const message of messages) text(message.content, BTW_LIMITS.message, "message");
  const db = await getDb();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    await db.execute(
      "INSERT INTO btw_messages(thread_id,ordinal,role,content,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(thread_id,ordinal) DO UPDATE SET role=excluded.role,content=excluded.content",
      [threadId, i, message.role, message.content, Date.now()],
    );
  }
  await db.execute("DELETE FROM btw_messages WHERE thread_id=$1 AND ordinal >= $2", [threadId, messages.length]);
}
export const archiveBtwThread = (id: string) => updateBtwThread(id, { archived: true });
export const restoreBtwThread = (id: string) => updateBtwThread(id, { archived: false });
export async function deleteBtwThread(id: string): Promise<void> { return serialized(async () => { const db = await getDb(); await db.execute("DELETE FROM btw_threads WHERE id=$1", [id]); }); }
export const pinBtwThread = (id: string, pinned = true) => updateBtwThread(id, { pinned });
export const renameBtwThread = (id: string, title: string) => updateBtwThread(id, { title });
/** Search is deliberately delegated to the repository so callers never scan hydrated state. */
export const searchBtwThreads = (query: string, options: Omit<BtwThreadSearchOptions, "query"> = {}) =>
  listBtwThreads({ ...options, query });
