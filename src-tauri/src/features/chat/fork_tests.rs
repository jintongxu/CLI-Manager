use super::{repository::Repository, tests::database, types::*};
use image::ImageFormat;
use sqlx::Row;
use std::io::Cursor;

async fn seeded() -> (tempfile::TempDir, Repository, Conversation, Vec<Message>) {
    let (dir, repo) = database().await;
    let mut conversation = repo
        .create(CreateInput {
            title: None,
            origin: ConversationOrigin::Sidebar,
        })
        .await
        .unwrap()
        .conversation;
    for n in 0..3 {
        let input = GenerateInput {
            conversation_id: conversation.id.clone(),
            revision: conversation.revision,
            request_id: uuid::Uuid::new_v4().to_string(),
            app_type: "claude".into(),
            provider_id: "synthetic".into(),
            model: "test".into(),
            text: Some(format!("question-{n}")),
            retry: false,
            reasoning: None,
            stage_ids: Vec::new(),
        };
        let (answer, _) = repo.begin(&input, "seed-owner").await.unwrap();
        repo.checkpoint(
            &answer,
            "seed-owner",
            &format!("answer-{n}"),
            "completed",
            None,
            Some("stop"),
        )
        .await
        .unwrap();
        conversation = repo.get(&conversation.id).await.unwrap().conversation;
    }
    let messages = repo.get(&conversation.id).await.unwrap().messages;
    (dir, repo, conversation, messages)
}

fn fork_input(source: &Conversation, target: &Message, text: &str) -> ForkEditInput {
    ForkEditInput {
        source_conversation_id: source.id.clone(),
        source_revision: source.revision,
        target_message_id: target.id.clone(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        request_id: uuid::Uuid::new_v4().to_string(),
        app_type: "claude".into(),
        provider_id: "synthetic".into(),
        model: "test".into(),
        text: Some(text.into()),
        reasoning: None,
        stage_ids: Vec::new(),
    }
}

#[tokio::test]
async fn chat_fork_edit_first_middle_latest_copies_settled_prefix_and_preserves_source() {
    for target_index in [0usize, 2, 4] {
        let (_dir, repo, source, messages) = seeded().await;
        let before = repo.get(&source.id).await.unwrap();
        let before_conversation = serde_json::to_value(&before.conversation).unwrap();
        let before_messages = serde_json::to_value(&before.messages).unwrap();
        let input = fork_input(&source, &messages[target_index], "edited first line\nrest");
        let (receipt, history) = repo.fork_edit_begin(&input, "fork-owner").await.unwrap();
        assert!(!receipt.replayed);
        assert_eq!(history.len(), target_index + 1);
        let child = repo.get(&receipt.child_conversation_id).await.unwrap();
        assert_eq!(child.conversation.origin, ConversationOrigin::Sidebar);
        assert_eq!(child.messages.len(), target_index + 2);
        assert_eq!(child.messages.last().unwrap().status, "pending");
        assert_eq!(
            child.messages[target_index].content,
            "edited first line\nrest"
        );
        assert_eq!(
            child.conversation.request_id.as_deref(),
            Some(input.request_id.as_str())
        );
        assert_eq!(
            child.conversation.title,
            if target_index == 0 {
                "edited first line"
            } else {
                "question-0"
            }
        );
        for (old, new) in messages[..target_index].iter().zip(&child.messages) {
            assert_ne!(old.id, new.id);
            assert_ne!(old.request_id, new.request_id);
            assert_eq!(
                (&old.role, &old.content, &old.status),
                (&new.role, &new.content, &new.status)
            );
            if new.role == "assistant" {
                assert_eq!(
                    new.reply_to.as_deref(),
                    child
                        .messages
                        .get(new.ordinal as usize - 1)
                        .map(|m| m.id.as_str())
                );
            }
        }
        let after = repo.get(&source.id).await.unwrap();
        assert_eq!(
            serde_json::to_value(&after.conversation).unwrap(),
            before_conversation
        );
        assert_eq!(
            serde_json::to_value(&after.messages).unwrap(),
            before_messages
        );
    }
}

#[tokio::test]
async fn chat_fork_edit_idempotency_cas_delete_and_parent_delete_lineage() {
    let (_dir, repo, source, messages) = seeded().await;
    let input = fork_input(&source, &messages[2], "edited");
    let (first, _) = repo.fork_edit_begin(&input, "owner").await.unwrap();
    let (again, history) = repo.fork_edit_begin(&input, "owner").await.unwrap();
    assert!(again.replayed);
    assert!(history.is_empty());
    assert_eq!(again.child_conversation_id, first.child_conversation_id);
    assert_eq!(again.answer.id, first.answer.id);
    let mut mismatch = input.clone();
    mismatch.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        repo.fork_edit_begin(&mismatch, "owner").await.unwrap_err(),
        "chat_conflict"
    );
    let mut stale = fork_input(&source, &messages[4], "stale");
    stale.source_revision -= 1;
    assert_eq!(
        repo.fork_edit_begin(&stale, "owner").await.unwrap_err(),
        "chat_conflict"
    );
    assert_eq!(
        repo.list(ListInput {
            search: String::new(),
            offset: 0
        })
        .await
        .unwrap()
        .len(),
        2
    );

    repo.checkpoint(
        &first.answer,
        "owner",
        "done",
        "completed",
        None,
        Some("stop"),
    )
    .await
    .unwrap();
    let child_now = repo
        .get(&first.child_conversation_id)
        .await
        .unwrap()
        .conversation;
    let continuation = GenerateInput {
        conversation_id: child_now.id.clone(),
        revision: child_now.revision,
        request_id: uuid::Uuid::new_v4().to_string(),
        app_type: "claude".into(),
        provider_id: "synthetic".into(),
        model: "test".into(),
        text: Some("continue".into()),
        retry: false,
        reasoning: None,
        stage_ids: Vec::new(),
    };
    let (later, _) = repo.begin(&continuation, "later-owner").await.unwrap();
    repo.checkpoint(
        &later,
        "later-owner",
        "later answer",
        "completed",
        None,
        Some("stop"),
    )
    .await
    .unwrap();
    assert_eq!(
        repo.fork_edit_existing(&input)
            .await
            .unwrap()
            .unwrap()
            .answer
            .id,
        first.answer.id
    );
    repo.delete(DeleteInput {
        conversation_id: source.id.clone(),
        revision: source.revision,
    })
    .await
    .unwrap();
    let child = repo.get(&first.child_conversation_id).await.unwrap();
    assert!(child
        .lineage
        .current
        .unwrap()
        .parent_conversation_id
        .is_none());
    assert_eq!(child.messages.last().unwrap().content, "later answer");
    assert_eq!(
        repo.fork_edit_existing(&input)
            .await
            .unwrap()
            .unwrap()
            .answer
            .id,
        first.answer.id
    );
}

#[tokio::test]
async fn chat_fork_operation_survives_answer_retry_and_child_delete() {
    let (_dir, repo, source, messages) = seeded().await;
    let input = fork_input(&source, &messages[0], "edited");
    let (first, _) = repo.fork_edit_begin(&input, "owner").await.unwrap();
    repo.checkpoint(
        &first.answer,
        "owner",
        "failed",
        "failed",
        Some("provider"),
        None,
    )
    .await
    .unwrap();
    let child = repo
        .get(&first.child_conversation_id)
        .await
        .unwrap()
        .conversation;
    let retry = GenerateInput {
        conversation_id: child.id.clone(),
        revision: child.revision,
        request_id: uuid::Uuid::new_v4().to_string(),
        app_type: "claude".into(),
        provider_id: "other".into(),
        model: "retry-model".into(),
        text: None,
        retry: true,
        reasoning: None,
        stage_ids: Vec::new(),
    };
    let (retried, _) = repo.begin(&retry, "retry-owner").await.unwrap();
    let replay = repo.fork_edit_existing(&input).await.unwrap().unwrap();
    assert_eq!(replay.child_conversation_id, first.child_conversation_id);
    assert_eq!(replay.answer.id, first.answer.id);
    repo.checkpoint(
        &retried,
        "retry-owner",
        "retry done",
        "completed",
        None,
        Some("stop"),
    )
    .await
    .unwrap();

    let child_now = repo
        .get(&first.child_conversation_id)
        .await
        .unwrap()
        .conversation;
    repo.delete(DeleteInput {
        conversation_id: child_now.id,
        revision: child_now.revision,
    })
    .await
    .unwrap();
    assert_eq!(
        repo.fork_edit_existing(&input).await.unwrap_err(),
        "chat_conflict"
    );
    assert_eq!(
        repo.fork_edit_begin(&input, "owner").await.unwrap_err(),
        "chat_conflict"
    );
    let operations: i64 =
        sqlx::query_scalar("SELECT count(*) FROM chat_fork_operations WHERE operation_id=?")
            .bind(&input.operation_id)
            .fetch_one(&repo.pool)
            .await
            .unwrap();
    assert_eq!(operations, 1);
    assert_eq!(
        repo.list(ListInput {
            search: String::new(),
            offset: 0
        })
        .await
        .unwrap()
        .len(),
        1
    );
}

#[tokio::test]
async fn chat_fork_edit_preserves_or_replaces_assets_and_accepts_image_only() {
    let (_dir, repo, source, messages) = seeded().await;
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
    let staged = super::assets::stage(super::assets::session_owner(), &png.into_inner())
        .await
        .unwrap();
    let mut add = fork_input(&source, &messages[0], "with image");
    add.stage_ids.push(staged.stage_id);
    let (with_asset, _) = repo.fork_edit_begin(&add, "owner-a").await.unwrap();
    let first = repo.get(&with_asset.child_conversation_id).await.unwrap();
    let asset = first.messages[0].assets[0].asset_id.clone();
    repo.checkpoint(&with_asset.answer, "owner-a", "ok", "completed", None, None)
        .await
        .unwrap();

    let first_conversation = repo
        .get(&with_asset.child_conversation_id)
        .await
        .unwrap()
        .conversation;
    let first_target = repo
        .get(&with_asset.child_conversation_id)
        .await
        .unwrap()
        .messages[0]
        .clone();
    let preserve = ForkEditInput {
        source_conversation_id: first_conversation.id.clone(),
        source_revision: first_conversation.revision,
        target_message_id: first_target.id,
        operation_id: uuid::Uuid::new_v4().to_string(),
        request_id: uuid::Uuid::new_v4().to_string(),
        app_type: "claude".into(),
        provider_id: "synthetic".into(),
        model: "test".into(),
        text: Some(String::new()),
        reasoning: None,
        stage_ids: Vec::new(),
    };
    let (preserved, _) = repo.fork_edit_begin(&preserve, "owner-b").await.unwrap();
    let preserved_detail = repo.get(&preserved.child_conversation_id).await.unwrap();
    assert_eq!(preserved_detail.messages[0].content, "");
    assert_eq!(preserved_detail.messages[0].assets[0].asset_id, asset);

    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(3, 2)
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
    let replacement = super::assets::stage(super::assets::session_owner(), &png.into_inner())
        .await
        .unwrap();
    let latest_source = repo.get(&source.id).await.unwrap().conversation;
    let mut replace = fork_input(&latest_source, &messages[0], "replacement");
    replace.stage_ids.push(replacement.stage_id);
    let (replaced, _) = repo.fork_edit_begin(&replace, "owner-c").await.unwrap();
    let replaced_detail = repo.get(&replaced.child_conversation_id).await.unwrap();
    assert_ne!(replaced_detail.messages[0].assets[0].asset_id, asset);
    assert_eq!(replaced_detail.messages[0].assets[0].width, 3);
}

#[tokio::test]
async fn chat_fork_edit_rejects_running_unsettled_non_user_and_rolls_back() {
    let (_dir, repo, source, messages) = seeded().await;
    sqlx::query("UPDATE chat_conversations SET request_id=?,owner='x',lease_until=? WHERE id=?")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(now() + 30_000)
        .bind(&source.id)
        .execute(&repo.pool)
        .await
        .unwrap();
    let input = fork_input(&source, &messages[0], "busy");
    assert_eq!(
        repo.fork_edit_begin(&input, "owner").await.unwrap_err(),
        "chat_conflict"
    );
    sqlx::query(
        "UPDATE chat_conversations SET request_id=NULL,owner=NULL,lease_until=NULL WHERE id=?",
    )
    .bind(&source.id)
    .execute(&repo.pool)
    .await
    .unwrap();
    let assistant = fork_input(&source, &messages[1], "wrong role");
    assert_eq!(
        repo.fork_edit_begin(&assistant, "owner").await.unwrap_err(),
        "chat_invalid_input"
    );
    sqlx::query("UPDATE chat_messages SET status='failed' WHERE id=?")
        .bind(&messages[1].id)
        .execute(&repo.pool)
        .await
        .unwrap();
    let unsettled = fork_input(&source, &messages[2], "unsettled");
    assert_eq!(
        repo.fork_edit_begin(&unsettled, "owner").await.unwrap_err(),
        "chat_conflict"
    );
    assert_eq!(
        repo.list(ListInput {
            search: String::new(),
            offset: 0
        })
        .await
        .unwrap()
        .len(),
        1
    );
    let branches: i64 = sqlx::query("SELECT count(*) AS n FROM chat_conversation_branches")
        .fetch_one(&repo.pool)
        .await
        .unwrap()
        .try_get("n")
        .unwrap();
    assert_eq!(branches, 0);
}
