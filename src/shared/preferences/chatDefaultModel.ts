/** Independent of catalog isDefault flags. null follows the catalog's legacy default. */
export interface ChatDefaultModelPreference {
  providerId: string;
  model: string;
}

/** Validate structure only: unavailable identities must survive load/sync for later recovery. */
export function normalizeChatDefaultModelPreference(value: unknown): ChatDefaultModelPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { providerId, model } = value as Record<string, unknown>;
  return typeof providerId === "string" && providerId.trim()
    && typeof model === "string" && model.trim()
    ? { providerId, model }
    : null;
}
