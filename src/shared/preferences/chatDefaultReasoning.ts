export type ChatDefaultReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Missing or invalid persisted values retain the default for new conversations. */
export function normalizeChatDefaultReasoningEffort(value: unknown): ChatDefaultReasoningEffort {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return value;
    default:
      return "medium";
  }
}
