import type { ReasoningEffort } from "../lib/types";

export type { ReasoningEffort };
export type { ReasoningEffort as ChatPanelReasoningEffort };

/** `off` is the "send nothing" level, matching the full chat workspace. */
export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = ["off", "low", "medium", "high"];

export function reasoningPayload(effort: ReasoningEffort): ReasoningEffort | null {
  return effort === "off" ? null : effort;
}
