use super::{
    repository::Repository,
    stream::{Decoder, Part},
    types::*,
};
use crate::provider::chat_runtime::Protocol;
use sqlx::{sqlite::SqliteConnection, Connection};
pub(super) async fn database() -> (tempfile::TempDir, Repository) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("chat.db");
    std::fs::File::create(&path).unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .foreign_keys(true);
    let mut c = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::raw_sql(super::SCHEMA).execute(&mut c).await.unwrap();
    c.close().await.unwrap();
    let repo = Repository::open(&path).await.unwrap();
    (dir, repo)
}
pub(super) fn generation(c: &Conversation) -> GenerateInput {
    GenerateInput {
        conversation_id: c.id.clone(),
        revision: c.revision,
        request_id: uuid::Uuid::new_v4().to_string(),
        app_type: "claude".into(),
        provider_id: "synthetic".into(),
        model: "test".into(),
        text: Some("你好\nsecond line".into()),
        retry: false,
    }
}
fn update(c: &Conversation, draft: &str) -> UpdateInput {
    UpdateInput {
        conversation_id: c.id.clone(),
        revision: c.revision,
        title: None,
        draft: Some(draft.into()),
        app_type: None,
        provider_id: None,
        model: None,
    }
}
#[tokio::test]
async fn chat_real_sqlite_reopen_rollback_revision_lease_retry_delete() {
    let (dir, repo) = database().await;
    let c = repo
        .create(CreateInput { title: None })
        .await
        .unwrap()
        .conversation;
    let i = generation(&c);
    let (m, history) = repo.begin(&i, "owner-a").await.unwrap();
    assert_eq!(history.len(), 1);
    assert!(repo.begin(&i, "owner-b").await.is_err());
    assert!(repo.update(update(&c, "wrong revision")).await.is_err());
    assert!(repo
        .checkpoint(&m, "owner-b", "overwrite", "completed", None, None)
        .await
        .is_err());
    repo.checkpoint(&m, "owner-a", "partial", "pending", None, None)
        .await
        .unwrap();
    repo.recover().await.unwrap();
    assert_eq!(repo.get(&c.id).await.unwrap().messages[1].status, "pending");
    sqlx::query("UPDATE chat_conversations SET lease_until=0 WHERE id=?")
        .bind(&c.id)
        .execute(&repo.pool)
        .await
        .unwrap();
    assert!(repo
        .checkpoint(&m, "owner-a", "late", "completed", None, None)
        .await
        .is_err());
    repo.recover().await.unwrap();
    let d = repo.get(&c.id).await.unwrap();
    assert_eq!(d.messages[1].status, "interrupted");
    assert_eq!(d.messages[1].content, "partial");
    let mut retry = generation(&d.conversation);
    retry.retry = true;
    retry.text = None;
    let (m2, h) = repo.begin(&retry, "owner-b").await.unwrap();
    assert_eq!(m.id, m2.id);
    assert_eq!(h.len(), 1);
    assert!(repo
        .checkpoint(&m, "owner-a", "late", "completed", None, None)
        .await
        .is_err());
    repo.checkpoint(
        &m2,
        "owner-b",
        "answer",
        "completed",
        None,
        Some("end_turn"),
    )
    .await
    .unwrap();
    assert!(repo
        .checkpoint(&m2, "owner-b", "duplicate", "stopped", None, None)
        .await
        .is_err());
    let d = repo.get(&c.id).await.unwrap();
    assert_eq!(d.messages.len(), 2);
    assert!(d.conversation.request_id.is_none());
    // A failing item rolls back every earlier draft in the batch.
    let other = repo
        .create(CreateInput {
            title: Some("literal %_ '".into()),
        })
        .await
        .unwrap()
        .conversation;
    let mut stale = update(&other, "bad");
    stale.revision = 99;
    assert!(repo
        .flush(vec![update(&d.conversation, "must rollback"), stale])
        .await
        .is_err());
    assert_eq!(repo.get(&c.id).await.unwrap().conversation.draft, "");
    repo.update(update(&d.conversation, "persisted"))
        .await
        .unwrap();
    repo.pool.close().await;
    let reopened = Repository::open(&dir.path().join("chat.db")).await.unwrap();
    let d = reopened.get(&c.id).await.unwrap();
    assert_eq!(d.conversation.draft, "persisted");
    assert_eq!(d.messages[1].content, "answer");
    assert_eq!(
        reopened
            .list(ListInput {
                search: "%_ '".into(),
                offset: 0
            })
            .await
            .unwrap()
            .len(),
        1
    );
    reopened
        .delete(DeleteInput {
            conversation_id: c.id.clone(),
            revision: d.conversation.revision,
        })
        .await
        .unwrap();
    assert!(reopened
        .checkpoint(&m2, "owner-b", "resurrect", "completed", None, None)
        .await
        .is_err());
    assert!(reopened.get(&c.id).await.is_err());
}
#[tokio::test]
async fn chat_pagination_capacity_context_rollback() {
    let (_dir, repo) = database().await;
    for n in 0..55 {
        repo.create(CreateInput {
            title: Some(format!("chat {n}")),
        })
        .await
        .unwrap();
    }
    assert_eq!(
        repo.list(ListInput {
            search: "chat".into(),
            offset: 0
        })
        .await
        .unwrap()
        .len(),
        50
    );
    assert_eq!(
        repo.list(ListInput {
            search: "chat".into(),
            offset: 50
        })
        .await
        .unwrap()
        .len(),
        5
    );
    let all = repo
        .list(ListInput {
            search: "chat".into(),
            offset: 0,
        })
        .await
        .unwrap();
    for c in &all[..4] {
        repo.begin(&generation(c), "owner").await.unwrap();
    }
    assert_eq!(
        repo.begin(&generation(&all[4]), "owner").await.unwrap_err(),
        "chat_capacity"
    );
    assert!(repo.get(&all[4].id).await.unwrap().messages.is_empty());
    let mut i = generation(&all[5]);
    i.text = Some("x".repeat(512 * 1024 + 1));
    assert!(repo.begin(&i, "owner").await.is_err());
    assert!(repo.get(&all[5].id).await.unwrap().messages.is_empty());
}
pub(super) fn fixtures() -> Vec<(Protocol, String)> {
    vec![
 (Protocol::Messages,concat!("data: {\"type\":\"message_start\"}\r\n\r\n",
 "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\r\n\r\n",
 "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\r\n\r\n",
 "data: {\"type\":\"message_stop\"}\r\n\r\n").into()),
 (Protocol::Chat,concat!(": ping\n\n","data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"你好\"},\"finish_reason\":null}]}\n\n",
 "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n","data: [DONE]\n\n").into()),
 (Protocol::Responses,concat!("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\n",
 "data: \"delta\":\"你好\"}\n\n","data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n").into())]
}
#[test]
fn chat_three_protocols_every_byte_utf8_crlf_multiline_and_eof() {
    for (p, raw) in fixtures() {
        let mut decoder = Decoder::new(p);
        let mut text = String::new();
        let mut done = 0;
        for b in raw.as_bytes() {
            for part in decoder.feed(&[*b]).unwrap() {
                match part {
                    Part::Text(s) => text.push_str(&s),
                    Part::Done(_) => done += 1,
                }
            }
        }
        decoder.eof().unwrap();
        assert_eq!(text, "你好");
        assert_eq!(done, 1);
        assert!(Decoder::new(p).eof().is_err());
    }
    for (p,raw) in [(Protocol::Chat,"data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[]}}]}\n\n"),
 (Protocol::Messages,"data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\"}}\n\n"),
 (Protocol::Responses,"data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\"}}\n\n")] {
  assert_eq!(Decoder::new(p).feed(raw.as_bytes()).unwrap_err(),"chat_protocol");
 }
    assert!(Decoder::new(Protocol::Chat)
        .feed(&vec![b'x'; super::stream::MAX_FRAME + 1])
        .is_err());
}

pub(super) async fn mock_server(
    status: &str,
    body: Vec<u8>,
    delay: bool,
) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let status = status.to_string();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buf = [0; 4096];
        let mut header_end = None;
        loop {
            let n = socket.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            request.extend_from_slice(&buf[..n]);
            if header_end.is_none() {
                header_end = request
                    .windows(4)
                    .position(|w| w == b"\r\n\r\n")
                    .map(|n| n + 4)
            }
            if let Some(end) = header_end {
                let headers = String::from_utf8_lossy(&request[..end]);
                let len = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|s| s.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if request.len() >= end + len {
                    break;
                }
            }
        }
        if delay {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            return request;
        }
        let headers=format!("HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
        if socket.write_all(headers.as_bytes()).await.is_ok() {
            for b in body {
                if socket
                    .write_all(&[b'1', b'\r', b'\n', b, b'\r', b'\n'])
                    .await
                    .is_err()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
            let _ = socket.write_all(b"0\r\n\r\n").await;
        }
        request
    });
    (format!("http://{address}"), server)
}
#[tokio::test]
async fn chat_three_protocols_mock_http_chunked_safety_and_status() {
    use crate::provider::chat_runtime::{endpoint, Runtime};
    for (protocol, fixture) in fixtures() {
        let (base, server) = mock_server("200 OK", fixture.into_bytes(), false).await;
        let runtime = Runtime {
            protocol,
            endpoint: endpoint(&base, protocol).unwrap(),
            key: "synthetic-only".into(),
            model: None,
        };
        let (_cancel, rx) = tokio::sync::watch::channel(false);
        let (tx, mut events) = tokio::sync::mpsc::channel(32);
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        super::stream::run(client, runtime, "mock-model".into(), vec![], rx, tx).await;
        let mut text = String::new();
        let mut done = 0;
        while let Some(event) = events.recv().await {
            match event.unwrap() {
                Part::Text(s) => text.push_str(&s),
                Part::Done(_) => done += 1,
            }
        }
        assert_eq!(text, "你好");
        assert_eq!(done, 1);
        let request = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(request.contains("synthetic-only"));
        assert!(request.contains("\"stream\":true"));
        assert!(!request.contains("tools"));
    }
    for (status, expected) in [
        ("401 Unauthorized", "chat_auth"),
        ("403 Forbidden", "chat_auth"),
        ("429 Too Many Requests", "chat_rate_limit"),
        ("302 Found", "chat_http"),
    ] {
        let (base, server) = mock_server(status, b"secret-raw-upstream-body".to_vec(), false).await;
        let runtime = Runtime {
            protocol: Protocol::Chat,
            endpoint: base,
            key: "synthetic".into(),
            model: None,
        };
        let (_cancel, rx) = tokio::sync::watch::channel(false);
        let (tx, mut events) = tokio::sync::mpsc::channel(32);
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        super::stream::run(client, runtime, "mock-model".into(), vec![], rx, tx).await;
        assert_eq!(events.recv().await.unwrap().unwrap_err(), expected);
        server.await.unwrap();
    }
}
#[tokio::test]
async fn chat_mock_http_cancel_connect_wait_and_before_start() {
    use crate::provider::chat_runtime::Runtime;
    for before in [true, false] {
        let (base, server) = mock_server("200 OK", vec![], true).await;
        let runtime = Runtime {
            protocol: Protocol::Chat,
            endpoint: base,
            key: "synthetic".into(),
            model: None,
        };
        let (cancel, rx) = tokio::sync::watch::channel(before);
        let (tx, mut events) = tokio::sync::mpsc::channel(32);
        let job = tokio::spawn(super::stream::run(
            reqwest::Client::builder().no_proxy().build().unwrap(),
            runtime,
            "mock".into(),
            vec![],
            rx,
            tx,
        ));
        if !before {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            cancel.send_replace(true);
        }
        tokio::time::timeout(std::time::Duration::from_secs(1), job)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(events.recv().await.unwrap().unwrap_err(), "chat_cancelled");
        server.abort();
        let _ = server.await;
    }
}
#[tokio::test]
async fn chat_transaction_failure_rolls_back_messages_and_lease() {
    let (_dir, repo) = database().await;
    let c = repo
        .create(CreateInput { title: None })
        .await
        .unwrap()
        .conversation;
    sqlx::raw_sql("CREATE TRIGGER fail_answer BEFORE INSERT ON chat_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'injected'); END;")
  .execute(&repo.pool).await.unwrap();
    assert_eq!(
        repo.begin(&generation(&c), "owner").await.unwrap_err(),
        "chat_storage"
    );
    let d = repo.get(&c.id).await.unwrap();
    assert!(d.messages.is_empty());
    assert_eq!(d.conversation.revision, 0);
    assert!(d.conversation.request_id.is_none());
    sqlx::query("DROP TRIGGER fail_answer")
        .execute(&repo.pool)
        .await
        .unwrap();
    let (message, _) = repo.begin(&generation(&c), "owner").await.unwrap();
    sqlx::raw_sql("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON chat_messages BEGIN SELECT RAISE(ABORT,'injected'); END;")
  .execute(&repo.pool).await.unwrap();
    assert_eq!(
        repo.checkpoint(&message, "owner", "partial", "completed", None, None)
            .await
            .unwrap_err(),
        "chat_storage"
    );
    let d = repo.get(&c.id).await.unwrap();
    assert_eq!(d.messages[1].status, "pending");
    assert_eq!(d.messages[1].content, "");
    assert!(d.conversation.request_id.is_some());
}

#[tokio::test]
async fn chat_context_message_count_and_byte_limits_rollback() {
    let (_dir, repo) = database().await;
    for (count, bytes) in [(200, 1), (2, 512 * 1024)] {
        let c = repo
            .create(CreateInput { title: None })
            .await
            .unwrap()
            .conversation;
        for ordinal in 0..count {
            sqlx::query("INSERT INTO chat_messages(id,conversation_id,ordinal,role,content,request_id,status,app_type,provider_id,model,created_at,updated_at) VALUES(?,?,?,?,?,?,'completed','claude','mock','mock',0,0)")
                .bind(uuid::Uuid::new_v4().to_string()).bind(&c.id).bind(ordinal)
                .bind(if ordinal%2==0 {"user"}else{"assistant"}).bind("x".repeat(bytes))
                .bind(uuid::Uuid::new_v4().to_string()).execute(&repo.pool).await.unwrap();
        }
        assert_eq!(
            repo.begin(&generation(&c), "owner").await.unwrap_err(),
            "chat_context_limit"
        );
        let d = repo.get(&c.id).await.unwrap();
        assert_eq!(d.messages.len(), count as usize);
        assert_eq!(d.conversation.revision, 0);
        assert!(d.conversation.request_id.is_none());
    }
}
#[test]
fn chat_ipc_unknown_fields_rejected() {
    let raw = serde_json::json!({"conversationId":uuid::Uuid::new_v4().to_string(),"projectId":"forbidden"});
    assert!(serde_json::from_value::<Identity>(raw).is_err());
    let raw = serde_json::json!({"title":"test","tools":[]});
    assert!(serde_json::from_value::<CreateInput>(raw).is_err());
}

#[tokio::test]
async fn chat_explicit_snapshot_retry_expired_lease_cannot_overwrite_recovery() {
    let (_dir, repo) = database().await;
    let c = repo
        .create(CreateInput { title: None })
        .await
        .unwrap()
        .conversation;
    let (m, _) = repo.begin(&generation(&c), "owner").await.unwrap();
    sqlx::query("UPDATE chat_conversations SET lease_until=0 WHERE id=?")
        .bind(&c.id)
        .execute(&repo.pool)
        .await
        .unwrap();
    repo.retry_snapshot(&m, "owner", "unsaved", "failed", Some("chat_storage"), None)
        .await
        .unwrap();
    assert_eq!(
        repo.get(&c.id).await.unwrap().messages[1].content,
        "unsaved"
    );
    let d = repo.get(&c.id).await.unwrap();
    let mut i = generation(&d.conversation);
    i.retry = true;
    i.text = None;
    let (retry, _) = repo.begin(&i, "owner2").await.unwrap();
    repo.retry_snapshot(&m, "owner", "retained old text", "completed", None, None)
        .await
        .unwrap();
    assert_eq!(
        repo.get(&c.id).await.unwrap().messages[1].request_id,
        retry.request_id
    );
    let rows = repo
        .list(ListInput {
            search: String::new(),
            offset: 0,
        })
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    let archived = rows.iter().find(|r| r.id != c.id).unwrap();
    assert_eq!(
        repo.get(&archived.id).await.unwrap().messages[1].content,
        "retained old text"
    );
    sqlx::query("UPDATE chat_conversations SET lease_until=0 WHERE id=?")
        .bind(&c.id)
        .execute(&repo.pool)
        .await
        .unwrap();
    repo.recover().await.unwrap();
    repo.retry_snapshot(&retry, "owner2", "reconciled", "completed", None, None)
        .await
        .unwrap();
    assert_eq!(
        repo.get(&c.id).await.unwrap().messages[1].content,
        "reconciled"
    );
}

#[tokio::test]
async fn chat_additive_migration_preserves_existing_tables_and_rolls_back_failure() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    std::fs::File::create(&path).unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&path)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::raw_sql("CREATE TABLE legacy_marker(value TEXT); INSERT INTO legacy_marker VALUES('keep'); CREATE TABLE chat_messages(broken TEXT);")
        .execute(&mut connection).await.unwrap();
    let mut tx = connection.begin().await.unwrap();
    assert!(sqlx::raw_sql(super::SCHEMA)
        .execute(&mut *tx)
        .await
        .is_err());
    tx.rollback().await.unwrap();
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name='chat_conversations'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert_eq!(count, 0);
    sqlx::query("DROP TABLE chat_messages")
        .execute(&mut connection)
        .await
        .unwrap();
    let mut tx = connection.begin().await.unwrap();
    sqlx::raw_sql(super::SCHEMA)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let marker: String = sqlx::query_scalar("SELECT value FROM legacy_marker")
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(marker, "keep");
    connection.close().await.unwrap();
    let repo = Repository::open(&path).await.unwrap();
    assert!(repo
        .list(ListInput {
            search: String::new(),
            offset: 0
        })
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn chat_mock_http_cancel_stalled_body_read() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let _ = socket.read(&mut buf).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
        let _ = ready_tx.send(());
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    });
    let runtime = crate::provider::chat_runtime::Runtime {
        protocol: Protocol::Chat,
        endpoint: format!("http://{address}"),
        key: "synthetic".into(),
        model: None,
    };
    let (cancel, rx) = tokio::sync::watch::channel(false);
    let (tx, mut events) = tokio::sync::mpsc::channel(8);
    let task = tokio::spawn(super::stream::run(
        reqwest::Client::builder().no_proxy().build().unwrap(),
        runtime,
        "mock".into(),
        vec![],
        rx,
        tx,
    ));
    ready_rx.await.unwrap();
    cancel.send_replace(true);
    tokio::time::timeout(std::time::Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(events.recv().await.unwrap().unwrap_err(), "chat_cancelled");
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn chat_retry_preserves_independent_saved_draft() {
    let (_dir, repo) = database().await;
    let c = repo
        .create(CreateInput { title: None })
        .await
        .unwrap()
        .conversation;
    let (m, _) = repo.begin(&generation(&c), "owner").await.unwrap();
    repo.checkpoint(&m, "owner", "partial", "stopped", None, None)
        .await
        .unwrap();
    let d = repo.get(&c.id).await.unwrap();
    let d = repo
        .update(update(&d.conversation, "next unrelated question"))
        .await
        .unwrap();
    let mut i = generation(&d.conversation);
    i.retry = true;
    i.text = None;
    let (answer, history) = repo.begin(&i, "owner").await.unwrap();
    let d = repo.get(&c.id).await.unwrap();
    assert_eq!(d.conversation.draft, "next unrelated question");
    assert_eq!(answer.id, m.id);
    assert_eq!(d.messages.len(), 2);
    assert_eq!(history[0].content, "你好\nsecond line");
}

#[tokio::test]
async fn chat_early_restart_refresh_and_exact_expiry_boundary() {
    let (dir, repo) = database().await;
    let c = repo
        .create(CreateInput { title: None })
        .await
        .unwrap()
        .conversation;
    repo.begin(&generation(&c), "crashed-owner").await.unwrap();
    repo.pool.close().await;
    let repo = Repository::open(&dir.path().join("chat.db")).await.unwrap();
    assert_eq!(repo.get(&c.id).await.unwrap().messages[1].status, "pending");
    let cutoff = now() + 60_000;
    sqlx::query("UPDATE chat_conversations SET lease_until=? WHERE id=?")
        .bind(cutoff)
        .bind(&c.id)
        .execute(&repo.pool)
        .await
        .unwrap();
    repo.recover_at(cutoff - 1).await.unwrap();
    assert!(repo
        .get(&c.id)
        .await
        .unwrap()
        .conversation
        .request_id
        .is_some());
    repo.recover_at(cutoff).await.unwrap();
    let d = repo.get(&c.id).await.unwrap();
    assert_eq!(d.messages[1].status, "interrupted");
    assert!(d.conversation.request_id.is_none());
    // Refresh alone after an early reopen recovers without a generation or second restart.
    let (m, _) = repo
        .begin(
            &{
                let mut i = generation(&d.conversation);
                i.retry = true;
                i
            },
            "crashed-again",
        )
        .await
        .unwrap();
    sqlx::query("UPDATE chat_conversations SET lease_until=0 WHERE id=?")
        .bind(&c.id)
        .execute(&repo.pool)
        .await
        .unwrap();
    let rows = repo
        .list(ListInput {
            search: String::new(),
            offset: 0,
        })
        .await
        .unwrap();
    assert!(rows[0].request_id.is_none());
    let d = repo.get(&c.id).await.unwrap();
    assert_eq!(d.messages[1].id, m.id);
    assert_eq!(d.messages[1].status, "interrupted");
    repo.update(update(&d.conversation, "editable after refresh"))
        .await
        .unwrap();
}
