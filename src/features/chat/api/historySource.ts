/** Explicit navigation context; never inferred from selected conversation origin. */
export const CHAT_HISTORY_SOURCES = ["workspace", "sidebar", "quick-chat"] as const;
export type ChatHistorySource = typeof CHAT_HISTORY_SOURCES[number];
