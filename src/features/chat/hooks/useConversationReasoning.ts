import { useEffect, useState } from "react";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { persistReasoning, readReasoning } from "../lib/reasoning";
import type { ReasoningEffort } from "../lib/types";

/** Initialize once per conversation after preferences hydrate; explicit choices win. */
export function useConversationReasoning(conversationId: string | null,
  defaults?: { loaded: boolean; effort: ReasoningEffort | undefined }) {
  const settingsLoaded = useSettingsStore(state => state.loaded);
  const settingsPreference = useSettingsStore(state => state.chatDefaultReasoningEffort);
  const loaded = defaults ? defaults.loaded : settingsLoaded;
  const preference = defaults ? defaults.effort : settingsPreference;
  const [selection, setSelection] = useState<{ id: string; value: ReasoningEffort } | null>(null);
  const value = conversationId
    ? readReasoning(conversationId, preference)
    : preference ?? "medium";
  useEffect(() => {
    if (!loaded || !conversationId) return;
    const next = readReasoning(conversationId, preference);
    persistReasoning(conversationId, next);
    setSelection({ id: conversationId, value: next });
  }, [conversationId, loaded, preference]);
  const change = (next: ReasoningEffort) => {
    if (!conversationId) return;
    persistReasoning(conversationId, next);
    setSelection({ id: conversationId, value: next });
  };
  return [selection?.id === conversationId ? selection.value : value, change] as const;
}
