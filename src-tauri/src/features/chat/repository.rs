use super::types::*;
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{path::Path, time::Duration};
#[derive(Clone)]
pub struct Repository {
    pub pool: SqlitePool,
}

// One pool per process. Opening a pool per command re-runs `PRAGMA journal_mode=WAL`,
// which takes an exclusive lock and surfaces as `chat_storage` when two commands race.
static SHARED_POOL: tokio::sync::OnceCell<SqlitePool> = tokio::sync::OnceCell::const_new();

pub async fn shared_pool() -> Result<SqlitePool> {
    SHARED_POOL
        .get_or_try_init(|| async {
            let path = crate::app_paths::db_path().map_err(|_| "chat_storage".to_string())?;
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .foreign_keys(true)
                .journal_mode(SqliteJournalMode::Wal)
                .busy_timeout(Duration::from_secs(5));
            let pool = SqlitePoolOptions::new()
                .max_connections(4)
                .connect_with(options)
                .await
                .map_err(storage)?;
            // The SQL plugin owns migrations. Never create/upgrade the main DB behind its back.
            validate_schema(&pool).await?;
            Ok(pool)
        })
        .await
        .cloned()
}
async fn validate_schema(pool: &SqlitePool) -> Result<()> {
    for query in [
        "SELECT id,title,draft,origin,app_type,provider_id,model,created_at,updated_at,revision,request_id,owner,lease_until FROM chat_conversations LIMIT 0",
        "SELECT id,conversation_id,ordinal,role,content,reply_to,request_id,status,error_code,finish_reason,app_type,provider_id,model,created_at,updated_at FROM chat_messages LIMIT 0",
        "SELECT asset_id,media_type,byte_length,width,height,storage_relpath,created_at FROM chat_assets LIMIT 0",
        "SELECT message_id,ordinal,asset_id,display_name FROM chat_message_assets LIMIT 0",
        "SELECT child_conversation_id,parent_conversation_id,source_message_id,source_ordinal,created_at FROM chat_conversation_branches LIMIT 0",
        "SELECT operation_id,fingerprint,source_conversation_id,source_revision,target_message_id,child_conversation_id,answer_message_id,created_at FROM chat_fork_operations LIMIT 0",
    ] {
        sqlx::query(query).execute(pool).await.map_err(|_| "chat_not_initialized".to_string())?;
    }
    Ok(())
}
fn conversation(r: sqlx::sqlite::SqliteRow) -> Result<Conversation> {
    Ok(Conversation {
        id: r.try_get("id").map_err(storage)?,
        origin: match r.try_get::<String, _>("origin").map_err(storage)?.as_str() {
            "workspace" => ConversationOrigin::Workspace,
            "sidebar" => ConversationOrigin::Sidebar,
            "quick-chat" => ConversationOrigin::QuickChat,
            _ => return Err("chat_storage".into()),
        },
        title: r.try_get("title").map_err(storage)?,
        draft: r.try_get("draft").map_err(storage)?,
        app_type: r.try_get("app_type").map_err(storage)?,
        provider_id: r.try_get("provider_id").map_err(storage)?,
        model: r.try_get("model").map_err(storage)?,
        created_at: r.try_get("created_at").map_err(storage)?,
        updated_at: r.try_get("updated_at").map_err(storage)?,
        revision: r.try_get("revision").map_err(storage)?,
        request_id: r.try_get("request_id").map_err(storage)?,
        lease_until: r.try_get("lease_until").map_err(storage)?,
    })
}
fn branch_summary(r: sqlx::sqlite::SqliteRow) -> Result<BranchSummary> {
    Ok(BranchSummary {
        conversation_id: r.try_get("child_conversation_id").map_err(storage)?,
        parent_conversation_id: r.try_get("parent_conversation_id").map_err(storage)?,
        source_message_id: r.try_get("source_message_id").map_err(storage)?,
        source_ordinal: r.try_get("source_ordinal").map_err(storage)?,
        created_at: r.try_get("created_at").map_err(storage)?,
    })
}
fn message(r: sqlx::sqlite::SqliteRow) -> Result<Message> {
    Ok(Message {
        id: r.try_get("id").map_err(storage)?,
        conversation_id: r.try_get("conversation_id").map_err(storage)?,
        ordinal: r.try_get("ordinal").map_err(storage)?,
        role: r.try_get("role").map_err(storage)?,
        content: r.try_get("content").map_err(storage)?,
        reply_to: r.try_get("reply_to").map_err(storage)?,
        request_id: r.try_get("request_id").map_err(storage)?,
        status: r.try_get("status").map_err(storage)?,
        error_code: r.try_get("error_code").map_err(storage)?,
        finish_reason: r.try_get("finish_reason").map_err(storage)?,
        app_type: r.try_get("app_type").map_err(storage)?,
        provider_id: r.try_get("provider_id").map_err(storage)?,
        model: r.try_get("model").map_err(storage)?,
        created_at: r.try_get("created_at").map_err(storage)?,
        updated_at: r.try_get("updated_at").map_err(storage)?,
        assets: Vec::new(),
    })
}
async fn durable_budget(
    pool: &SqlitePool,
    conversation: &str,
    before: Option<i64>,
) -> Result<(usize, u64, u64)> {
    let row = sqlx::query("SELECT count(ma.asset_id) refs,coalesce(sum(a.byte_length),0) bytes,coalesce(sum(a.width*a.height),0) pixels FROM chat_messages m LEFT JOIN chat_message_assets ma ON ma.message_id=m.id LEFT JOIN chat_assets a ON a.asset_id=ma.asset_id WHERE m.conversation_id=? AND m.role='user' AND (? IS NULL OR m.ordinal<?)")
        .bind(conversation).bind(before).bind(before).fetch_one(pool).await.map_err(storage)?;
    Ok((
        row.try_get::<i64, _>("refs").map_err(storage)? as usize,
        row.try_get::<i64, _>("bytes").map_err(storage)? as u64,
        row.try_get::<i64, _>("pixels").map_err(storage)? as u64,
    ))
}
async fn text_budget(
    pool: &SqlitePool,
    conversation: &str,
    before: Option<i64>,
) -> Result<(usize, usize)> {
    let row = sqlx::query("SELECT count(*) messages,coalesce(sum(length(CAST(content AS BLOB))),0) bytes FROM chat_messages WHERE conversation_id=? AND (? IS NULL OR ordinal<?)")
        .bind(conversation).bind(before).bind(before).fetch_one(pool).await.map_err(storage)?;
    Ok((
        row.try_get::<i64, _>("messages").map_err(storage)? as usize,
        row.try_get::<i64, _>("bytes").map_err(storage)? as usize,
    ))
}
fn fork_fingerprint(i: &ForkEditInput) -> String {
    let mut hash = Sha256::new();
    for value in [
        i.source_conversation_id.as_str(),
        &i.source_revision.to_string(),
        i.target_message_id.as_str(),
        i.operation_id.as_str(),
        i.request_id.as_str(),
        i.app_type.as_str(),
        i.provider_id.as_str(),
        i.model.as_str(),
        i.text.as_deref().unwrap_or(""),
        i.reasoning.as_deref().unwrap_or(""),
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value.as_bytes());
    }
    for stage in &i.stage_ids {
        hash.update((stage.len() as u64).to_be_bytes());
        hash.update(stage.as_bytes());
    }
    let bytes = hash.finalize();
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes(bytes[0..4].try_into().unwrap()),
        u16::from_be_bytes(bytes[4..6].try_into().unwrap()),
        u16::from_be_bytes(bytes[6..8].try_into().unwrap()),
        u16::from_be_bytes(bytes[8..10].try_into().unwrap()),
        u64::from_be_bytes([
            0, 0, bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ])
    )
}
pub fn changed(rows: u64) -> Result<()> {
    if rows == 1 {
        Ok(())
    } else {
        Err("chat_conflict".into())
    }
}
impl Repository {
    pub async fn shared() -> Result<Self> {
        Ok(Self {
            pool: shared_pool().await?,
        })
    }

    pub async fn open(path: &Path) -> Result<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .map_err(storage)?;
        // The SQL plugin owns migrations. Never create/upgrade the main DB behind its back.
        validate_schema(&pool).await?;
        Ok(Self { pool })
    }
    pub async fn recover(&self) -> Result<()> {
        self.recover_at(now()).await
    }
    pub(super) async fn recover_at(&self, cutoff: i64) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(storage)?;
        sqlx::query("UPDATE chat_messages SET status='interrupted',error_code='chat_interrupted',updated_at=? WHERE status='pending' AND conversation_id IN (SELECT id FROM chat_conversations WHERE lease_until <= ?)")
   .bind(cutoff).bind(cutoff).execute(&mut *tx).await.map_err(storage)?;
        sqlx::query("UPDATE chat_conversations SET request_id=NULL,owner=NULL,lease_until=NULL,revision=revision+1 WHERE lease_until <= ?")
   .bind(cutoff).execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)
    }
    pub async fn list(&self, input: ListInput) -> Result<Vec<Conversation>> {
        if input.search.len() > 4096 {
            return Err(invalid());
        }
        self.recover().await?;
        // instr gives literal, parameterized matching: %, _ and quotes are not LIKE patterns.
        sqlx::query("SELECT * FROM chat_conversations WHERE instr(lower(title),lower(?))>0 ORDER BY updated_at DESC,id LIMIT 50 OFFSET ?")
   .bind(input.search).bind(i64::from(input.offset)).fetch_all(&self.pool).await.map_err(storage)?.into_iter().map(conversation).collect()
    }
    pub async fn get(&self, id: &str) -> Result<Detail> {
        uuid(id)?;
        self.recover().await?;
        let mut tx = self.pool.begin().await.map_err(storage)?;
        let c = sqlx::query("SELECT * FROM chat_conversations WHERE id=?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(storage)?
            .ok_or_else(|| "chat_not_found".to_string())?;
        let mut messages =
            sqlx::query("SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY ordinal")
                .bind(id)
                .fetch_all(&mut *tx)
                .await
                .map_err(storage)?
                .into_iter()
                .map(message)
                .collect::<Result<Vec<_>>>()?;
        super::assets::attach_descriptors_tx(&mut tx, &mut messages).await?;
        let current = sqlx::query("SELECT child_conversation_id,parent_conversation_id,source_message_id,source_ordinal,created_at FROM chat_conversation_branches WHERE child_conversation_id=?")
            .bind(id).fetch_optional(&mut *tx).await.map_err(storage)?
            .map(branch_summary).transpose()?;
        let children = sqlx::query("SELECT child_conversation_id,parent_conversation_id,source_message_id,source_ordinal,created_at FROM chat_conversation_branches WHERE parent_conversation_id=? ORDER BY created_at DESC,child_conversation_id LIMIT 50")
            .bind(id).fetch_all(&mut *tx).await.map_err(storage)?.into_iter()
            .map(branch_summary).collect::<Result<Vec<_>>>()?;
        tx.commit().await.map_err(storage)?;
        Ok(Detail {
            conversation: conversation(c)?,
            messages,
            lineage: BranchLineage { current, children },
        })
    }
    pub async fn create(&self, input: CreateInput) -> Result<Detail> {
        let title = input.title.unwrap_or_default();
        if title.len() > 512 {
            return Err(invalid());
        }
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO chat_conversations(id,title,origin,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
        .bind(&id)
        .bind(title)
        .bind(input.origin.as_str())
        .bind(now())
        .bind(now())
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        self.get(&id).await
    }
    pub async fn update(&self, input: UpdateInput) -> Result<Detail> {
        let id = input.conversation_id.clone();
        self.flush(vec![input]).await?;
        self.get(&id).await
    }
    pub async fn flush(&self, inputs: Vec<UpdateInput>) -> Result<()> {
        if inputs.len() > 100 {
            return Err(invalid());
        }
        let mut tx = self.pool.begin().await.map_err(storage)?;
        for i in inputs {
            uuid(&i.conversation_id)?;
            if i.title.as_ref().is_some_and(|s| s.len() > 512)
                || i.draft.as_ref().is_some_and(|s| s.len() > 512 * 1024)
                || i.model.as_ref().is_some_and(|s| s.len() > 256)
            {
                return Err(invalid());
            }
            changed(sqlx::query("UPDATE chat_conversations SET title=coalesce(?,title),draft=coalesce(?,draft),app_type=coalesce(?,app_type),provider_id=coalesce(?,provider_id),model=coalesce(?,model),revision=revision+1,updated_at=? WHERE id=? AND revision=? AND (request_id IS NULL OR owner=?)")
    .bind(i.title).bind(i.draft).bind(i.app_type).bind(i.provider_id).bind(i.model).bind(now())
    .bind(i.conversation_id).bind(i.revision).bind(&super::runtime::shared().owner).execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
        }
        tx.commit().await.map_err(storage)
    }
    pub async fn delete(&self, i: DeleteInput) -> Result<()> {
        uuid(&i.conversation_id)?;
        let _asset_guard = super::assets::lock().await;
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // Explicit message delete also works with the self-referencing reply constraint.
        let row =
            sqlx::query("SELECT revision,owner,lease_until FROM chat_conversations WHERE id=?")
                .bind(&i.conversation_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(storage)?
                .ok_or_else(|| "chat_not_found".to_string())?;
        if row.try_get::<i64, _>("revision").map_err(storage)? != i.revision {
            return Err("chat_conflict".into());
        }
        let foreign = row
            .try_get::<Option<String>, _>("owner")
            .map_err(storage)?
            .is_some_and(|o| o != super::runtime::shared().owner);
        if foreign
            && row
                .try_get::<Option<i64>, _>("lease_until")
                .map_err(storage)?
                .is_some_and(|t| t > now())
        {
            return Err("chat_busy".into());
        }
        sqlx::query("DELETE FROM chat_messages WHERE conversation_id=?")
            .bind(&i.conversation_id)
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        changed(
            sqlx::query("DELETE FROM chat_conversations WHERE id=? AND revision=?")
                .bind(i.conversation_id)
                .bind(i.revision)
                .execute(&mut *tx)
                .await
                .map_err(storage)?
                .rows_affected(),
        )?;
        let orphaned: Vec<String> = sqlx::query_scalar("SELECT asset_id FROM chat_assets WHERE NOT EXISTS (SELECT 1 FROM chat_message_assets ma WHERE ma.asset_id=chat_assets.asset_id)")
            .fetch_all(&mut *tx).await.map_err(storage)?;
        sqlx::query("DELETE FROM chat_assets WHERE NOT EXISTS (SELECT 1 FROM chat_message_assets ma WHERE ma.asset_id=chat_assets.asset_id)")
            .execute(&mut *tx).await.map_err(storage)?;
        let moved = super::assets::trash_objects_locked(&orphaned)?;
        if let Err(error) = tx.commit().await.map_err(storage) {
            super::assets::restore_trash_locked(&moved);
            return Err(error);
        }
        super::assets::purge_trash_locked(&moved);
        Ok(())
    }
    pub async fn begin(&self, i: &GenerateInput, owner: &str) -> Result<(Message, Vec<Message>)> {
        uuid(&i.conversation_id)?;
        uuid(&i.request_id)?;
        if i.model.trim().is_empty() || i.model.len() > 256 {
            return Err(invalid());
        }
        if i.retry && (i.text.is_some() || !i.stage_ids.is_empty()) {
            return Err(invalid());
        }
        // Reject aggregate metadata budgets before opening the writer transaction or publishing objects.
        let mut asset_guard = super::assets::lock().await;
        let (refs, bytes, pixels) = durable_budget(&self.pool, &i.conversation_id, None).await?;
        let staged = super::assets::staged_budget(
            &asset_guard,
            &super::assets::session_owner(),
            &i.stage_ids,
        )?;
        super::assets::validate_budget(refs + staged.0, bytes + staged.1, pixels + staged.2)?;
        let (message_count, text_bytes) = text_budget(&self.pool, &i.conversation_id, None).await?;
        let added_messages = if i.retry { 0 } else { 2 };
        let added_text = if i.retry {
            0
        } else {
            i.text.as_deref().unwrap_or_default().len()
        };
        if message_count + added_messages > 200 || text_bytes + added_text > 512 * 1024 {
            return Err("chat_context_limit".into());
        }
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // This write is the transaction serialization point across all instances.
        changed(sqlx::query("UPDATE chat_conversations SET request_id=?,owner=?,lease_until=?,revision=revision+1,draft=CASE WHEN ? THEN draft ELSE '' END,app_type=?,provider_id=?,model=?,updated_at=? WHERE id=? AND revision=? AND request_id IS NULL")
   .bind(&i.request_id).bind(owner).bind(now()+30_000).bind(i.retry).bind(&i.app_type).bind(&i.provider_id).bind(&i.model)
   .bind(now()).bind(&i.conversation_id).bind(i.revision).execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
        let running: i64 =
            sqlx::query_scalar("SELECT count(*) FROM chat_conversations WHERE lease_until>?")
                .bind(now())
                .fetch_one(&mut *tx)
                .await
                .map_err(storage)?;
        if running > 4 {
            return Err("chat_capacity".into());
        }
        let rows =
            sqlx::query("SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY ordinal")
                .bind(&i.conversation_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(storage)?;
        let mut history: Vec<Message> = rows.into_iter().map(message).collect::<Result<_>>()?;
        // Revalidate from transactional metadata while the writer fence is held. This performs no
        // object reads or base64 work and happens before any object promotion.
        super::assets::attach_descriptors_tx(&mut tx, &mut history).await?;
        let existing_refs = history
            .iter()
            .filter(|m| m.role == "user")
            .map(|m| m.assets.len())
            .sum::<usize>();
        let existing_bytes = history
            .iter()
            .filter(|m| m.role == "user")
            .flat_map(|m| &m.assets)
            .map(|a| a.byte_length as u64)
            .sum::<u64>();
        let existing_pixels = history
            .iter()
            .filter(|m| m.role == "user")
            .flat_map(|m| &m.assets)
            .map(|a| a.width as u64 * a.height as u64)
            .sum::<u64>();
        let staged = super::assets::staged_budget(
            &asset_guard,
            &super::assets::session_owner(),
            &i.stage_ids,
        )?;
        super::assets::validate_budget(
            existing_refs + staged.0,
            existing_bytes + staged.1,
            existing_pixels + staged.2,
        )?;
        let answer_id;
        let mut published = None;
        if i.retry {
            let last = history.pop().ok_or_else(invalid)?;
            if last.role != "assistant"
                || !["failed", "stopped", "interrupted"].contains(&last.status.as_str())
            {
                return Err(invalid());
            }
            answer_id = last.id;
            sqlx::query("UPDATE chat_messages SET content='',status='pending',request_id=?,error_code=NULL,finish_reason=NULL,app_type=?,provider_id=?,model=?,updated_at=? WHERE id=?")
    .bind(&i.request_id).bind(&i.app_type).bind(&i.provider_id).bind(&i.model).bind(now()).bind(&answer_id)
    .execute(&mut *tx).await.map_err(storage)?;
        } else {
            if history.last().is_some_and(|m| {
                m.role == "assistant" && !["completed", "stopped"].contains(&m.status.as_str())
            }) {
                return Err("chat_retry_required".into());
            }
            let text = i.text.as_deref().unwrap_or_default();
            if text.trim().is_empty() && i.stage_ids.is_empty() {
                return Err(invalid());
            }
            if text.len() > 512 * 1024 {
                return Err("chat_context_limit".into());
            }
            let ordinal = history.last().map_or(0, |m| m.ordinal + 1);
            let user_id = uuid::Uuid::new_v4().to_string();
            answer_id = uuid::Uuid::new_v4().to_string();
            for (id, role, content, reply, status, n) in [
                (&user_id, "user", text, None, "completed", ordinal),
                (
                    &answer_id,
                    "assistant",
                    "",
                    Some(&user_id),
                    "pending",
                    ordinal + 1,
                ),
            ] {
                sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,reply_to,request_id,status,app_type,provider_id,model,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
     .bind(id).bind(&i.conversation_id).bind(n).bind(role).bind(content).bind(reply).bind(&i.request_id).bind(status)
     .bind(&i.app_type).bind(&i.provider_id).bind(&i.model).bind(now()).bind(now()).execute(&mut *tx).await.map_err(storage)?;
            }
            published = Some(
                super::assets::promote(
                    &asset_guard,
                    &mut tx,
                    &super::assets::session_owner(),
                    &user_id,
                    &i.stage_ids,
                )
                .await?,
            );
            if history.is_empty() {
                let title: String = text
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .chars()
                    .take(80)
                    .collect();
                sqlx::query("UPDATE chat_conversations SET title=? WHERE id=? AND title=''")
                    .bind(title)
                    .bind(&i.conversation_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(storage)?;
            }
            history.push(Message {
                id: user_id,
                conversation_id: i.conversation_id.clone(),
                ordinal,
                role: "user".into(),
                content: text.to_string(),
                reply_to: None,
                request_id: i.request_id.clone(),
                status: "completed".into(),
                error_code: None,
                finish_reason: None,
                app_type: i.app_type.clone(),
                provider_id: i.provider_id.clone(),
                model: i.model.clone(),
                created_at: now(),
                updated_at: now(),
                assets: Vec::new(),
            });
        }
        if history.len() > 200
            || history.iter().map(|m| m.content.len()).sum::<usize>() > 512 * 1024
        {
            return Err("chat_context_limit".into());
        }
        super::assets::attach_descriptors_tx(&mut tx, &mut history).await?;
        // Enforce aggregate limits and verify every durable object before the message/lease commit.
        super::assets::validate_history(&history)?;
        let answer = message(
            sqlx::query("SELECT * FROM chat_messages WHERE id=?")
                .bind(answer_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(storage)?,
        )?;
        tx.commit().await.map_err(storage)?;
        if let Some(objects) = published {
            objects.commit();
        }
        super::assets::consume_locked(&mut asset_guard, &i.stage_ids);
        Ok((answer, history))
    }

    pub async fn fork_edit_existing(&self, i: &ForkEditInput) -> Result<Option<ForkEditReceipt>> {
        let row = sqlx::query("SELECT fingerprint,source_conversation_id,source_revision,target_message_id,child_conversation_id,answer_message_id FROM chat_fork_operations WHERE operation_id=?")
            .bind(&i.operation_id).fetch_optional(&self.pool).await.map_err(storage)?;
        let Some(row) = row else {
            return Ok(None);
        };
        if row.try_get::<String, _>("fingerprint").map_err(storage)? != fork_fingerprint(i)
            || row
                .try_get::<String, _>("source_conversation_id")
                .map_err(storage)?
                != i.source_conversation_id
            || row.try_get::<i64, _>("source_revision").map_err(storage)? != i.source_revision
            || row
                .try_get::<String, _>("target_message_id")
                .map_err(storage)?
                != i.target_message_id
        {
            return Err("chat_conflict".into());
        }
        let child: Option<String> = row.try_get("child_conversation_id").map_err(storage)?;
        let answer_id: Option<String> = row.try_get("answer_message_id").map_err(storage)?;
        let (Some(child), Some(answer_id)) = (child, answer_id) else {
            // Deleting the result permanently tombstones the operation. Exact and mismatched
            // replays are both conflicts and can never schedule a second provider request.
            return Err("chat_conflict".into());
        };
        let answer = message(
            sqlx::query("SELECT * FROM chat_messages WHERE id=? AND conversation_id=?")
                .bind(answer_id)
                .bind(&child)
                .fetch_one(&self.pool)
                .await
                .map_err(storage)?,
        )?;
        Ok(Some(ForkEditReceipt {
            operation_id: i.operation_id.clone(),
            source_conversation_id: i.source_conversation_id.clone(),
            source_revision: i.source_revision,
            target_message_id: i.target_message_id.clone(),
            child_conversation_id: child,
            answer,
            replayed: true,
        }))
    }

    /// Atomically creates a copy-on-write child and its pending answer. The source row is
    /// used only as a serialization/CAS fence and is never changed.
    pub async fn fork_edit_begin(
        &self,
        i: &ForkEditInput,
        owner: &str,
    ) -> Result<(ForkEditReceipt, Vec<Message>)> {
        uuid(&i.source_conversation_id)?;
        uuid(&i.target_message_id)?;
        uuid(&i.operation_id)?;
        uuid(&i.request_id)?;
        if i.source_revision < 0 || i.model.trim().is_empty() || i.model.len() > 256 {
            return Err(invalid());
        }
        let text = i.text.as_deref().unwrap_or_default();
        if text.len() > 512 * 1024 {
            return Err("chat_context_limit".into());
        }
        if let Some(receipt) = self.fork_edit_existing(i).await? {
            return Ok((receipt, Vec::new()));
        }
        let mut asset_guard = super::assets::lock().await;
        // Metadata-only preflight before the writer transaction and object promotion.
        let target_ordinal: i64 = sqlx::query_scalar(
            "SELECT ordinal FROM chat_messages WHERE id=? AND conversation_id=?",
        )
        .bind(&i.target_message_id)
        .bind(&i.source_conversation_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?
        .ok_or_else(|| "chat_not_found".to_string())?;
        let (mut refs, mut bytes, mut pixels) =
            durable_budget(&self.pool, &i.source_conversation_id, Some(target_ordinal)).await?;
        if i.stage_ids.is_empty() {
            let row = sqlx::query("SELECT count(ma.asset_id) refs,coalesce(sum(a.byte_length),0) bytes,coalesce(sum(a.width*a.height),0) pixels FROM chat_message_assets ma JOIN chat_assets a ON a.asset_id=ma.asset_id WHERE ma.message_id=?")
                .bind(&i.target_message_id).fetch_one(&self.pool).await.map_err(storage)?;
            refs += row.try_get::<i64, _>("refs").map_err(storage)? as usize;
            bytes += row.try_get::<i64, _>("bytes").map_err(storage)? as u64;
            pixels += row.try_get::<i64, _>("pixels").map_err(storage)? as u64;
        } else {
            let staged = super::assets::staged_budget(
                &asset_guard,
                &super::assets::session_owner(),
                &i.stage_ids,
            )?;
            refs += staged.0;
            bytes += staged.1;
            pixels += staged.2;
        }
        super::assets::validate_budget(refs, bytes, pixels)?;
        let (message_count, text_bytes) =
            text_budget(&self.pool, &i.source_conversation_id, Some(target_ordinal)).await?;
        if message_count + 2 > 200 || text_bytes + text.len() > 512 * 1024 {
            return Err("chat_context_limit".into());
        }
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // Serialize before the in-transaction idempotency lookup. Concurrent processes then
        // observe the committed winner instead of upgrading a stale WAL snapshot.
        changed(sqlx::query("UPDATE chat_conversations SET revision=revision WHERE id=? AND revision=? AND request_id IS NULL")
            .bind(&i.source_conversation_id).bind(i.source_revision)
            .execute(&mut *tx).await.map_err(storage)?.rows_affected())?;

        // Idempotency is durable and checked before touching the source. A reused operation id
        // is accepted only when every durable request identity field still matches.
        if let Some(row) = sqlx::query("SELECT fingerprint,source_conversation_id,source_revision,target_message_id,child_conversation_id,answer_message_id FROM chat_fork_operations WHERE operation_id=?")
            .bind(&i.operation_id).fetch_optional(&mut *tx).await.map_err(storage)? {
            if row.try_get::<String, _>("fingerprint").map_err(storage)? != fork_fingerprint(i)
                || row.try_get::<String, _>("source_conversation_id").map_err(storage)? != i.source_conversation_id
                || row.try_get::<i64, _>("source_revision").map_err(storage)? != i.source_revision
                || row.try_get::<String, _>("target_message_id").map_err(storage)? != i.target_message_id
            { return Err("chat_conflict".into()); }
            let child: Option<String> = row.try_get("child_conversation_id").map_err(storage)?;
            let answer_id: Option<String> = row.try_get("answer_message_id").map_err(storage)?;
            let (Some(child), Some(answer_id)) = (child, answer_id) else { return Err("chat_conflict".into()); };
            let answer = message(sqlx::query("SELECT * FROM chat_messages WHERE id=? AND conversation_id=?")
                .bind(answer_id).bind(&child).fetch_one(&mut *tx).await.map_err(storage)?)?;
            tx.commit().await.map_err(storage)?;
            return Ok((ForkEditReceipt {
                operation_id: i.operation_id.clone(), source_conversation_id: i.source_conversation_id.clone(),
                source_revision: i.source_revision, target_message_id: i.target_message_id.clone(),
                child_conversation_id: child, answer, replayed: true,
            }, Vec::new()));
        }

        let source = sqlx::query("SELECT * FROM chat_conversations WHERE id=?")
            .bind(&i.source_conversation_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(storage)?;
        let source_origin: String = source.try_get("origin").map_err(storage)?;
        let source_title: String = source.try_get("title").map_err(storage)?;
        let target = sqlx::query(
            "SELECT ordinal,role,status FROM chat_messages WHERE id=? AND conversation_id=?",
        )
        .bind(&i.target_message_id)
        .bind(&i.source_conversation_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(storage)?
        .ok_or_else(|| "chat_not_found".to_string())?;
        let target_ordinal: i64 = target.try_get("ordinal").map_err(storage)?;
        let target_assets: i64 =
            sqlx::query_scalar("SELECT count(*) FROM chat_message_assets WHERE message_id=?")
                .bind(&i.target_message_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(storage)?;
        let budget = sqlx::query("SELECT count(ma.asset_id) refs,coalesce(sum(a.byte_length),0) bytes,coalesce(sum(a.width*a.height),0) pixels FROM chat_messages m LEFT JOIN chat_message_assets ma ON ma.message_id=m.id LEFT JOIN chat_assets a ON a.asset_id=ma.asset_id WHERE m.conversation_id=? AND m.role='user' AND m.ordinal<?")
            .bind(&i.source_conversation_id).bind(target_ordinal).fetch_one(&mut *tx).await.map_err(storage)?;
        let (mut check_refs, mut check_bytes, mut check_pixels) = (
            budget.try_get::<i64, _>("refs").map_err(storage)? as usize,
            budget.try_get::<i64, _>("bytes").map_err(storage)? as u64,
            budget.try_get::<i64, _>("pixels").map_err(storage)? as u64,
        );
        if i.stage_ids.is_empty() {
            let target_budget = sqlx::query("SELECT count(ma.asset_id) refs,coalesce(sum(a.byte_length),0) bytes,coalesce(sum(a.width*a.height),0) pixels FROM chat_message_assets ma JOIN chat_assets a ON a.asset_id=ma.asset_id WHERE ma.message_id=?")
                .bind(&i.target_message_id).fetch_one(&mut *tx).await.map_err(storage)?;
            check_refs += target_budget.try_get::<i64, _>("refs").map_err(storage)? as usize;
            check_bytes += target_budget.try_get::<i64, _>("bytes").map_err(storage)? as u64;
            check_pixels += target_budget.try_get::<i64, _>("pixels").map_err(storage)? as u64;
        } else {
            let staged = super::assets::staged_budget(
                &asset_guard,
                &super::assets::session_owner(),
                &i.stage_ids,
            )?;
            check_refs += staged.0;
            check_bytes += staged.1;
            check_pixels += staged.2;
        }
        super::assets::validate_budget(check_refs, check_bytes, check_pixels)?;
        if text.trim().is_empty() && i.stage_ids.is_empty() && target_assets == 0 {
            return Err(invalid());
        }
        if target.try_get::<String, _>("role").map_err(storage)? != "user"
            || target.try_get::<String, _>("status").map_err(storage)? != "completed"
        {
            return Err(invalid());
        }
        let prefix_rows = sqlx::query(
            "SELECT * FROM chat_messages WHERE conversation_id=? AND ordinal<? ORDER BY ordinal",
        )
        .bind(&i.source_conversation_id)
        .bind(target_ordinal)
        .fetch_all(&mut *tx)
        .await
        .map_err(storage)?;
        let prefix = prefix_rows
            .into_iter()
            .map(message)
            .collect::<Result<Vec<_>>>()?;
        for (n, m) in prefix.iter().enumerate() {
            let expected_role = if n % 2 == 0 { "user" } else { "assistant" };
            if m.ordinal != n as i64
                || m.role != expected_role
                || (m.role == "user" && m.status != "completed")
                || (m.role == "assistant" && !["completed", "stopped"].contains(&m.status.as_str()))
                || (m.role == "assistant"
                    && m.reply_to.as_deref()
                        != prefix.get(n.wrapping_sub(1)).map(|p| p.id.as_str()))
            {
                return Err("chat_conflict".into());
            }
        }
        if target_ordinal != prefix.len() as i64 || target_ordinal % 2 != 0 {
            return Err("chat_conflict".into());
        }
        let child = uuid::Uuid::new_v4().to_string();
        let user_id = uuid::Uuid::new_v4().to_string();
        let answer_id = uuid::Uuid::new_v4().to_string();
        let title = if target_ordinal == 0 {
            text.lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(80)
                .collect::<String>()
        } else {
            source_title
        };
        let timestamp = now();
        let running: i64 =
            sqlx::query_scalar("SELECT count(*) FROM chat_conversations WHERE lease_until>?")
                .bind(timestamp)
                .fetch_one(&mut *tx)
                .await
                .map_err(storage)?;
        if running >= 4 {
            return Err("chat_capacity".into());
        }
        sqlx::query("INSERT INTO chat_conversations(id,title,draft,origin,app_type,provider_id,model,created_at,updated_at,revision,request_id,owner,lease_until) VALUES(?,?,'',?,?,?,?,?,?,1,?,?,?)")
            .bind(&child).bind(title).bind(source_origin).bind(&i.app_type).bind(&i.provider_id).bind(&i.model)
            .bind(timestamp).bind(timestamp).bind(&i.request_id).bind(owner).bind(timestamp+30_000)
            .execute(&mut *tx).await.map_err(storage)?;
        sqlx::query("INSERT INTO chat_conversation_branches(child_conversation_id,parent_conversation_id,source_message_id,source_ordinal,created_at) VALUES(?,?,?,?,?)")
            .bind(&child).bind(&i.source_conversation_id).bind(&i.target_message_id).bind(target_ordinal).bind(timestamp)
            .execute(&mut *tx).await.map_err(storage)?;
        let mut id_map = std::collections::HashMap::new();
        let mut history = Vec::new();
        for old in prefix {
            let new_id = uuid::Uuid::new_v4().to_string();
            let request = uuid::Uuid::new_v4().to_string();
            let reply = old.reply_to.as_ref().and_then(|id| id_map.get(id)).cloned();
            sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,reply_to,request_id,status,error_code,finish_reason,app_type,provider_id,model,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
                .bind(&new_id).bind(&child).bind(old.ordinal).bind(&old.role).bind(&old.content).bind(&reply).bind(&request)
                .bind(&old.status).bind(&old.error_code).bind(&old.finish_reason).bind(&old.app_type).bind(&old.provider_id).bind(&old.model)
                .bind(old.created_at).bind(old.updated_at).execute(&mut *tx).await.map_err(storage)?;
            sqlx::query("INSERT INTO chat_message_assets(message_id,ordinal,asset_id,display_name) SELECT ?,ordinal,asset_id,display_name FROM chat_message_assets WHERE message_id=?")
                .bind(&new_id).bind(&old.id).execute(&mut *tx).await.map_err(storage)?;
            id_map.insert(old.id, new_id.clone());
            history.push(Message {
                id: new_id,
                conversation_id: child.clone(),
                request_id: request,
                reply_to: reply,
                assets: Vec::new(),
                ..old
            });
        }
        for (id, role, content, reply, status, ordinal) in [
            (&user_id, "user", text, None, "completed", target_ordinal),
            (
                &answer_id,
                "assistant",
                "",
                Some(user_id.as_str()),
                "pending",
                target_ordinal + 1,
            ),
        ] {
            sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,reply_to,request_id,status,app_type,provider_id,model,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
                .bind(id).bind(&child).bind(ordinal).bind(role).bind(content).bind(reply).bind(&i.request_id).bind(status)
                .bind(&i.app_type).bind(&i.provider_id).bind(&i.model).bind(timestamp).bind(timestamp)
                .execute(&mut *tx).await.map_err(storage)?;
        }
        sqlx::query("INSERT INTO chat_fork_operations(operation_id,fingerprint,source_conversation_id,source_revision,target_message_id,child_conversation_id,answer_message_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(&i.operation_id).bind(fork_fingerprint(i)).bind(&i.source_conversation_id).bind(i.source_revision)
            .bind(&i.target_message_id).bind(&child).bind(&answer_id).bind(timestamp)
            .execute(&mut *tx).await.map_err(|e| if e.to_string().contains("UNIQUE") { "chat_conflict".into() } else { storage(e) })?;
        let mut published = None;
        if i.stage_ids.is_empty() {
            sqlx::query("INSERT INTO chat_message_assets(message_id,ordinal,asset_id,display_name) SELECT ?,ordinal,asset_id,display_name FROM chat_message_assets WHERE message_id=?")
                .bind(&user_id).bind(&i.target_message_id).execute(&mut *tx).await.map_err(storage)?;
        } else {
            published = Some(
                super::assets::promote(
                    &asset_guard,
                    &mut tx,
                    &super::assets::session_owner(),
                    &user_id,
                    &i.stage_ids,
                )
                .await?,
            );
        }
        history.push(Message {
            id: user_id.clone(),
            conversation_id: child.clone(),
            ordinal: target_ordinal,
            role: "user".into(),
            content: text.into(),
            reply_to: None,
            request_id: i.request_id.clone(),
            status: "completed".into(),
            error_code: None,
            finish_reason: None,
            app_type: i.app_type.clone(),
            provider_id: i.provider_id.clone(),
            model: i.model.clone(),
            created_at: timestamp,
            updated_at: timestamp,
            assets: Vec::new(),
        });
        if history.len() > 200
            || history.iter().map(|m| m.content.len()).sum::<usize>() > 512 * 1024
        {
            return Err("chat_context_limit".into());
        }
        super::assets::attach_descriptors_tx(&mut tx, &mut history).await?;
        super::assets::validate_history(&history)?;
        let answer = message(
            sqlx::query("SELECT * FROM chat_messages WHERE id=?")
                .bind(&answer_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(storage)?,
        )?;
        tx.commit().await.map_err(storage)?;
        if let Some(objects) = published {
            objects.commit();
        }
        super::assets::consume_locked(&mut asset_guard, &i.stage_ids);
        Ok((
            ForkEditReceipt {
                operation_id: i.operation_id.clone(),
                source_conversation_id: i.source_conversation_id.clone(),
                source_revision: i.source_revision,
                target_message_id: i.target_message_id.clone(),
                child_conversation_id: child,
                answer,
                replayed: false,
            },
            history,
        ))
    }
    pub async fn retry_snapshot(
        &self,
        m: &Message,
        owner: &str,
        text: &str,
        status: &str,
        error: Option<&str>,
        finish: Option<&str>,
    ) -> Result<()> {
        match self.save(m, owner, text, status, error, finish, true).await {
            Err(e) if e == "chat_conflict" => {
                self.archive_snapshot(m, text, status, error, finish).await
            }
            result => result,
        }
    }
    pub async fn checkpoint(
        &self,
        m: &Message,
        owner: &str,
        text: &str,
        status: &str,
        error: Option<&str>,
        finish: Option<&str>,
    ) -> Result<()> {
        self.save(m, owner, text, status, error, finish, false)
            .await
    }
    async fn archive_snapshot(
        &self,
        m: &Message,
        text: &str,
        status: &str,
        error: Option<&str>,
        finish: Option<&str>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // Serialize against deletion and another owner's writes; never mutate their content.
        sqlx::query("UPDATE chat_conversations SET revision=revision WHERE id=?")
            .bind(&m.conversation_id)
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        let exists: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM chat_messages WHERE id=? AND conversation_id=?",
        )
        .bind(&m.id)
        .bind(&m.conversation_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(storage)?;
        if exists == 0 {
            return tx.commit().await.map_err(storage);
        } // explicit deletion wins
        let id = uuid::Uuid::new_v4().to_string();
        let user_id = uuid::Uuid::new_v4().to_string();
        // Superseded retained text gets a separate, searchable conversation with its user turn.
        sqlx::query("INSERT INTO chat_conversations(id,title,origin,app_type,provider_id,model,created_at,updated_at) SELECT ?,title,origin,?,?,?, ?,? FROM chat_conversations WHERE id=?")
            .bind(&id).bind(&m.app_type).bind(&m.provider_id).bind(&m.model).bind(now()).bind(now()).bind(&m.conversation_id)
            .execute(&mut *tx).await.map_err(storage)?;
        changed(sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,request_id,status,app_type,provider_id,model,created_at,updated_at) SELECT ?,?,0,'user',content,?,'completed',?,?,?, ?,? FROM chat_messages WHERE id=? AND conversation_id=?")
            .bind(&user_id).bind(&id).bind(&m.request_id).bind(&m.app_type).bind(&m.provider_id).bind(&m.model).bind(now()).bind(now()).bind(&m.reply_to).bind(&m.conversation_id)
            .execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
        sqlx::query("INSERT INTO chat_message_assets(message_id,ordinal,asset_id,display_name) SELECT ?,ordinal,asset_id,display_name FROM chat_message_assets WHERE message_id=?")
            .bind(&user_id).bind(&m.reply_to).execute(&mut *tx).await.map_err(storage)?;
        sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,reply_to,request_id,status,error_code,finish_reason,app_type,provider_id,model,created_at,updated_at) VALUES(?,?,1,'assistant',?,?,?,?,?,?,?,?,?,?,?)")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&id).bind(text).bind(&user_id).bind(&m.request_id).bind(status).bind(error).bind(finish)
            .bind(&m.app_type).bind(&m.provider_id).bind(&m.model).bind(now()).bind(now()).execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)
    }
    async fn save(
        &self,
        m: &Message,
        owner: &str,
        text: &str,
        status: &str,
        error: Option<&str>,
        finish: Option<&str>,
        repair: bool,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(storage)?;
        if repair {
            // Reclaim only the exact recovered answer, never another request/owner.
            sqlx::query("UPDATE chat_conversations SET request_id=?,owner=?,lease_until=? WHERE id=? AND request_id IS NULL AND owner IS NULL AND EXISTS (SELECT 1 FROM chat_messages WHERE id=? AND conversation_id=? AND request_id=? AND status='interrupted')")
                .bind(&m.request_id).bind(owner).bind(now()+30_000).bind(&m.conversation_id)
                .bind(&m.id).bind(&m.conversation_id).bind(&m.request_id)
                .execute(&mut *tx).await.map_err(storage)?;
        }
        changed(sqlx::query("UPDATE chat_conversations SET lease_until=?,updated_at=? WHERE id=? AND request_id=? AND owner=? AND (lease_until>? OR ?=1)")
   .bind(now()+30_000).bind(now()).bind(&m.conversation_id).bind(&m.request_id).bind(owner).bind(now()).bind(repair)
   .execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
        changed(sqlx::query("UPDATE chat_messages SET content=?,status=?,error_code=?,finish_reason=?,updated_at=? WHERE id=? AND request_id=? AND (status='pending' OR (?=1 AND status='interrupted'))")
   .bind(text).bind(status).bind(error).bind(finish).bind(now()).bind(&m.id).bind(&m.request_id).bind(repair)
   .execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
        if status != "pending" {
            changed(sqlx::query("UPDATE chat_conversations SET request_id=NULL,owner=NULL,lease_until=NULL,revision=revision+1 WHERE id=? AND request_id=? AND owner=?")
    .bind(&m.conversation_id).bind(&m.request_id).bind(owner).execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
        }
        tx.commit().await.map_err(storage)
    }
}

#[cfg(test)]
mod readiness_tests {
    use super::*;
    use sqlx::{Connection, Executor};
    #[tokio::test]
    async fn chat_readiness_rejects_empty_old_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.db");
        let mut c = sqlx::SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        c.execute(super::super::SCHEMA).await.unwrap();
        assert!(matches!(Repository::open(&path).await, Err(e) if e == "chat_not_initialized"));
        c.execute(super::super::ORIGIN_MIGRATION).await.unwrap();
        sqlx::raw_sql(crate::MIGRATION_CREATE_CHAT_ASSETS_SQL)
            .execute(&mut c)
            .await
            .unwrap();
        assert!(Repository::open(&path).await.is_ok());
        c.execute("ALTER TABLE chat_messages RENAME COLUMN finish_reason TO missing_finish")
            .await
            .unwrap();
        assert!(Repository::open(&path).await.is_err());
    }
    #[tokio::test]
    async fn chat_readiness_decoders_return_errors_without_panics() {
        let mut c = sqlx::SqliteConnection::connect("sqlite::memory:")
            .await
            .unwrap();
        assert!(conversation(
            sqlx::query("SELECT 1 AS id")
                .fetch_one(&mut c)
                .await
                .unwrap()
        )
        .is_err());
        for query in [
            "SELECT 'x' AS id, 'invalid' AS origin",
            "SELECT 'x' AS id, 42 AS origin",
            "SELECT 'x' AS id, NULL AS origin",
        ] {
            assert!(conversation(sqlx::query(query).fetch_one(&mut c).await.unwrap()).is_err());
        }
        assert!(message(
            sqlx::query("SELECT 1 AS id")
                .fetch_one(&mut c)
                .await
                .unwrap()
        )
        .is_err());
    }
}
