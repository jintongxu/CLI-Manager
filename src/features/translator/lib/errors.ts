import type { TranslationKey } from "../../../shared/i18n/index";
const keys: Record<string, TranslationKey> = {
  translator_no_active_provider: "translator.error.noModel",
  translator_no_active_model: "translator.error.noModel",
  translator_model_not_multimodal: "translator.error.notMultimodal",
  translator_network: "translator.error.network",
  translator_timeout: "translator.error.timeout",
  translator_auth: "translator.error.auth",
  translator_quota: "translator.error.quota",
  translator_rate: "translator.error.rate",
  translator_server: "translator.error.server",
  translator_config: "translator.error.config",
  translator_storage: "translator.error.storage",
};
/** Unknown errors never become display text; provider response bodies are not UI diagnostics. */
export function translatorErrorMessage(raw: unknown): { key: TranslationKey } {
  const code = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  return { key: keys[code] ?? "translator.error.invalidResponse" };
}
