import type { ProviderOption } from "./types";

/**
 * Pi Agent discovery is intentionally opt-in and empty until the application
 * documents an allowlisted, non-secret config source. Never probe home files,
 * environment variables, or raw Pi config from the renderer.
 */
export function discoverPiAgentModels(): ProviderOption[] {
  return [];
}

export const piAgentDiscoveryStatus = "unavailable-no-documented-safe-config" as const;
