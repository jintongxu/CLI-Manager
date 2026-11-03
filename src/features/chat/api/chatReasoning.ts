import type { ReasoningEffort } from "../lib/types";

export type { ReasoningEffort };
export type { ReasoningEffort as ChatPanelReasoningEffort };
export { DEFAULT_REASONING_EFFORT } from "../lib/reasoning";
export {
  isBudgetProtocol,
  normalizeReasoningFor,
  reasoningLevelsFor,
  reasoningTokenBudget,
} from "../lib/reasoningCapabilities";

/** Every level the app understands; each surface narrows this to what its model accepts. */
export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

export function reasoningPayload(effort: ReasoningEffort): ReasoningEffort | null {
  return effort === "off" ? null : effort;
}
