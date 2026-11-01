import type { ReasoningEffort } from "./types";

export const CHAT_REASONING_STORAGE_KEY = "cli-manager.chat.reasoning";

export const REASONING_LEVELS: ReasoningEffort[] = ["off", "low", "medium", "high"];

function readMap(): Record<string, ReasoningEffort> {
  try {
    const raw = localStorage.getItem(CHAT_REASONING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ReasoningEffort>) : {};
  } catch {
    return {};
  }
}

export function readReasoning(conversationId: string): ReasoningEffort {
  const level = readMap()[conversationId];
  return level && REASONING_LEVELS.includes(level) ? level : "medium";
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
