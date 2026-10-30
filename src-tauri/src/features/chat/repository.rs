use super::types::*;
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
            sqlx::query("SELECT id,revision,lease_until FROM chat_conversations LIMIT 0")
                .execute(&pool)
                .await
                .map_err(|_| "chat_not_initialized".to_string())?;
            Ok(pool)
        })
        .await
        .cloned()
}
fn conversation(r: sqlx::sqlite::SqliteRow) -> Conversation {
    Conversation {
        id: r.get("id"),
        title: r.get("title"),
        draft: r.get("draft"),
        app_type: r.get("app_type"),
        provider_id: r.get("provider_id"),
        model: r.get("model"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
        revision: r.get("revision"),
        request_id: r.get("request_id"),
        lease_until: r.get("lease_until"),
    }
}
fn message(r: sqlx::sqlite::SqliteRow) -> Message {
    Message {
        id: r.get("id"),
        conversation_id: r.get("conversation_id"),
        ordinal: r.get("ordinal"),
        role: r.get("role"),
        content: r.get("content"),
        reply_to: r.get("reply_to"),
        request_id: r.get("request_id"),
        status: r.get("status"),
        error_code: r.get("error_code"),
        finish_reason: r.get("finish_reason"),
        app_type: r.get("app_type"),
        provider_id: r.get("provider_id"),
        model: r.get("model"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
    }
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
        sqlx::query("SELECT id,revision,lease_until FROM chat_conversations LIMIT 0")
            .execute(&pool)
            .await
            .map_err(|_| "chat_not_initialized".to_string())?;
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
   .bind(input.search).bind(i64::from(input.offset)).fetch_all(&self.pool).await.map(|r|r.into_iter().map(conversation).collect()).map_err(storage)
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
        let messages =
            sqlx::query("SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY ordinal")
                .bind(id)
                .fetch_all(&mut *tx)
                .await
                .map_err(storage)?
                .into_iter()
                .map(message)
                .collect();
        tx.commit().await.map_err(storage)?;
        Ok(Detail {
            conversation: conversation(c),
            messages,
        })
    }
    pub async fn create(&self, input: CreateInput) -> Result<Detail> {
        let title = input.title.unwrap_or_default();
        if title.len() > 512 {
            return Err(invalid());
        }
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO chat_conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)",
        )
        .bind(&id)
        .bind(title)
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
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // Explicit message delete also works with the self-referencing reply constraint.
        let row =
            sqlx::query("SELECT revision,owner,lease_until FROM chat_conversations WHERE id=?")
                .bind(&i.conversation_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(storage)?
                .ok_or_else(|| "chat_not_found".to_string())?;
        if row.get::<i64, _>("revision") != i.revision {
            return Err("chat_conflict".into());
        }
        let foreign = row
            .get::<Option<String>, _>("owner")
            .is_some_and(|o| o != super::runtime::shared().owner);
        if foreign
            && row
                .get::<Option<i64>, _>("lease_until")
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
        tx.commit().await.map_err(storage)
    }
    pub async fn begin(&self, i: &GenerateInput, owner: &str) -> Result<(Message, Vec<Message>)> {
        uuid(&i.conversation_id)?;
        uuid(&i.request_id)?;
        if i.model.trim().is_empty() || i.model.len() > 256 {
            return Err(invalid());
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
        let mut history: Vec<Message> = rows.into_iter().map(message).collect();
        let answer_id;
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
            if history
                .last()
                .is_some_and(|m| m.role == "assistant" && m.status != "completed")
            {
                return Err("chat_retry_required".into());
            }
            let text = i
                .text
                .as_ref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(invalid)?;
            if text.len() > 512 * 1024 {
                return Err("chat_context_limit".into());
            }
            let ordinal = history.last().map_or(0, |m| m.ordinal + 1);
            let user_id = uuid::Uuid::new_v4().to_string();
            answer_id = uuid::Uuid::new_v4().to_string();
            for (id, role, content, reply, status, n) in [
                (&user_id, "user", text.as_str(), None, "completed", ordinal),
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
                content: text.clone(),
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
            });
        }
        if history.len() > 200
            || history.iter().map(|m| m.content.len()).sum::<usize>() > 512 * 1024
        {
            return Err("chat_context_limit".into());
        }
        let answer = message(
            sqlx::query("SELECT * FROM chat_messages WHERE id=?")
                .bind(answer_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(storage)?,
        );
        tx.commit().await.map_err(storage)?;
        Ok((answer, history))
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
        sqlx::query("INSERT INTO chat_conversations(id,title,app_type,provider_id,model,created_at,updated_at) SELECT ?,title,?,?,?, ?,? FROM chat_conversations WHERE id=?")
            .bind(&id).bind(&m.app_type).bind(&m.provider_id).bind(&m.model).bind(now()).bind(now()).bind(&m.conversation_id)
            .execute(&mut *tx).await.map_err(storage)?;
        changed(sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,request_id,status,app_type,provider_id,model,created_at,updated_at) SELECT ?,?,0,'user',content,?,'completed',?,?,?, ?,? FROM chat_messages WHERE id=? AND conversation_id=?")
            .bind(&user_id).bind(&id).bind(&m.request_id).bind(&m.app_type).bind(&m.provider_id).bind(&m.model).bind(now()).bind(now()).bind(&m.reply_to).bind(&m.conversation_id)
            .execute(&mut *tx).await.map_err(storage)?.rows_affected())?;
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
