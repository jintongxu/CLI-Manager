/** Reasoning effort is an OpenAI-family request option; other protocols ignore it. */
export type ReasoningEffort = "default" | "minimal" | "low" | "medium" | "high";

export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = ["default", "minimal", "low", "medium", "high"];

/** `default` means "send no field at all" so unchanged requests stay byte-identical. */
export function reasoningPayload(effort: ReasoningEffort): string | null {
  return effort === "default" ? null : effort;
}
