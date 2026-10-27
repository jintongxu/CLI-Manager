CREATE TABLE IF NOT EXISTS btw_threads (
  id TEXT PRIMARY KEY,
  source_terminal_id TEXT,
  source_session_id TEXT,
  source_reason TEXT,
  quote TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  inherit INTEGER NOT NULL DEFAULT 0,
  context_snapshot TEXT NOT NULL DEFAULT '',
  context_reason TEXT,
  context_truncated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  draft TEXT NOT NULL DEFAULT '',
  error TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS btw_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES btw_threads(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(thread_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_btw_threads_recent ON btw_threads(archived, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_btw_messages_thread ON btw_messages(thread_id, ordinal);
