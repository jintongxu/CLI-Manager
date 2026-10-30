use sqlx::{Row, SqliteConnection};
use std::collections::HashSet;

pub(super) async fn table_exists(conn: &mut SqliteConnection, table: &str) -> Result<bool, String> {
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
            .bind(table)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|err| format!("migration_repair_schema_query_failed: {err}"))?;
    Ok(exists.is_some())
}
pub(super) async fn table_columns(
    conn: &mut SqliteConnection,
    table: &'static str,
) -> Result<HashSet<String>, String> {
    if !table_exists(conn, table).await? {
        return Ok(HashSet::new());
    }
    let query = match table {
        "groups" => "PRAGMA table_info(groups)",
        "projects" => "PRAGMA table_info(projects)",
        "session_favorite_snapshots" => "PRAGMA table_info(session_favorite_snapshots)",
        "worktrees" => "PRAGMA table_info(worktrees)",
        "ssh_hosts" => "PRAGMA table_info(ssh_hosts)",
        "ssh_host_groups" => "PRAGMA table_info(ssh_host_groups)",
        "btw_threads" => "PRAGMA table_info(btw_threads)",
        "btw_messages" => "PRAGMA table_info(btw_messages)",
        "usage_records" => "PRAGMA table_info(usage_records)",
        "providers" => "PRAGMA table_info(providers)",
        "command_templates" => "PRAGMA table_info(command_templates)",
        _ => return Err("migration_repair_unsupported_table".to_string()),
    };
    let rows = sqlx::query(query)
        .fetch_all(&mut *conn)
        .await
        .map_err(|err| format!("migration_repair_schema_query_failed: {err}"))?;
    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("name"))
        .collect())
}
