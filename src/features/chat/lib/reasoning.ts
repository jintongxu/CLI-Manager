import type { ReasoningEffort } from "./types";
import { normalizeReasoningFor } from "./reasoningCapabilities";
import { normalizeChatDefaultReasoningEffort } from "../../../shared/preferences/chatDefaultReasoning";

export const CHAT_REASONING_STORAGE_KEY = "cli-manager.chat.reasoning";

/** Compatibility fallback when no persisted default preference is available. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export const REASONING_LEVELS: ReasoningEffort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function readMap(): Record<string, ReasoningEffort> {
  try {
    const raw = localStorage.getItem(CHAT_REASONING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ReasoningEffort>) : {};
  } catch {
    return {};
  }
}

export function readReasoning(conversationId: string, defaultEffort: unknown = DEFAULT_REASONING_EFFORT): ReasoningEffort {
  const level = readMap()[conversationId];
  return level && REASONING_LEVELS.includes(level)
    ? normalizeReasoningFor(null, null, level)
    : normalizeChatDefaultReasoningEffort(defaultEffort);
}

export function persistReasoning(conversationId: string, level: ReasoningEffort) {
  try {
    const map = readMap();
    map[conversationId] = level;
    localStorage.setItem(CHAT_REASONING_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}
