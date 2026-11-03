import { invoke } from "@tauri-apps/api/core";
import type { ChatDefaultModelPreference } from "../../../shared/preferences/chatDefaultModel";

/** Mirrors `chat_provider_catalog_list`; the same catalog the full chat workspace reads. */
export interface ChatCatalogModel {
  modelId: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface ChatProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: string;
  enabled: boolean;
  isDefault: boolean;
  models: ChatCatalogModel[];
}

export async function loadChatProviderCatalog(): Promise<ChatProvider[]> {
  const providers = await invoke<ChatProvider[]>("chat_provider_catalog_list");
  return providers ?? [];
}

/** Preserve each consumer's pre-preference fallback semantics during migration. */
export type CatalogFallbackPolicy = "sidebar" | "workspace";

/** Exact enabled identity first. Omitted preference/policy preserves the old sidebar behavior. */
export function defaultCatalogModel(
  providers: readonly ChatProvider[],
  preference: ChatDefaultModelPreference | null = null,
  fallbackPolicy: CatalogFallbackPolicy = "sidebar",
): ChatDefaultModelPreference | null {
  if (preference) {
    const provider = providers.find((item) => item.id === preference.providerId && item.enabled);
    if (provider?.models.some((item) => item.enabled && item.modelId === preference.model)) {
      return { providerId: preference.providerId, model: preference.model };
    }
  }
  if (fallbackPolicy === "workspace") {
    const available = providers.filter((provider) => provider.enabled).flatMap((provider) =>
      provider.models.filter((model) => model.enabled).map((model) => ({ provider, model })),
    );
    const chosen = available.find(({ provider, model }) => provider.isDefault || model.isDefault) ?? available[0];
    return chosen ? { providerId: chosen.provider.id, model: chosen.model.modelId } : null;
  }
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const enabled = provider.models.filter((model) => model.enabled);
    const preferred = enabled.find((model) => model.isDefault);
    const chosen = preferred ?? enabled[0];
    if (chosen) return { providerId: provider.id, model: chosen.modelId };
  }
  return null;
}
