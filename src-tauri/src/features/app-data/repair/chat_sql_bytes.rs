//! Exact newline-only compatibility for externally embedded historical migrations.
//! Never run feature DDL or accept arbitrary checksum/schema drift here.
use super::*;
use sqlx::Executor;

static REPAIR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn checksum(sql: &str) -> Vec<u8> { Sha384::digest(sql.as_bytes()).to_vec() }
fn identity(version: i64) -> (&'static str, &'static str, &'static [&'static str]) {
    match version {
        55 => ("create_independent_chat", crate::chat::SCHEMA, &["chat_conversations", "chat_messages"]),
        57 => ("create_local_translator_history", crate::translator::history::SCHEMA,
            &["translator_history_settings", "translator_history", "translator_history_receipts"]),
        _ => unreachable!(),
    }
}
async fn schema(conn: &mut SqliteConnection, tables: &[&str]) -> Result<Vec<(String, String, Option<String>)>, String> {
    let mut result = Vec::new();
    for table in tables {
        let rows = sqlx::query("SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? ORDER BY type,name")
            .bind(table).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
        for row in rows {
            result.push((row.try_get("type").map_err(|e| e.to_string())?,
                row.try_get("name").map_err(|e| e.to_string())?,
                row.try_get::<Option<String>, _>("sql").map_err(|e| e.to_string())?.map(|s| s.replace("\r\n", "\n"))));
        }
    }
    Ok(result)
}
async fn candidates(conn: &mut SqliteConnection) -> Result<Vec<(i64, Vec<u8>, Vec<u8>)>, String> {
    let present: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'")
        .fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
    if present == 0 { return Ok(Vec::new()); }
    let mut repairs = Vec::new();
    for version in [55, 57] {
        let Some(row) = sqlx::query("SELECT description,success,checksum FROM _sqlx_migrations WHERE version=?")
            .bind(version).fetch_optional(&mut *conn).await.map_err(|e| e.to_string())? else { continue; };
        let (description, sql, tables) = identity(version);
        let old: Vec<u8> = row.try_get("checksum").map_err(|e| e.to_string())?;
        let canonical = checksum(sql);
        if old == canonical { continue; } // SQLx remains authoritative for canonical markers.
        if row.try_get::<String, _>("description").map_err(|e| e.to_string())? != description
            || !row.try_get::<bool, _>("success").map_err(|e| e.to_string())?
            || old != checksum(&sql.replace('\n', "\r\n")) {
            return Err(format!("migration_repair_unknown_sql_bytes_{version}"));
        }
        let mut reference = SqliteConnection::connect("sqlite::memory:").await.map_err(|e| e.to_string())?;
        reference.execute(sql).await.map_err(|e| e.to_string())?;
        if version == 55 {
            let columns = sqlx::query("PRAGMA table_info(chat_conversations)").fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
            let has_origin = columns.iter().any(|r| r.try_get::<String, _>("name").ok().as_deref() == Some("origin"));
            let origin_marker = sqlx::query("SELECT description,success,checksum FROM _sqlx_migrations WHERE version=58")
                .fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?;
            if let Some(marker) = origin_marker.as_ref() {
                if !has_origin
                    || marker.try_get::<String, _>("description").map_err(|e| e.to_string())? != "add_chat_conversation_origin"
                    || !marker.try_get::<bool, _>("success").map_err(|e| e.to_string())?
                    || marker.try_get::<Vec<u8>, _>("checksum").map_err(|e| e.to_string())? != checksum(crate::chat::ORIGIN_MIGRATION) {
                    return Err("migration_repair_unknown_sql_bytes_58".into());
                }
            } else if has_origin {
                return Err("migration_repair_schema_sql_bytes_55".into());
            }
            if has_origin {
                reference.execute(crate::chat::ORIGIN_MIGRATION).await.map_err(|e| e.to_string())?;
            }
        }
        if schema(conn, tables).await? != schema(&mut reference, tables).await? {
            return Err(format!("migration_repair_schema_sql_bytes_{version}"));
        }
        repairs.push((version, old, canonical));
    }
    Ok(repairs)
}

pub(super) async fn reconcile(conn: &mut SqliteConnection, path: &Path) -> Result<bool, String> {
    let _guard = REPAIR_LOCK.lock().await;
    // Read-only recognition before any backup/write. Unknown drift makes no changes.
    if candidates(conn).await?.is_empty() { return Ok(false); }
    let backup = path.with_file_name(format!("cli-manager.sql-bytes-{}.db", backup_suffix()));
    // SQLite produces a consistent snapshot including WAL, not an unsafe copy of live files.
    sqlx::query("VACUUM main INTO ?").bind(backup.to_string_lossy().as_ref())
        .execute(&mut *conn).await.map_err(|e| format!("migration_repair_backup_failed: {e}"))?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result = async {
        // Revalidate under the write lock; transactional rollback restores all markers on error.
        let repairs = candidates(conn).await?;
        for (version, old, canonical) in &repairs {
            let (description, _, _) = identity(*version);
            let updated = sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=? AND description=? AND success=1 AND checksum=?")
                .bind(canonical).bind(version).bind(description).bind(old).execute(&mut *conn).await.map_err(|e| e.to_string())?;
            if updated.rows_affected() != 1 { return Err("migration_repair_sql_bytes_conflict".into()); }
        }
        Ok(!repairs.is_empty())
    }.await;
    match result {
        Ok(changed) => {
            if let Err(error) = sqlx::query("COMMIT").execute(&mut *conn).await {
                sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| format!("migration_repair_rollback_failed: {e}"))?;
                return Err(format!("migration_repair_commit_failed: {error}"));
            }
            Ok(changed)
        }
        Err(error) => { sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?; Err(error) }
    }
}

#[cfg(test)]
mod tests;
