export const CHAT_ORDER_STORAGE_KEY = "cli-manager.chat.conversationOrder";
export const CHAT_PINNED_STORAGE_KEY = "cli-manager.chat.pinnedConversations";

export function readPinnedIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(CHAT_PINNED_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function persistPinnedIds(ids: readonly string[]) {
  try {
    localStorage.setItem(CHAT_PINNED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // The in-memory pinned state still applies for this window.
  }
}

export function applyPinnedOrder<T extends { id: string }>(items: readonly T[], pinnedIds: readonly string[]): T[] {
  const pinned = new Set(pinnedIds);
  return [...items.filter((item) => pinned.has(item.id)), ...items.filter((item) => !pinned.has(item.id))];
}


/** Moves `sourceId` to `targetId`'s slot; returns null when the move is a no-op. */
export function moveWithinOrder(
  order: readonly string[],
  sourceId: string,
  targetId: string
): string[] | null {
  if (sourceId === targetId) return null;
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Moves the row at `from` to the final index `to`; returns null when nothing changes. */
export function moveIndexWithinOrder(
  order: readonly string[],
  from: number,
  to: number
): string[] | null {
  if (from === to || from < 0 || to < 0 || from >= order.length) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(to, next.length), 0, moved);
  return next;
}

/** Applies a stored/manual order, keeping unknown (newly created) chats on top. */
export function applyStoredOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[] | null
): T[] {
  if (!order || !order.length) return [...items];
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      result.push(item);
      byId.delete(id);
    }
  }
  return [...byId.values(), ...result];
}

export function readStoredOrder(): string[] {
  try {
    const raw = localStorage.getItem(CHAT_ORDER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function persistOrder(order: readonly string[]) {
  try {
    localStorage.setItem(CHAT_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage unavailable: the in-memory order still applies for this session.
  }
}
