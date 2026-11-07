import { Channel, invoke } from "@tauri-apps/api/core";
import { getDb } from "../../../shared/platform/db";
import type { ChatEvent, ChatTransport } from "./types";

function rawBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}
function requireArrayBuffer(value: unknown): ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) throw new TypeError("chat_asset_read must return ArrayBuffer");
  return value;
}

export const chatTransport: ChatTransport = {
  // The SQL plugin owns migrations; chat_initialize must not race its setup.
  initialize: async () => {
    await getDb();
    return invoke("chat_initialize");
  },
  list: (search, offset) => invoke("chat_list", { input: { search, offset } }),
  get: conversationId => invoke("chat_get", { input: { conversationId } }),
  create: (origin = "workspace") => invoke("chat_create", { input: { title: null, origin } }),
  update: input => invoke("chat_update", { input }),
  delete: (conversationId, revision) => invoke("chat_delete", { input: { conversationId, revision } }),
  providers: () => invoke("chat_provider_options"),
  stage: bytes => invoke("chat_asset_stage", rawBytes(bytes)),
  releaseAssets: stageIds => stageIds.length
    ? invoke("chat_asset_release", { input: { stageIds: [...stageIds] } })
    : Promise.resolve(),
  readAsset: async input => requireArrayBuffer(await invoke("chat_asset_read", { ...input })),
  generate: (input, listener) => {
    const onEvent = new Channel<ChatEvent>();
    onEvent.onmessage = listener;
    return invoke("chat_generate", { input, onEvent });
  },
  forkEdit: (input, listener) => {
    const onEvent = new Channel<ChatEvent>();
    onEvent.onmessage = listener;
    return invoke("chat_fork_edit", { input, onEvent });
  },
  cancel: (conversationId, requestId) => invoke("chat_cancel", { input: { conversationId, requestId } }),
  flush: drafts => invoke("chat_flush_drafts", { input: { drafts } }),
};
