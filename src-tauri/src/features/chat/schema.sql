CREATE TABLE chat_conversations (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '',
 app_type TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 request_id TEXT, owner TEXT, lease_until INTEGER,
 CHECK ((request_id IS NULL AND owner IS NULL AND lease_until IS NULL) OR
        (request_id IS NOT NULL AND owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE TABLE chat_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
 reply_to TEXT REFERENCES chat_messages(id), request_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','completed','stopped','failed','interrupted')),
 error_code TEXT, finish_reason TEXT, app_type TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(conversation_id, ordinal), UNIQUE(reply_to)
);
CREATE INDEX chat_conversations_updated ON chat_conversations(updated_at DESC,id);
CREATE INDEX chat_messages_conversation ON chat_messages(conversation_id,ordinal);
CREATE UNIQUE INDEX chat_answer_request ON chat_messages(request_id) WHERE role='assistant';
