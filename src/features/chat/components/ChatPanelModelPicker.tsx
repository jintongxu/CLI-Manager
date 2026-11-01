import { useMemo } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Select } from "../../../shared/ui/select";
import type { ChatProvider } from "../lib/chatProviderCatalog";

interface ChatPanelModelPickerProps {
  providers: readonly ChatProvider[];
  providerId: string;
  model: string;
  disabled: boolean;
  onSelect: (providerId: string, model: string) => void;
}

/** Mirrors the settings catalog: only enabled providers and enabled models are selectable. */
export function ChatPanelModelPicker({
  providers, providerId, model, disabled, onSelect,
}: ChatPanelModelPickerProps) {
  const { t } = useI18n();
  const options = useMemo(() => providers.flatMap((provider) => {
    if (!provider.enabled) return [];
    return provider.models
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        key: `${provider.id}:${entry.modelId}`,
        providerId: provider.id,
        providerName: provider.name || provider.id,
        modelId: entry.modelId,
      }));
  }), [providers]);

  if (!options.length) {
    return <p className="chat-panel-model is-missing" role="status">
      {t("chat.noModelsConfigured")} · {t("chat.goToSettings")}
    </p>;
  }

  const active = options.find((option) => option.providerId === providerId && option.modelId === model);
  return <div className="chat-panel-model">
    <Select
      aria-label={t("chat.selectModel")}
      className="chat-panel-compact-select"
      value={active?.key ?? ""}
      disabled={disabled}
      onChange={(event) => {
        const next = options.find((option) => option.key === event.target.value);
        if (next) onSelect(next.providerId, next.modelId);
      }}
    >
      {!active && <option value="">{model || t("chat.selectModel")}</option>}
      {options.map((option) => <option key={option.key} value={option.key}>
        {option.modelId} · {option.providerName}
      </option>)}
    </Select>
  </div>;
}
