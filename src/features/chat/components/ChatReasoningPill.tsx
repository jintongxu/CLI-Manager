import * as SelectPrimitive from "@radix-ui/react-select";
import { Brain, Check, ChevronDown } from "lucide-react";
import { useI18n, type TranslationKey } from "../../../shared/i18n";
import { cn } from "../../../shared/lib/utils";
import type { ReasoningEffort } from "../api/chatReasoning";
import {
  isBudgetProtocol,
  reasoningLevelsFor,
  reasoningTokenBudget,
  type ReasoningProtocol,
} from "../lib/reasoningCapabilities";

export interface ChatReasoningPillProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  /** Provider protocol decides whether levels map to an enum or a token budget. */
  protocol?: ReasoningProtocol;
  /** Model id narrows which enum values the upstream accepts. */
  modelId?: string | null;
  disabled?: boolean;
  className?: string;
}

const REASONING_LABELS: Record<ReasoningEffort, TranslationKey> = {
  off: "chat.panel.reasoningDefault",
  minimal: "chat.panel.reasoningMinimal",
  low: "chat.panel.reasoningLow",
  medium: "chat.panel.reasoningMedium",
  high: "chat.panel.reasoningHigh",
  xhigh: "chat.panel.reasoningXHigh",
  max: "chat.panel.reasoningMax",
};

export function ChatReasoningPill({
  value,
  onChange,
  protocol = null,
  modelId = null,
  disabled = false,
  className,
}: ChatReasoningPillProps) {
  const { t } = useI18n();
  const levels = reasoningLevelsFor(protocol, modelId);
  const showBudgets = isBudgetProtocol(protocol);
  const isActive = value !== "off";

  const budgetHint = (level: ReasoningEffort) => {
    const tokens = showBudgets ? reasoningTokenBudget(level) : null;
    return tokens ? t("chat.panel.reasoningTokens", { tokens }) : null;
  };

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => onChange(next as ReasoningEffort)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={`${t("chat.panel.reasoning")}: ${t("chat.panel.reasoningPrefix")} ${t(REASONING_LABELS[value])}`}
        className={cn("chat-reasoning-pill", isActive && "is-active", className)}
      >
        <Brain size={12} className="chat-reasoning-pill-icon" aria-hidden="true" />
        <span className="chat-reasoning-pill-content">
          <span className="chat-reasoning-pill-prefix">{t("chat.panel.reasoningPrefix")}</span>
          <span className="chat-reasoning-pill-label">{t(REASONING_LABELS[value])}</span>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={10} className="chat-reasoning-pill-chevron" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "ui-select-popover z-[1000] min-w-[120px] overflow-hidden rounded-xl border border-border bg-surface-container-high py-1 text-xs shadow-lg",
            "data-[state=open]:animate-slide-down"
          )}
        >
          <SelectPrimitive.Viewport className="overflow-auto p-0">
            {levels.map((level) => {
              const hint = budgetHint(level);
              return (
                <SelectPrimitive.Item
                  key={level}
                  value={level}
                  title={!showBudgets && (level === "xhigh" || level === "max")
                    ? t("chat.panel.reasoningUnsupportedHint") : undefined}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-1.5 text-xs outline-none",
                    "data-[highlighted]:bg-surface-container-highest",
                    "data-[state=checked]:font-semibold data-[state=checked]:text-primary",
                    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                  )}
                >
                  <SelectPrimitive.ItemText>
                    {t(REASONING_LABELS[level])}
                  </SelectPrimitive.ItemText>
                  <span className="flex shrink-0 items-center gap-2">
                    {hint && <span className="text-[10px] tabular-nums opacity-55">{hint}</span>}
                    <SelectPrimitive.ItemIndicator className="shrink-0 text-primary">
                      <Check size={12} />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
