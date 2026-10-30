//! Chat-only, internal secret-bearing resolution. Never serialize Runtime or upstream errors.
use super::{grok, network_client, open_connection, repository};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Connection, Row};
use std::time::Duration;
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Protocol {
    Messages,
    Chat,
    Responses,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderOption {
    pub app_type: String,
    pub provider_id: String,
    pub name: String,
    pub default_model: Option<String>,
    pub protocol: Option<Protocol>,
    pub available: bool,
    pub reason: Option<String>,
}
pub(crate) struct Runtime {
    pub protocol: Protocol,
    pub endpoint: String,
    pub key: String,
    pub model: Option<String>,
}
fn error(code: &str) -> String {
    format!("chat_{code}")
}
pub(crate) fn endpoint(base: &str, protocol: Protocol) -> Result<String, String> {
    endpoint_mode(base, protocol, false)
}
fn endpoint_mode(base: &str, protocol: Protocol, full_url: bool) -> Result<String, String> {
    let mut url = url::Url::parse(base.trim()).map_err(|_| error("provider_url"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err(error("provider_url"));
    }
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(error("provider_url"));
    }
    let path = url.path().trim_end_matches('/');
    let expected = match protocol {
        Protocol::Messages => "messages",
        Protocol::Chat => "chat/completions",
        Protocol::Responses => "responses",
    };
    for other in ["messages", "chat/completions", "responses"] {
        if other != expected && path.ends_with(&format!("/{other}")) {
            return Err(error("provider_protocol"));
        }
    }
    if full_url {
        return Ok(url.into());
    }
    let path = if path.ends_with(&format!("/{expected}")) {
        path.to_string()
    } else if path.ends_with("/v1") {
        format!("{path}/{expected}")
    } else {
        format!("{path}/v1/{expected}")
    };
    url.set_path(&path);
    Ok(url.into())
}
pub(crate) fn parse(app: &str, _id: &str, settings: &str, key: &str) -> Result<Runtime, String> {
    parse_mode(app, _id, settings, key, false)
}
fn parse_mode(
    app: &str,
    _id: &str,
    settings: &str,
    key: &str,
    full_url: bool,
) -> Result<Runtime, String> {
    if key.trim().is_empty() {
        return Err(error("provider_key"));
    }
    let v: Value = serde_json::from_str(settings).map_err(|_| error("provider_config"))?;
    let (base, model, protocol) = match app {
        "claude" => {
            // Missing format is the native default; explicit formats never fall back.
            let env = v.get("env").unwrap_or(&Value::Null);
            let base = env
                .get("ANTHROPIC_BASE_URL")
                .or_else(|| v.get("base_url"))
                .and_then(Value::as_str)
                .unwrap_or("https://api.anthropic.com")
                .to_string();
            let model = env
                .get("ANTHROPIC_MODEL")
                .or_else(|| v.get("model"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let protocol = match v.get("api_format") {
                None => Protocol::Messages,
                Some(Value::String(format)) => match format.as_str() {
                    "anthropic" => Protocol::Messages,
                    "openai_chat" => Protocol::Chat,
                    "openai_responses" => Protocol::Responses,
                    _ => return Err(error("provider_protocol")),
                },
                _ => return Err(error("provider_protocol")),
            };
            (base, model, protocol)
        }
        "codex" => {
            // Read only the explicitly selected native profile: never scan unrelated profiles.
            let document = v
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| error("provider_config"))?;
            let selected = document
                .get("model_provider")
                .and_then(toml_edit::Item::as_str);
            let profile =
                selected.and_then(|name| document.get("model_providers").and_then(|p| p.get(name)));
            let field = |key: &str| {
                profile
                    .and_then(|p| p.get(key))
                    .and_then(toml_edit::Item::as_str)
            };
            let wire = field("wire_api").or_else(|| v.get("wire_api").and_then(Value::as_str));
            let protocol = match wire {
                Some("responses") => Protocol::Responses,
                Some("chat") | Some("chat_completions") => Protocol::Chat,
                _ => return Err(error("provider_protocol")),
            };
            let base = field("base_url")
                .or_else(|| v.get("base_url").and_then(Value::as_str))
                .or_else(|| {
                    v.get("env")
                        .and_then(|e| e.get("OPENAI_BASE_URL"))
                        .and_then(Value::as_str)
                })
                .ok_or_else(|| error("provider_config"))?
                .to_string();
            let model = document
                .get("model")
                .and_then(toml_edit::Item::as_str)
                .or_else(|| v.get("model").and_then(Value::as_str))
                .map(str::to_string);
            (base, model, protocol)
        }
        "grok" | "grokbuild" => {
            let (base, model, format) = grok::summary(settings);
            let protocol = match format.as_deref() {
                Some("responses") => Protocol::Responses,
                Some("chat") | Some("chat_completions") => Protocol::Chat,
                _ => return Err(error("provider_protocol")),
            };
            (
                base.ok_or_else(|| error("provider_config"))?,
                model,
                protocol,
            )
        }
        _ => return Err(error("provider_protocol")),
    };
    Ok(Runtime {
        endpoint: endpoint_mode(&base, protocol, full_url)?,
        protocol,
        key: key.to_string(),
        model,
    })
}
async fn resolve_chat_catalog(
    connection: &mut sqlx::SqliteConnection,
    id: &str,
) -> Result<Runtime, String> {
    let r = sqlx::query("SELECT base_url,protocol FROM chat_providers WHERE id=? AND enabled=1")
        .bind(id)
        .fetch_optional(&mut *connection)
        .await
        .map_err(|_| error("provider_storage"))?
        .ok_or_else(|| error("provider_missing"))?;
    let key = sqlx::query_scalar::<_, String>(
        "SELECT api_key FROM chat_provider_secrets WHERE provider_id=?",
    )
    .bind(id)
    .fetch_optional(&mut *connection)
    .await
    .map_err(|_| error("provider_storage"))?
    .ok_or_else(|| error("provider_key"))?;
    let protocol = match r.get::<String, _>("protocol").as_str() {
        "openai_chat" => Protocol::Chat,
        "openai_responses" => Protocol::Responses,
        "anthropic_messages" => Protocol::Messages,
        _ => return Err(error("provider_protocol")),
    };
    Ok(Runtime {
        endpoint: endpoint(&r.get::<String, _>("base_url"), protocol)?,
        protocol,
        key,
        model: None,
    })
}
async fn resolve_with(
    connection: &mut sqlx::SqliteConnection,
    app: &str,
    id: &str,
) -> Result<Runtime, String> {
    if app == "chat" {
        return resolve_chat_catalog(connection, id).await;
    }
    let app = if app == "grok" { "grokbuild" } else { app };
    let r = sqlx::query("SELECT settings_config,meta FROM providers WHERE app_type=? AND id=?")
        .bind(app)
        .bind(id)
        .fetch_optional(&mut *connection)
        .await
        .map_err(|_| error("provider_storage"))?
        .ok_or_else(|| error("provider_missing"))?;
    let meta = repository::parse_meta(&r.get::<String, _>("meta"));
    if !repository::meta_enabled(&meta) {
        return Err(error("provider_disabled"));
    }
    let key=sqlx::query_scalar::<_,String>("SELECT api_key FROM provider_api_keys WHERE app_type=? AND provider_id=? AND is_active=1 AND enabled=1")
  .bind(app).bind(id).fetch_optional(&mut *connection).await.map_err(|_|error("provider_storage"))?.ok_or_else(||error("provider_key"))?;
    let mut settings = r.get::<String, _>("settings_config");
    if repository::meta_common_config_enabled(&meta) {
        let common = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key=?")
            .bind(format!("common_config_{app}"))
            .fetch_optional(&mut *connection)
            .await
            .map_err(|_| error("provider_storage"))?
            .unwrap_or_default();
        settings = repository::merge_common_into_settings(app, &common, &settings)
            .map_err(|_| error("provider_config"))?;
    }
    parse_mode(
        app,
        id,
        &settings,
        &key,
        app == "claude" && meta.get("claudeIsFullUrl").and_then(Value::as_bool) == Some(true),
    )
}
pub(crate) async fn resolve(app: &str, id: &str) -> Result<Runtime, String> {
    if app == "chat" {
        let path = crate::app_paths::db_path().map_err(|_| error("provider_storage"))?;
        let mut c = sqlx::SqliteConnection::connect(&format!("sqlite://{}", path.to_string_lossy()))
            .await
            .map_err(|_| error("provider_storage"))?;
        return resolve_chat_catalog(&mut c, id).await;
    }
    let mut c = open_connection()
        .await
        .map_err(|_| error("provider_storage"))?;
    resolve_with(&mut c, app, id).await
}
pub(crate) async fn options() -> Result<Vec<ProviderOption>, String> {
    let mut c = open_connection()
        .await
        .map_err(|_| error("provider_storage"))?;
    let rows = sqlx::query("SELECT id,app_type,name FROM providers ORDER BY sort_index,name,id")
        .fetch_all(&mut c)
        .await
        .map_err(|_| error("provider_storage"))?;
    let mut out = Vec::new();
    for r in rows {
        let app: String = r.get("app_type");
        let id: String = r.get("id");
        let runtime = resolve_with(&mut c, &app, &id).await;
        let (protocol, default_model, reason) = match runtime {
            Ok(r) => (Some(r.protocol), r.model, None),
            Err(e) => (None, None, Some(e)),
        };
        out.push(ProviderOption {
            app_type: if app == "grokbuild" {
                "grok".into()
            } else {
                app
            },
            provider_id: id,
            name: r.get("name"),
            default_model,
            protocol,
            available: reason.is_none(),
            reason,
        });
    }
    // Independent chat catalog lives in the main DB and is deliberately separate from Native Providers.
    if let Ok(path) = crate::app_paths::db_path() {
        if let Ok(mut main) =
            sqlx::SqliteConnection::connect(&format!("sqlite://{}", path.to_string_lossy())).await
        {
            let rows = sqlx::query(
                "SELECT id,name,protocol FROM chat_providers WHERE enabled=1 ORDER BY name,id",
            )
            .fetch_all(&mut main)
            .await
            .unwrap_or_default();
            for r in rows {
                let protocol = match r.get::<String, _>("protocol").as_str() {
                    "openai_chat" => Protocol::Chat,
                    "openai_responses" => Protocol::Responses,
                    "anthropic_messages" => Protocol::Messages,
                    _ => continue,
                };
                let id: String = r.get("id");
                let has_key = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM chat_provider_secrets WHERE provider_id=?",
                )
                .bind(&id)
                .fetch_one(&mut main)
                .await
                .unwrap_or(0)
                    > 0;
                let default_model = sqlx::query_scalar::<_, String>(
                    "SELECT model_id FROM chat_provider_models WHERE provider_id=? AND enabled=1 ORDER BY is_default DESC, model_id LIMIT 1",
                )
                .bind(&id)
                .fetch_optional(&mut main)
                .await
                .unwrap_or(None);
                out.push(ProviderOption {
                    app_type: "chat".into(),
                    provider_id: id,
                    name: r.get("name"),
                    default_model,
                    protocol: Some(protocol),
                    available: has_key,
                    reason: (!has_key).then_some(error("provider_key")),
                });
            }
        }
    }
    Ok(out)
}
pub(crate) async fn client() -> Result<reqwest::Client, String> {
    network_client::current_client_from_persisted()
        .await
        .map_err(|_| error("network"))?;
    network_client::configure_builder(
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15)),
    )
    .map_err(|_| error("network"))?
    .build()
    .map_err(|_| error("network"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_security_and_full_endpoints() {
        for bad in [
            "https://user:secret@example.com",
            "https://example.com?key=x",
            "https://example.com#x",
            "file:///x",
        ] {
            assert_eq!(
                endpoint(bad, Protocol::Chat).unwrap_err(),
                "chat_provider_url"
            );
        }
        // http is accepted on any host: self-hosted and LAN gateways are supported.
        assert_eq!(
            endpoint("http://127.0.0.1:1234/v1", Protocol::Chat).unwrap(),
            "http://127.0.0.1:1234/v1/chat/completions"
        );
        assert_eq!(
            endpoint("http://example.com", Protocol::Chat).unwrap(),
            "http://example.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("http://159.138.99.104:8080/v1", Protocol::Chat).unwrap(),
            "http://159.138.99.104:8080/v1/chat/completions"
        );
        assert_eq!(
            endpoint("http://159.138.99.104:8080/v1", Protocol::Responses).unwrap(),
            "http://159.138.99.104:8080/v1/responses"
        );
        assert_eq!(
            endpoint(
                "https://example.com/custom/v1/responses",
                Protocol::Responses
            )
            .unwrap(),
            "https://example.com/custom/v1/responses"
        );
        assert!(endpoint("https://example.com/v1/messages", Protocol::Chat).is_err());
    }
    #[test]
    fn protocols_and_active_key_only() {
        let claude = parse(
            "claude",
            "x",
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://example.com"}}"#,
            "synthetic",
        )
        .unwrap();
        assert_eq!(claude.protocol, Protocol::Messages);
        assert!(parse("claude", "x", "{}", "").is_err());
        assert!(parse(
            "grok",
            "x",
            r#"{"base_url":"https://example.com","api_format":"unknown"}"#,
            "test"
        )
        .is_err());
        for (format, protocol) in [
            ("responses", Protocol::Responses),
            ("chat_completions", Protocol::Chat),
        ] {
            let raw = serde_json::json!({"base_url":"https://example.com","api_format":format})
                .to_string();
            assert_eq!(parse("grok", "x", &raw, "test").unwrap().protocol, protocol);
        }
        let dto = ProviderOption {
            app_type: "claude".into(),
            provider_id: "x".into(),
            name: "Test".into(),
            default_model: None,
            protocol: Some(Protocol::Messages),
            available: true,
            reason: None,
        };
        let v = serde_json::to_value(dto).unwrap();
        assert_eq!(v.as_object().unwrap().len(), 7);
        assert!(!v.to_string().contains("synthetic"));
    }
    #[tokio::test]
    async fn claude_explicit_protocol_and_full_url_metadata_resolution() {
        use sqlx::Connection;
        let mut c = sqlx::SqliteConnection::connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE settings(key TEXT,value TEXT); CREATE TABLE providers(id TEXT,app_type TEXT,settings_config TEXT,meta TEXT); CREATE TABLE provider_api_keys(app_type TEXT,provider_id TEXT,api_key TEXT,is_active INTEGER,enabled INTEGER);")
            .execute(&mut c).await.unwrap();
        sqlx::query("INSERT INTO settings VALUES('common_config_claude','{}')")
            .execute(&mut c)
            .await
            .unwrap();
        sqlx::query("INSERT INTO provider_api_keys VALUES('claude','test','synthetic',1,1)")
            .execute(&mut c)
            .await
            .unwrap();
        for (format, protocol, suffix) in [
            ("anthropic", Protocol::Messages, "messages"),
            ("openai_chat", Protocol::Chat, "chat/completions"),
            ("openai_responses", Protocol::Responses, "responses"),
        ] {
            let settings = serde_json::json!({"api_format":format,"env":{"ANTHROPIC_BASE_URL":"https://example.com"}}).to_string();
            sqlx::query("DELETE FROM providers")
                .execute(&mut c)
                .await
                .unwrap();
            sqlx::query("INSERT INTO providers VALUES('test','claude',?, '{}')")
                .bind(&settings)
                .execute(&mut c)
                .await
                .unwrap();
            let runtime = resolve_with(&mut c, "claude", "test").await.unwrap();
            assert_eq!(runtime.protocol, protocol);
            assert_eq!(runtime.endpoint, format!("https://example.com/v1/{suffix}"));
            let custom = settings.replace(
                "https://example.com",
                "https://example.com/custom-inference",
            );
            sqlx::query("UPDATE providers SET settings_config=?,meta=?")
                .bind(custom)
                .bind(r#"{"claudeIsFullUrl":true}"#)
                .execute(&mut c)
                .await
                .unwrap();
            assert_eq!(
                resolve_with(&mut c, "claude", "test")
                    .await
                    .unwrap()
                    .endpoint,
                "https://example.com/custom-inference"
            );
        }
        for format in ["gemini_native", "unknown"] {
            sqlx::query("UPDATE providers SET settings_config=?")
                .bind(serde_json::json!({"api_format":format}).to_string())
                .execute(&mut c)
                .await
                .unwrap();
            assert_eq!(
                resolve_with(&mut c, "claude", "test").await.err().unwrap(),
                "chat_provider_protocol"
            );
        }
        assert!(
            endpoint_mode("http://external.example/custom", Protocol::Messages, true).is_ok()
        );
        assert_eq!(
            endpoint_mode("https://example.com/v1/responses", Protocol::Messages, true)
                .unwrap_err(),
            "chat_provider_protocol"
        );
    }
    #[test]
    fn codex_selected_profile_and_active_key_projection() {
        let settings = serde_json::json!({"config":"model_provider = \"selected\"
model = \"mock-model\"
[model_providers.selected]
base_url = \"https://example.com/v1\"
wire_api = \"responses\"
env_key = \"OLD_KEY\"
","env":{"OLD_KEY":"stale-do-not-use"}})
        .to_string();
        let runtime = parse("codex", "mock", &settings, "active-synthetic").unwrap();
        assert_eq!(runtime.key, "active-synthetic");
        assert_eq!(runtime.protocol, Protocol::Responses);
        assert_eq!(runtime.endpoint, "https://example.com/v1/responses");
        assert_eq!(runtime.model.as_deref(), Some("mock-model"));
    }
}
