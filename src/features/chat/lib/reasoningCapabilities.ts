import type { ReasoningEffort } from "./types";

/**
 * Reasoning controls differ per upstream protocol, so the option set is derived
 * from the selected provider protocol instead of being one global list:
 * - `anthropic_messages` maps a level to `thinking.budget_tokens` (min 1024).
 * - OpenAI-style protocols take a `reasoning_effort` / `reasoning.effort` enum.
 *   The catalog does not report per-model support; advanced values are exposed
 *   explicitly and the user is warned that a gateway may reject them.
 */
export type ReasoningProtocol = "anthropic_messages" | "openai_chat" | "openai_responses" | string | null;

const ANTHROPIC_BUDGETS: Partial<Record<ReasoningEffort, number>> = {
  low: 1024,
  medium: 2048,
  high: 4096,
  xhigh: 8192,
  max: 16384,
};

/** Levels offered when the protocol carries a numeric thinking budget. */
const BUDGET_LEVELS: readonly ReasoningEffort[] = ["medium", "high", "xhigh", "max"];

/** Full enum for OpenAI-compatible gateways; exact support is gateway/model dependent. */
const OPENAI_LEVELS: readonly ReasoningEffort[] = ["medium", "high", "xhigh", "max"];

/** Preserve the original choices for protocols without a known mapping. */
const FALLBACK_LEVELS: readonly ReasoningEffort[] = ["medium", "high", "xhigh", "max"];

export function isBudgetProtocol(protocol: ReasoningProtocol): boolean {
  return protocol === "anthropic_messages";
}

/** Token budget shown next to a level; `null` means the protocol has no numeric budget. */
export function reasoningTokenBudget(effort: ReasoningEffort): number | null {
  return ANTHROPIC_BUDGETS[effort] ?? null;
}

export function reasoningLevelsFor(
  protocol: ReasoningProtocol,
  _modelId: string | null | undefined,
): readonly ReasoningEffort[] {
  if (isBudgetProtocol(protocol)) return BUDGET_LEVELS;
  if (protocol === "openai_chat" || protocol === "openai_responses") return OPENAI_LEVELS;
  return FALLBACK_LEVELS;
}

/** Old saved off/minimal/low values remain readable, but resolve to the new medium floor. */
export function normalizeReasoningFor(
  protocol: ReasoningProtocol,
  modelId: string | null | undefined,
  effort: ReasoningEffort,
): ReasoningEffort {
  const levels = reasoningLevelsFor(protocol, modelId);
  return levels.includes(effort) ? effort : "medium";
}
