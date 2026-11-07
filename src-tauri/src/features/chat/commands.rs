//! Main-window-only IPC. All payloads deny unknown fields; no paths/config/tools accepted.
use super::provider_catalog::{ChatModelInput, ChatProvider, ChatProviderInput};
use super::{repository::Repository, runtime, types::*};
use crate::provider::chat_runtime::{self, ProviderOption};
use serde::Serialize;
use tauri::{
    ipc::{Channel, InvokeBody, Request, Response},
    WebviewWindow,
};
fn authorize(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("main_window_required".into())
    }
}
fn authorize_asset(window: &WebviewWindow) -> Result<String> {
    super::assets::owner_for_label(window.label())
}
fn parse_release_ids(value: serde_json::Value) -> Result<Vec<String>> {
    match value {
        serde_json::Value::Array(values) => values
            .into_iter()
            .map(|value| value.as_str().map(str::to_owned).ok_or_else(invalid))
            .collect(),
        serde_json::Value::Object(mut object) if object.len() == 1 => object
            .remove("stageIds")
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or_else(invalid),
        _ => Err(invalid()),
    }
}
fn release_ids(request: &Request<'_>) -> Result<Vec<String>> {
    let value = match request.body() {
        InvokeBody::Json(value) => value.clone(),
        InvokeBody::Raw(bytes) => {
            if bytes.len() > 2048 {
                return Err(invalid());
            }
            serde_json::from_slice(bytes).map_err(|_| invalid())?
        }
    };
    parse_release_ids(value)
}
async fn repository() -> Result<Repository> {
    Repository::shared().await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Initialized {
    conversations: Vec<Conversation>,
    unsaved: Vec<Event>,
}
#[tauri::command]
pub async fn chat_initialize(window: WebviewWindow) -> Result<Initialized> {
    authorize(&window)?;
    let repo = repository().await?;
    repo.recover().await?;
    super::assets::reconcile(&repo.pool).await?;
    Ok(Initialized {
        conversations: repo
            .list(ListInput {
                search: String::new(),
                offset: 0,
            })
            .await?,
        unsaved: runtime::shared().unsaved().await,
    })
}
#[tauri::command]
pub async fn chat_asset_stage(
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<super::assets::StagedAsset> {
    let owner = authorize_asset(&window)?;
    let bytes = super::ipc_bytes::request_bytes(&request)?.to_vec();
    super::assets::stage(owner, &bytes).await
}
#[tauri::command]
pub async fn chat_asset_release(window: WebviewWindow, request: Request<'_>) -> Result<()> {
    let owner = authorize_asset(&window)?;
    super::assets::release(&owner, &release_ids(&request)?).await
}
#[tauri::command]
pub async fn chat_asset_read(
    window: WebviewWindow,
    conversation_id: String,
    message_id: String,
    ordinal: i64,
    asset_id: String,
) -> Result<Response> {
    authorize_asset(&window)?;
    let required_origin = (window.label() == "quick-chat").then_some("quick-chat");
    let repo = repository().await?;
    let bytes = super::assets::read_exact(
        &repo.pool,
        &conversation_id,
        &message_id,
        ordinal,
        &asset_id,
        required_origin,
    )
    .await?;
    Ok(super::ipc_bytes::response_bytes(bytes))
}
#[tauri::command]
pub async fn chat_list(window: WebviewWindow, input: ListInput) -> Result<Vec<Conversation>> {
    authorize(&window)?;
    repository().await?.list(input).await
}
#[tauri::command]
pub async fn chat_get(window: WebviewWindow, input: Identity) -> Result<Detail> {
    authorize(&window)?;
    repository().await?.get(&input.conversation_id).await
}
#[tauri::command]
pub async fn chat_create(window: WebviewWindow, input: CreateInput) -> Result<Detail> {
    authorize(&window)?;
    repository().await?.create(input).await
}
#[tauri::command]
pub async fn chat_update(window: WebviewWindow, input: UpdateInput) -> Result<Detail> {
    authorize(&window)?;
    repository().await?.update(input).await
}
#[tauri::command]
pub async fn chat_delete(window: WebviewWindow, input: DeleteInput) -> Result<()> {
    authorize(&window)?;
    let id = input.conversation_id.clone();
    repository().await?.delete(input).await?;
    runtime::shared().deleted(&id).await;
    Ok(())
}
#[tauri::command]
pub fn chat_provider_options(window: WebviewWindow) -> Result<Vec<ProviderOption>> {
    authorize(&window)?;
    tauri::async_runtime::block_on(chat_runtime::options())
}
#[tauri::command]
pub async fn chat_provider_catalog_list(window: WebviewWindow) -> Result<Vec<ChatProvider>> {
    authorize(&window)?;
    super::provider_catalog::list().await
}
#[tauri::command]
pub async fn chat_provider_catalog_upsert(
    window: WebviewWindow,
    input: ChatProviderInput,
) -> Result<ChatProvider> {
    authorize(&window)?;
    super::provider_catalog::upsert(input).await
}
#[tauri::command]
pub async fn chat_provider_catalog_delete(window: WebviewWindow, id: String) -> Result<()> {
    authorize(&window)?;
    super::provider_catalog::delete(id).await
}
#[tauri::command]
pub async fn chat_provider_model_upsert(
    window: WebviewWindow,
    input: ChatModelInput,
) -> Result<ChatProvider> {
    authorize(&window)?;
    super::provider_catalog::model(input).await
}
#[tauri::command]
pub async fn chat_provider_model_delete(
    window: WebviewWindow,
    provider_id: String,
    model_id: String,
) -> Result<()> {
    authorize(&window)?;
    super::provider_catalog::delete_model(provider_id, model_id).await
}
#[tauri::command]
pub async fn chat_provider_test(window: WebviewWindow, id: String) -> Result<String> {
    authorize(&window)?;
    super::provider_catalog::test_connection(id).await
}
#[tauri::command]
pub async fn chat_provider_test_probe(
    window: WebviewWindow,
    input: super::provider_catalog::ChatProviderProbeInput,
) -> Result<String> {
    authorize(&window)?;
    super::provider_catalog::test_probe(input).await
}
#[tauri::command]
pub async fn chat_provider_fetch_remote_models(
    window: WebviewWindow,
    id: Option<String>,
    probe: Option<super::provider_catalog::ChatProviderProbeInput>,
) -> Result<Vec<String>> {
    authorize(&window)?;
    super::provider_catalog::fetch_remote_models(id, probe).await
}
#[tauri::command]
pub async fn chat_provider_batch_sync_models(
    window: WebviewWindow,
    provider_id: String,
    models: Vec<super::provider_catalog::ChatModelInput>,
) -> Result<super::provider_catalog::ChatProvider> {
    authorize(&window)?;
    super::provider_catalog::batch_sync_models(provider_id, models).await
}
#[tauri::command]
pub fn chat_generate(
    window: WebviewWindow,
    input: GenerateInput,
    on_event: Channel<Event>,
) -> Result<Message> {
    authorize(&window)?;
    tauri::async_runtime::block_on(async {
        runtime::shared()
            .generate(repository().await?, input, on_event)
            .await
    })
}
#[tauri::command]
pub fn chat_fork_edit(
    window: WebviewWindow,
    input: ForkEditInput,
    on_event: Channel<Event>,
) -> Result<ForkEditReceipt> {
    authorize(&window)?;
    tauri::async_runtime::block_on(async {
        runtime::shared()
            .fork_edit(repository().await?, input, on_event)
            .await
    })
}
#[tauri::command]
pub async fn chat_cancel(window: WebviewWindow, input: CancelInput) -> Result<()> {
    authorize(&window)?;
    runtime::shared().cancel(input).await
}
#[tauri::command]
pub async fn chat_flush_drafts(
    window: WebviewWindow,
    input: FlushInput,
) -> Result<Vec<Conversation>> {
    authorize(&window)?;
    // This command remains admitted under the exit fence: accept drafts only,
    // never rename/provider/model mutations through the persistence exception.
    if input.drafts.iter().any(|d| {
        d.draft.is_none()
            || d.title.is_some()
            || d.app_type.is_some()
            || d.provider_id.is_some()
            || d.model.is_some()
    }) {
        return Err(invalid());
    }
    let repo = repository().await?;
    let ids: Vec<String> = input
        .drafts
        .iter()
        .map(|d| d.conversation_id.clone())
        .collect();
    runtime::shared().retry_unsaved(repo.clone()).await?;
    repo.flush(input.drafts).await?;
    let mut out = Vec::new();
    for id in ids {
        out.push(repo.get(&id).await?.conversation)
    }
    Ok(out)
}
/// Internal hooks used only by the existing exit coordinator authority.
pub(crate) async fn prepare() {
    runtime::shared().prepare().await;
}
pub(crate) async fn drain() -> Result<()> {
    runtime::shared().drain(repository().await?).await
}
pub(crate) async fn resume() {
    runtime::shared().resume().await;
}
pub(crate) async fn cleanup() {
    runtime::shared().shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::parse_release_ids;

    #[test]
    fn release_accepts_raw_list_or_transport_object_and_rejects_extra_fields() {
        assert_eq!(
            parse_release_ids(serde_json::json!(["a", "b"])).unwrap(),
            vec!["a", "b"]
        );
        assert_eq!(
            parse_release_ids(serde_json::json!({ "stageIds": ["a"] })).unwrap(),
            vec!["a"]
        );
        assert!(
            parse_release_ids(serde_json::json!({ "stageIds": ["a"], "unexpected": true }))
                .is_err()
        );
        assert!(parse_release_ids(serde_json::json!({ "ids": ["a"] })).is_err());
    }
}
