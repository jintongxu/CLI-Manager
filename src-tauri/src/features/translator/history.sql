-- Additive migration 57. Local-only text retention; plugin owns migration execution.
CREATE TABLE translator_history_settings (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    recording INTEGER NOT NULL DEFAULT 0 CHECK(recording IN (0, 1))
);
INSERT INTO translator_history_settings(singleton, recording) VALUES(1, 0);
CREATE TABLE translator_history (
    id TEXT PRIMARY KEY,
    success_attempt_id TEXT NOT NULL UNIQUE,
    original TEXT,
    translated TEXT NOT NULL CHECK(length(trim(translated)) > 0),
    source TEXT NOT NULL CHECK(source IN ('text', 'screenshot')),
    target_lang TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_translator_history_newest ON translator_history(created_at DESC, id DESC);
-- Tombstones survive deletion/clear: an accepted success cannot be reinserted on retry/reopen.
CREATE TABLE translator_history_receipts(success_attempt_id TEXT PRIMARY KEY);
