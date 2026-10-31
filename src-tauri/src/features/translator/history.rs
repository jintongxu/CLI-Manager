//! Immutable migration 57 compatibility only; no runtime history API or writer.
pub const SCHEMA: &str = include_str!("history.sql");
