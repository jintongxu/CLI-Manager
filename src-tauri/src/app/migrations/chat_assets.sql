CREATE TABLE chat_assets (
    asset_id TEXT PRIMARY KEY
        CHECK (length(asset_id) = 64 AND asset_id = lower(asset_id) AND asset_id NOT GLOB '*[^0-9a-f]*'),
    media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 6291456),
    width INTEGER NOT NULL CHECK (width > 0 AND width <= 8192),
    height INTEGER NOT NULL CHECK (height > 0 AND height <= 8192),
    storage_relpath TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    CHECK (width * height <= 12000000)
);
CREATE TABLE chat_message_assets (
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 4),
    asset_id TEXT NOT NULL REFERENCES chat_assets(asset_id) ON DELETE RESTRICT,
    display_name TEXT CHECK (display_name IS NULL OR length(display_name) <= 255),
    PRIMARY KEY (message_id, ordinal)
);
CREATE INDEX idx_chat_message_assets_asset ON chat_message_assets(asset_id);
CREATE TABLE chat_conversation_branches (
    child_conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
    parent_conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL,
    source_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
    source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0),
    created_at INTEGER NOT NULL,
    CHECK (parent_conversation_id IS NULL OR child_conversation_id <> parent_conversation_id)
);
CREATE INDEX idx_chat_branches_parent ON chat_conversation_branches(parent_conversation_id, source_ordinal, created_at);

-- Idempotency is deliberately independent of navigational lineage. The immutable fingerprint
-- survives parent/child/message deletion; nullable receipt pointers turn into a deterministic
-- tombstone instead of allowing a second provider run for the same operation.
CREATE TABLE chat_fork_operations (
    operation_id TEXT PRIMARY KEY CHECK (length(operation_id) = 36),
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 36),
    source_conversation_id TEXT NOT NULL CHECK (length(source_conversation_id) = 36),
    source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
    target_message_id TEXT NOT NULL CHECK (length(target_message_id) = 36),
    child_conversation_id TEXT UNIQUE REFERENCES chat_conversations(id) ON DELETE SET NULL,
    answer_message_id TEXT UNIQUE REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);
