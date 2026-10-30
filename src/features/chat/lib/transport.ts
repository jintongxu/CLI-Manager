import { Channel, invoke } from "@tauri-apps/api/core";
import { getDb } from "../../../shared/platform/db";
import type { ChatEvent, ChatTransport } from "./types";

export const chatTransport: ChatTransport = {
  // The SQL plugin owns migrations; chat_initialize must not race its setup.
  initialize: async () => {
    await getDb();
    return invoke("chat_initialize");
  },
  list: (search, offset) => invoke("chat_list", { input: { search, offset } }),
  get: conversationId => invoke("chat_get", { input: { conversationId } }),
  create: () => invoke("chat_create", { input: { title: null } }),
  update: input => invoke("chat_update", { input }),
  delete: (conversationId, revision) => invoke("chat_delete", { input: { conversationId, revision } }),
  providers: () => invoke("chat_provider_options"),
  generate: (input, listener) => {
    const onEvent = new Channel<ChatEvent>();
    onEvent.onmessage = listener;
    return invoke("chat_generate", { input, onEvent });
  },
  cancel: (conversationId, requestId) => invoke("chat_cancel", { input: { conversationId, requestId } }),
  flush: drafts => invoke("chat_flush_drafts", { input: { drafts } }),
};
