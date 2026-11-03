ALTER TABLE chat_conversations ADD COLUMN origin TEXT NOT NULL DEFAULT 'workspace' CHECK(origin IN ('workspace','sidebar','quick-chat'));
