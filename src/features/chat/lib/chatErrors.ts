import { errorCode } from "./types";

export type ChatErrorCategory =
  | "not_ready"
  | "not_found"
  | "storage"
  | "unsupported_protocol"
  | "timeout"
  | "capacity";

export type ChatErrorAction =
  | "reconnect"
  | "create"
  | "retry_save"
  | "switch_model"
  | "wait";

export interface ChatErrorDiagnosis {
  code: string;
  category: ChatErrorCategory;
  action: ChatErrorAction;
  messageKey: string;
  actionKey: string;
  categoryKey: string;
}

export const CATEGORY_ACTIONS: Record<ChatErrorCategory, ChatErrorAction> = {
  not_ready: "reconnect",
  not_found: "create",
  storage: "retry_save",
  unsupported_protocol: "switch_model",
  timeout: "wait",
  capacity: "wait",
};

export const ACTION_KEYS: Record<ChatErrorAction, string> = {
  reconnect: "chat.action.reconnect",
  create: "chat.action.create",
  retry_save: "chat.action.retry_save",
  switch_model: "chat.action.switch_model",
  wait: "chat.action.wait",
};

export const CATEGORY_KEYS: Record<ChatErrorCategory, string> = {
  not_ready: "chat.error_category.not_ready",
  not_found: "chat.error_category.not_found",
  storage: "chat.error_category.storage",
  unsupported_protocol: "chat.error_category.unsupported_protocol",
  timeout: "chat.error_category.timeout",
  capacity: "chat.error_category.capacity",
};

export const ERROR_CATEGORY_MAP: Record<string, ChatErrorCategory> = {
  // 1. not_ready / connection failure
  chat_quick_not_ready: "not_ready",
  chat_not_initialized: "not_ready",
  chat_quick_command_failed: "not_ready",
  chat_quick_owner_changed: "not_ready",
  chat_network: "not_ready",
  chat_shutting_down: "not_ready",

  // 2. not_found / deleted
  chat_not_found: "not_found",

  // 3. storage
  chat_storage: "storage",
  chat_conflict: "storage",
  chat_drain_timeout: "storage",

  // 4. unsupported_protocol / provider failure
  chat_provider_protocol: "unsupported_protocol",
  chat_protocol: "unsupported_protocol",
  chat_protocol_eof: "unsupported_protocol",
  chat_frame_limit: "unsupported_protocol",
  chat_empty: "unsupported_protocol",
  chat_provider_config: "unsupported_protocol",
  chat_provider_missing: "unsupported_protocol",
  chat_provider_disabled: "unsupported_protocol",
  chat_provider_url: "unsupported_protocol",
  chat_provider_key: "unsupported_protocol",
  chat_provider_storage: "unsupported_protocol",
  chat_auth: "unsupported_protocol",
  chat_http: "unsupported_protocol",
  chat_invalid_input: "unsupported_protocol",

  // 5. timeout
  chat_timeout: "timeout",
  chat_quick_timeout: "timeout",

  // 6. capacity
  chat_capacity: "capacity",
  chat_quick_capacity: "capacity",
  chat_busy: "capacity",
  chat_rate_limit: "capacity",
  chat_context_limit: "capacity",
  chat_answer_limit: "capacity",
  chat_retry_required: "capacity",
  chat_cancelled_or_replayed: "capacity",
};

export function diagnoseChatError(error: unknown): ChatErrorDiagnosis {
  const code = errorCode(error);
  const category = ERROR_CATEGORY_MAP[code] ?? "storage";
  const action = CATEGORY_ACTIONS[category];
  return {
    code,
    category,
    action,
    messageKey: `chat.error.${code}`,
    actionKey: ACTION_KEYS[action],
    categoryKey: CATEGORY_KEYS[category],
  };
}

export function resolveSnapshotError(
  currentError: string | null,
  snapshotError: string | null,
  snapshotReady: boolean,
  hasSelection: boolean,
  inFlightError: { version: number; code: string } | null,
  snapshotVersion: number
): { error: string | null; clearInFlight: boolean } {
  // 1. Authoritative error published by owner wins.
  if (snapshotError) {
    return { error: snapshotError, clearInFlight: true };
  }
  // 2. In-flight failure must not be masked by an older or concurrent success snapshot.
  if (inFlightError && snapshotVersion <= inFlightError.version) {
    return { error: inFlightError.code, clearInFlight: false };
  }
  // 3. Recovery succeeded: ready with valid selection and no owner error.
  if (snapshotReady && hasSelection) {
    return { error: null, clearInFlight: true };
  }
  // 4. Retain prior failure until recovery completes.
  return {
    error: inFlightError ? inFlightError.code : currentError,
    clearInFlight: false,
  };
}
