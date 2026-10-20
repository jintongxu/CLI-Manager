use crate::{
    MIGRATION_ADD_COMMAND_TEMPLATE_TYPE_DESCRIPTION, MIGRATION_ADD_COMMAND_TEMPLATE_TYPE_SQL,
    MIGRATION_ADD_COMMAND_TEMPLATE_TYPE_VERSION, MIGRATION_ADD_WORKTREE_SHORT_LABELS_DESCRIPTION,
    MIGRATION_ADD_WORKTREE_SHORT_LABELS_SQL, MIGRATION_ADD_WORKTREE_SHORT_LABELS_VERSION,
};
use sha2::{Digest, Sha384};
use sqlx::{Row, SqliteConnection};
use std::collections::HashSet;

const SQLX_MIGRATIONS_TABLE: &str = "_sqlx_migrations";

pub(super) async fn reconcile_worktree_short_labels_migration(
    conn: &mut SqliteConnection,
) -> Result<bool, String> {
    if !table_exists(conn, "worktrees").await? {
        return Ok(false);
    }
    let columns = table_columns(conn, "worktrees").await?;
    if !columns.contains("short_label") || !columns.contains("label_ordinal") {
        return Ok(false);
    }
    reconcile_migration_marker(
        conn,
        MIGRATION_ADD_WORKTREE_SHORT_LABELS_VERSION,
        MIGRATION_ADD_WORKTREE_SHORT_LABELS_DESCRIPTION,
        MIGRATION_ADD_WORKTREE_SHORT_LABELS_SQL,
    )
    .await
}

pub(super) async fn ensure_command_template_type(
    conn: &mut SqliteConnection,
) -> Result<bool, String> {
    if !table_exists(conn, "command_templates").await? {
        return Ok(false);
    }
    let columns = table_columns(conn, "command_templates").await?;
    let mut repaired = false;
    if !columns.contains("template_type") {
        sqlx::query(
            "ALTER TABLE command_templates ADD COLUMN template_type TEXT NOT NULL DEFAULT 'command'",
        )
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("command_template_type_column_add_failed: {err}"))?;
        repaired = true;
    }
    if reconcile_migration_marker(
        conn,
        MIGRATION_ADD_COMMAND_TEMPLATE_TYPE_VERSION,
        MIGRATION_ADD_COMMAND_TEMPLATE_TYPE_DESCRIPTION,
        MIGRATION_ADD_COMMAND_TEMPLATE_TYPE_SQL,
    )
    .await?
    {
        repaired = true;
    }
    Ok(repaired)
}

async fn reconcile_migration_marker(
    conn: &mut SqliteConnection,
    version: i64,
    description: &str,
    sql: &str,
) -> Result<bool, String> {
    if !table_exists(conn, SQLX_MIGRATIONS_TABLE).await? {
        return Ok(false);
    }
    let expected_checksum = migration_checksum(sql);
    let marker = sqlx::query(
        "SELECT description, success, checksum FROM _sqlx_migrations WHERE version = ?1 LIMIT 1",
    )
    .bind(version)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|err| format!("migration_marker_query_failed: {err}"))?;
    let needs_repair = match marker {
        Some(row) => {
            let success: bool = row.try_get("success").unwrap_or(false);
            let actual_description: String = row.try_get("description").unwrap_or_default();
            let actual_checksum: Vec<u8> = row.try_get("checksum").unwrap_or_default();
            !success || actual_description != description || actual_checksum != expected_checksum
        }
        None => true,
    };
    if !needs_repair {
        return Ok(false);
    }
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version = ?1")
        .bind(version)
        .execute(&mut *conn)
        .await
        .map_err(|err| format!("migration_marker_delete_failed: {err}"))?;
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (?1, ?2, TRUE, ?3, 0)",
    )
    .bind(version)
    .bind(description)
    .bind(expected_checksum)
    .execute(&mut *conn)
    .await
    .map_err(|err| format!("migration_marker_insert_failed: {err}"))?;
    Ok(true)
}

fn migration_checksum(sql: &str) -> Vec<u8> {
    Sha384::digest(sql.as_bytes()).to_vec()
}

async fn table_exists(conn: &mut SqliteConnection, table: &str) -> Result<bool, String> {
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")
            .bind(table)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|err| format!("migration_repair_schema_query_failed: {err}"))?;
    Ok(exists.is_some())
}

async fn table_columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<HashSet<String>, String> {
    let query = match table {
        "worktrees" => "PRAGMA table_info(worktrees)",
        "command_templates" => "PRAGMA table_info(command_templates)",
        _ => return Err("migration_repair_unsupported_table".to_string()),
    };
    let rows = sqlx::query(query)
        .fetch_all(&mut *conn)
        .await
        .map_err(|err| format!("migration_repair_schema_query_failed: {err}"))?;
    rows.iter()
        .map(|row| {
            row.try_get("name")
                .map_err(|err| format!("migration_repair_schema_row_failed: {err}"))
        })
        .collect()
}
