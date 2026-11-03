use super::*;
use sqlx::migrate::{Migration, MigrationType, Migrator};
use std::borrow::Cow;
fn migrator() -> Migrator {
    Migrator { migrations: Cow::Owned(crate::migrations().into_iter().filter(|m| (55..=58).contains(&m.version)).map(|m|
        Migration::new(m.version, Cow::Borrowed(m.description), MigrationType::Simple, Cow::Borrowed(m.sql), false)
    ).collect()), ..Migrator::DEFAULT }
}
async fn fixture(variant: &str) -> (tempfile::TempDir, PathBuf, SqliteConnection) {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("test.db");
    let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await.unwrap();
    c.execute("CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY,description TEXT NOT NULL,installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,success BOOLEAN NOT NULL,checksum BLOB NOT NULL,execution_time BIGINT NOT NULL)").await.unwrap();
    c.execute(crate::chat::SCHEMA).await.unwrap();
    c.execute("INSERT INTO chat_conversations(id,title,created_at,updated_at) VALUES('synthetic','synthetic',1,1)").await.unwrap();
    let hash = match variant { "lf" => checksum(crate::chat::SCHEMA), "crlf" => checksum(&crate::chat::SCHEMA.replace('\n', "\r\n")), _ => vec![42;48] };
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(55,?,1,?,0)")
        .bind(identity(55).0).bind(hash).execute(&mut c).await.unwrap();
    (dir,path,c)
}
#[tokio::test]
async fn chat_sql_bytes_actual_sqlx_known_variants_upgrade() {
    for variant in ["lf", "crlf"] {
        let (_dir,path,mut c) = fixture(variant).await;
        assert_eq!(reconcile(&mut c,&path).await.unwrap(), variant == "crlf");
        migrator().run(&mut c).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT origin FROM chat_conversations WHERE id='synthetic'").fetch_one(&mut c).await.unwrap(), "workspace");
        assert!(!reconcile(&mut c,&path).await.unwrap());
    }
}
#[tokio::test]
async fn chat_sql_bytes_unknown_identity_success_schema_fail_unchanged() {
    for bad in ["unknown", "identity", "success", "schema"] {
        let (dir,path,mut c) = fixture(if bad == "unknown" { "unknown" } else { "crlf" }).await;
        match bad {
            "identity" => {c.execute("UPDATE _sqlx_migrations SET description='unknown'").await.unwrap();},
            "success" => {c.execute("UPDATE _sqlx_migrations SET success=0").await.unwrap();},
            "schema" => {c.execute("DROP INDEX chat_answer_request").await.unwrap();}, _ => {}
        }
        let before = schema(&mut c,&["chat_conversations","chat_messages","_sqlx_migrations"]).await.unwrap();
        let marker: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut c).await.unwrap();
        assert!(reconcile(&mut c,&path).await.is_err());
        assert!(migrator().run(&mut c).await.is_err());
        assert_eq!(marker,sqlx::query_scalar::<_,Vec<u8>>("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut c).await.unwrap());
        assert_eq!(before,schema(&mut c,&["chat_conversations","chat_messages","_sqlx_migrations"]).await.unwrap());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(),1);
    }
}
#[tokio::test]
async fn chat_sql_bytes_translator_crlf_upgrade() {
    let (_dir,path,mut c) = fixture("lf").await;
    c.execute(crate::translator::history::SCHEMA).await.unwrap();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(57,?,1,?,0)")
        .bind(identity(57).0).bind(checksum(&crate::translator::history::SCHEMA.replace('\n',"\r\n"))).execute(&mut c).await.unwrap();
    assert!(reconcile(&mut c,&path).await.unwrap());
    migrator().run(&mut c).await.unwrap();
}
#[tokio::test]
async fn chat_sql_bytes_transaction_rollback_and_consistent_backup() {
    let (dir,path,mut c) = fixture("crlf").await;
    c.execute(crate::translator::history::SCHEMA).await.unwrap();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(57,?,1,?,0)")
        .bind(identity(57).0).bind(checksum(&crate::translator::history::SCHEMA.replace('\n',"\r\n"))).execute(&mut c).await.unwrap();
    c.execute("CREATE TRIGGER reject57 BEFORE UPDATE ON _sqlx_migrations WHEN OLD.version=57 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").await.unwrap();
    let old55: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut c).await.unwrap();
    assert!(reconcile(&mut c,&path).await.is_err());
    assert_eq!(old55,sqlx::query_scalar::<_,Vec<u8>>("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut c).await.unwrap());
    let backup = std::fs::read_dir(dir.path()).unwrap().map(|e|e.unwrap().path()).find(|p| p != &path).unwrap();
    let mut saved = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(backup).read_only(true)).await.unwrap();
    assert_eq!(old55,sqlx::query_scalar::<_,Vec<u8>>("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut saved).await.unwrap());
    assert_eq!(sqlx::query_scalar::<_,String>("SELECT title FROM chat_conversations WHERE id='synthetic'").fetch_one(&mut saved).await.unwrap(), "synthetic");
}
#[test]
fn chat_sql_bytes_exact_historical_hashes() {
    fn hex(sql: &str) -> String { checksum(sql).iter().map(|b|format!("{b:02x}")).collect() }
    assert_eq!(hex(crate::chat::SCHEMA), "9a9aea64f01f7354d095e08b0d09608ae2f2dbc7b996b8b4a5b03a25d6c1627a9a6a41d7713eb077bc04c77dd69af2a6");
    assert_eq!(hex(&crate::chat::SCHEMA.replace('\n',"\r\n")), "0c1cf71d975a97125ce7e5b07936c174792a8243ec8ada3a8dbd368e68eed4865c421a24f28f7fcd45a53202cf8aa92c");
    assert_eq!(hex(crate::translator::history::SCHEMA), "17b0e43aafa2cd579fb07bdd73b16884fa95013afaeed51e2a852ec64034a88e56304cdb6e76069ead5aa8d19d7f08d6");
    assert_eq!(hex(&crate::translator::history::SCHEMA.replace('\n',"\r\n")), "3e0df634b5420fb243e6230229a4fdb09d26787f0d6d599528e0ab8646dbcfd985cdc53555519f3655ab3e23d3900e12");
}

#[tokio::test]
async fn chat_sql_bytes_origin_lineage_must_match_marker_before_write() {
    for bad in ["missing", "checksum", "identity", "success", "absent_column"] {
        let (dir,path,mut c) = fixture("crlf").await;
        if bad != "absent_column" { c.execute(crate::chat::ORIGIN_MIGRATION).await.unwrap(); }
        if bad != "missing" {
            sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(58,?,?,?,0)")
                .bind(if bad == "identity" { "unknown" } else { "add_chat_conversation_origin" })
                .bind(bad != "success")
                .bind(if bad == "checksum" { vec![42;48] } else { checksum(crate::chat::ORIGIN_MIGRATION) })
                .execute(&mut c).await.unwrap();
        }
        let old: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut c).await.unwrap();
        assert!(reconcile(&mut c,&path).await.is_err(), "{bad}");
        assert_eq!(old, sqlx::query_scalar::<_,Vec<u8>>("SELECT checksum FROM _sqlx_migrations WHERE version=55").fetch_one(&mut c).await.unwrap());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(),1, "no backup/write for {bad}");
    }
    let (_dir,path,mut c) = fixture("crlf").await;
    c.execute(crate::chat::ORIGIN_MIGRATION).await.unwrap();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(58,'add_chat_conversation_origin',1,?,0)")
        .bind(checksum(crate::chat::ORIGIN_MIGRATION)).execute(&mut c).await.unwrap();
    assert!(reconcile(&mut c,&path).await.unwrap());
    migrator().run(&mut c).await.unwrap();
}
