/** True exit stops tasks; restoring sessions only controls metadata recreation. */
export type NormalizedExitWithRunningTasksBehavior = "ask" | "minimize" | "discard";

export function normalizeExitWithRunningTasksBehavior(value: unknown): NormalizedExitWithRunningTasksBehavior {
  return value === "minimize" || value === "discard" ? value : "ask";
}
