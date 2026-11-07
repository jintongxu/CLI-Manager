pub(crate) mod assets;
mod chat_delta;
pub(crate) mod commands;
#[cfg(test)]
mod fork_tests;
pub(crate) mod ipc_bytes;
pub(crate) mod provider_catalog;
pub(crate) mod repository;
pub(crate) mod runtime;
mod schema_bytes;
mod stream;
#[cfg(test)]
mod tests;
mod types;
pub(crate) use schema_bytes::SCHEMA;
pub(crate) const ORIGIN_MIGRATION: &str = "ALTER TABLE chat_conversations ADD COLUMN origin TEXT NOT NULL DEFAULT 'workspace' CHECK(origin IN ('workspace','sidebar','quick-chat'));\n";

#[cfg(test)]
mod stream_tests;
