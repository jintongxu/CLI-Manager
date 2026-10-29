import { invoke } from "@tauri-apps/api/core";

export const TERMINAL_RESOURCE_PAGE_SIZE = 64;
export const TERMINAL_RESOURCE_REASONS = [
  "unsupported_platform", "unsupported_remote", "session_missing", "not_pty", "root_changed",
  "member_unavailable", "membership_changed", "member_limit", "enumeration_failed",
  "budget_exhausted", "identity_changed", "observation_invalidated",
] as const;
export type TerminalResourceReason = typeof TERMINAL_RESOURCE_REASONS[number];
export interface TerminalResourceRow {
  sessionId: string;
  status: "complete" | "partial" | "unavailable";
  reasonCodes: TerminalResourceReason[];
  rootPid: number | null;
  rootCreatedFiletime: string | null;
  coverage: "job_members";
  enumeratedCount: number;
  observedCount: number;
  workingSetSumBytes: number | null;
}
export interface TerminalResourceSnapshot {
  sampledAt: number;
  daemonEpoch: string;
  revision: string;
  rows: TerminalResourceRow[];
}

const decimal = (value: unknown): value is string => typeof value === "string" && /^\d+$/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const invalid = (): never => { throw new Error("terminal_resources_unavailable"); };

/** Copy the wire allowlist only. Never surface arbitrary native errors or process details. */
export function parseTerminalResourceSnapshot(value: unknown, sessionIds: readonly string[]): TerminalResourceSnapshot {
  if (!value || typeof value !== "object") return invalid();
  const snapshot = value as Record<string, unknown>;
  if (!count(snapshot.sampledAt) || typeof snapshot.daemonEpoch !== "string" || !decimal(snapshot.revision)
    || !Array.isArray(snapshot.rows) || snapshot.rows.length > sessionIds.length) return invalid();
  const allowed = new Set(sessionIds);
  const seen = new Set<string>();
  const rows = snapshot.rows.map((value): TerminalResourceRow => {
    if (!value || typeof value !== "object") return invalid();
    const row = value as Record<string, unknown>;
    if (typeof row.sessionId !== "string" || !allowed.has(row.sessionId) || seen.has(row.sessionId)
      || !["complete", "partial", "unavailable"].includes(String(row.status))
      || row.coverage !== "job_members" || !count(row.enumeratedCount) || !count(row.observedCount)
      || !Array.isArray(row.reasonCodes)
      || !row.reasonCodes.every((reason) => TERMINAL_RESOURCE_REASONS.includes(reason))
      || !(row.rootPid === null || count(row.rootPid))
      || !(row.rootCreatedFiletime === null || decimal(row.rootCreatedFiletime))
      || !(row.workingSetSumBytes === null || count(row.workingSetSumBytes))) return invalid();
    // Invalid/empty observations cannot be made to look like measured zero.
    if ((row.status === "unavailable" || row.observedCount === 0) && row.workingSetSumBytes !== null) return invalid();
    seen.add(row.sessionId);
    return {
      sessionId: row.sessionId, status: row.status as TerminalResourceRow["status"],
      reasonCodes: [...row.reasonCodes], rootPid: row.rootPid as number | null,
      rootCreatedFiletime: row.rootCreatedFiletime as string | null, coverage: "job_members",
      enumeratedCount: row.enumeratedCount, observedCount: row.observedCount,
      workingSetSumBytes: row.workingSetSumBytes as number | null,
    };
  });
  return { sampledAt: snapshot.sampledAt, daemonEpoch: snapshot.daemonEpoch, revision: snapshot.revision, rows };
}

const SAFE_ERRORS = new Set([
  "terminal_resources_native_only", "terminal_resources_invalid_request", "terminal_resources_unsupported",
  "terminal_resources_owner_rejected", "terminal_resources_unavailable", "terminal_resources_observation_invalidated",
]);
export function terminalResourceError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return SAFE_ERRORS.has(code) ? code : "terminal_resources_unavailable";
}

export async function getTerminalResources(sessionIds: readonly string[]): Promise<TerminalResourceSnapshot> {
  if (sessionIds.length > TERMINAL_RESOURCE_PAGE_SIZE || sessionIds.some((id) => !id || new TextEncoder().encode(id).length > 256)) {
    throw new Error("terminal_resources_invalid_request");
  }
  const ids = [...new Set(sessionIds)];
  const value = await invoke<unknown>("terminal_resources_get_snapshot", { sessionIds: ids });
  return parseTerminalResourceSnapshot(value, ids);
}
