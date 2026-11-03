//! Immutable migration 57 compatibility only; no runtime history API or writer.
mod history_bytes;
pub use history_bytes::SCHEMA;
