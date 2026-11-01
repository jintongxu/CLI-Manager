import { invoke } from "@tauri-apps/api/core";

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

/** First enabled model, preferring catalog defaults; used to bind a fresh conversation. */
export function defaultCatalogModel(
  providers: readonly ChatProvider[],
): { providerId: string; model: string } | null {
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const enabled = provider.models.filter((model) => model.enabled);
    const preferred = enabled.find((model) => model.isDefault);
    const chosen = preferred ?? enabled[0];
    if (chosen) return { providerId: provider.id, model: chosen.modelId };
  }
  return null;
}
