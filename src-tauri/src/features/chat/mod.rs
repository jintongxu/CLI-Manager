mod chat_delta;
pub(crate) mod commands;
pub(crate) mod provider_catalog;
pub(crate) mod repository;
pub(crate) mod runtime;
mod stream;
#[cfg(test)]
mod tests;
mod types;
mod schema_bytes;
pub(crate) use schema_bytes::SCHEMA;
pub(crate) const ORIGIN_MIGRATION: &str = "ALTER TABLE chat_conversations ADD COLUMN origin TEXT NOT NULL DEFAULT 'workspace' CHECK(origin IN ('workspace','sidebar','quick-chat'));\n";

#[cfg(test)]
mod stream_tests;
