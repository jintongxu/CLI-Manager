export const en = {

  "chat.title": "Chats",
  "chat.history": "History",
  "chat.draftPending": "Draft ready",

  "chat.new": "New chat",

  "chat.search": "Search chats",

  "chat.more": "Load more",

  "chat.empty": "Start a text conversation, independent of projects and terminals.",
  "chat.welcomeTitle": "How can I help you today?",
  "chat.welcomeDesc": "Type a message below to start chatting. Everything is stored locally.",
  "chat.noModelsConfigured": "No chat models configured",
  "chat.goToSettings": "Configure models in Settings -> Chat Models",
  "chat.selectModel": "Select Model",

  "chat.untitled": "New chat",

  "chat.provider": "Provider",

  "chat.model": "Model ID",

  "chat.choose": "Choose provider",

  "chat.refresh": "Refresh providers",

  "chat.rename": "Rename",

  "chat.delete": "Delete",

  "chat.confirmDelete": "Permanently delete this chat and its messages? This cannot be undone.",

  "chat.cancel": "Cancel",

  "chat.confirm": "Confirm",

  "chat.save": "Save",

  "chat.draft": "Message (Enter to send, Shift+Enter for a new line)",

  "chat.send": "Send",

  "chat.stop": "Stop",

  "chat.stopNote": "Stopping does not guarantee the provider stops billing.",

  "chat.retry": "Retry answer",

  "chat.retrySave": "Retry saving",

  "chat.unsaved": "Unsaved. Local content is retained. Retry saving.",

  "chat.saving": "Saving…",

  "chat.copy": "Copy",

  "chat.copied": "Copied",

  "chat.user": "You",

  "chat.assistant": "Assistant",

  "chat.bottom": "Jump to bottom",

  "chat.loading": "Loading…",

  "chat.readonly": "Another window is generating; read-only. Refresh before editing.",

  "chat.reload": "Refresh chat",

  "chat.suspended": "Exiting; editing is suspended.",

  "chat.completed": "Completed",

  "chat.pending": "Generating…",

  "chat.stopped": "Stopped",

  "chat.failed": "Failed",

  "chat.interrupted": "Interrupted",

  "chat.error.chat_invalid_input": "Invalid input. Check the model and message.",

  "chat.error.chat_not_initialized": "Database is not ready.",

  "chat.error.chat_storage": "Saving failed. Retry saving.",

  "chat.error.chat_not_found": "Chat not found.",

  "chat.error.chat_conflict": "Another window updated this chat. Draft retained; review and retry saving.",

  "chat.error.chat_busy": "This chat is generating or owned by another window.",

  "chat.error.chat_capacity": "Up to four chats can generate concurrently. Retry later.",

  "chat.error.chat_retry_required": "Retry the last unfinished answer first.",

  "chat.error.chat_context_limit": "History exceeds the context limit; it was not truncated. Start a new chat.",

  "chat.error.chat_shutting_down": "Exit preparation in progress; sending is disabled.",

  "chat.error.chat_cancelled_or_replayed": "Request cancelled or already used. Retry explicitly.",

  "chat.error.chat_cancelled": "Request stopped.",

  "chat.error.chat_interrupted": "Previous generation was interrupted; it will not be reissued automatically.",

  "chat.error.chat_provider_url": "Provider URL does not meet security rules.",

  "chat.error.chat_provider_protocol": "Unsupported provider protocol.",

  "chat.error.chat_provider_config": "Invalid provider configuration or OAuth-only authentication.",

  "chat.error.chat_provider_key": "Provider has no active API key.",

  "chat.error.chat_provider_missing": "Provider no longer exists.",

  "chat.error.chat_provider_disabled": "Provider is disabled.",

  "chat.error.chat_provider_storage": "Cannot read provider configuration.",

  "chat.error.chat_network": "Network or TLS connection failed.",

  "chat.error.chat_auth": "Authentication failed (401/403). Check provider settings.",

  "chat.error.chat_rate_limit": "Rate limited (429). Retry manually later.",

  "chat.error.chat_http": "Provider request failed.",

  "chat.error.chat_timeout": "Request timed out.",

  "chat.error.chat_protocol": "Provider returned unsupported content or tool calls.",

  "chat.error.chat_protocol_eof": "Stream ended unexpectedly.",

  "chat.error.chat_frame_limit": "Provider stream frame exceeds the limit.",

  "chat.error.chat_answer_limit": "Answer exceeds the size limit.",

  "chat.error.chat_empty": "Provider returned no text answer.",

  "chat.error.chat_drain_timeout": "Timed out waiting for saving or generation to stop.",

  "chat.error.chat_copy": "Copy failed. Please retry.",

  "chat.error.chat_link": "Only HTTP(S) links can be opened, or opening failed."

} as const;
