use serde::{Deserialize, Serialize};
pub type Result<T> = std::result::Result<T, String>;
pub fn invalid() -> String {
    "chat_invalid_input".into()
}
pub fn storage(_: sqlx::Error) -> String {
    "chat_storage".into()
}
pub fn uuid(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| invalid())
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub draft: String,
    pub app_type: String,
    pub provider_id: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub revision: i64,
    pub request_id: Option<String>,
    pub lease_until: Option<i64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub ordinal: i64,
    pub role: String,
    pub content: String,
    pub reply_to: Option<String>,
    pub request_id: String,
    pub status: String,
    pub error_code: Option<String>,
    pub finish_reason: Option<String>,
    pub app_type: String,
    pub provider_id: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListInput {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub offset: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateInput {
    pub title: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInput {
    pub conversation_id: String,
    pub revision: i64,
    pub title: Option<String>,
    pub draft: Option<String>,
    pub app_type: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub conversation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteInput {
    pub conversation_id: String,
    pub revision: i64,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateInput {
    pub conversation_id: String,
    pub revision: i64,
    pub request_id: String,
    pub app_type: String,
    pub provider_id: String,
    pub model: String,
    pub text: Option<String>,
    #[serde(default)]
    pub retry: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelInput {
    pub conversation_id: String,
    pub request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlushInput {
    pub drafts: Vec<UpdateInput>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub conversation_id: String,
    pub message_id: String,
    pub request_id: String,
    pub sequence: u64,
    pub content: String,
    pub status: String,
    pub error_code: Option<String>,
    pub finish_reason: Option<String>,
    pub saved: bool,
}
