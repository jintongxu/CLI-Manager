use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub protocol: String,
    pub enabled: bool,
    pub is_default: bool,
    pub models: Vec<ChatModel>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatModel {
    pub model_id: String,
    pub enabled: bool,
    pub is_default: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatProviderInput {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub protocol: String,
    pub api_key: Option<String>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatModelInput {
    pub provider_id: String,
    pub model_id: String,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatProviderProbeInput {
    pub base_url: String,
    pub protocol: String,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    #[serde(default)]
    data: Vec<OpenAiModelItem>,
}

#[derive(Deserialize)]
struct OpenAiModelItem {
    id: String,
}
async fn pool() -> Result<SqlitePool, String> {
    // Reuse the chat repository pool so catalog reads/writes never open a second
    // SQLite connection set against the same file.
    super::repository::shared_pool()
        .await
        .map_err(|_| String::from("chat_provider_storage"))
}
fn valid_protocol(p: &str) -> bool {
    matches!(p, "openai_chat" | "openai_responses" | "anthropic_messages")
}
fn valid_url(s: &str) -> bool {
    // http is accepted for any host: self-hosted gateways and LAN endpoints are a
    // supported deployment shape. Credentials and query/fragment parts stay
    // rejected because they would leak the key through URL logging.
    url::Url::parse(s).ok().is_some_and(|u| {
        (u.scheme() == "https" || u.scheme() == "http")
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
    })
}
async fn load(p: &SqlitePool, id: &str) -> Result<ChatProvider, String> {
    let r = sqlx::query(
        "SELECT id,name,base_url,protocol,enabled,is_default FROM chat_providers WHERE id=?",
    )
    .bind(id)
    .fetch_one(p)
    .await
    .map_err(|_| "chat_provider_not_found".to_string())?;
    let rows=sqlx::query("SELECT model_id,enabled,is_default FROM chat_provider_models WHERE provider_id=? ORDER BY model_id").bind(id).fetch_all(p).await.map_err(|_|"chat_provider_storage".to_string())?;
    Ok(ChatProvider {
        id: r.get("id"),
        name: r.get("name"),
        base_url: r.get("base_url"),
        protocol: r.get("protocol"),
        enabled: r.get::<i64, _>("enabled") != 0,
        is_default: r.get::<i64, _>("is_default") != 0,
        models: rows
            .into_iter()
            .map(|x| ChatModel {
                model_id: x.get("model_id"),
                enabled: x.get::<i64, _>("enabled") != 0,
                is_default: x.get::<i64, _>("is_default") != 0,
            })
            .collect(),
    })
}
pub async fn list() -> Result<Vec<ChatProvider>, String> {
    let p = pool().await?;
    let ids = sqlx::query_scalar::<_, String>("SELECT id FROM chat_providers ORDER BY name,id")
        .fetch_all(&p)
        .await
        .map_err(|_| String::from("chat_provider_storage"))?;
    let mut out = Vec::new();
    for id in ids {
        out.push(load(&p, &id).await?);
    }
    Ok(out)
}
pub async fn upsert(i: ChatProviderInput) -> Result<ChatProvider, String> {
    if i.id.trim().is_empty()
        || i.name.trim().is_empty()
        || !valid_protocol(&i.protocol)
        || !valid_url(&i.base_url)
    {
        return Err("chat_provider_invalid".into());
    }
    let p = pool().await?;
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO chat_providers(id,name,base_url,protocol,enabled,is_default,created_at,updated_at) \
         VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET \
         name=excluded.name,base_url=excluded.base_url,protocol=excluded.protocol,\
         enabled=excluded.enabled,is_default=excluded.is_default,updated_at=excluded.updated_at",
    )
    .bind(&i.id).bind(&i.name).bind(&i.base_url).bind(&i.protocol)
    .bind(i.enabled.unwrap_or(true) as i64).bind(i.is_default.unwrap_or(false) as i64)
    .bind(now).bind(now).execute(&p).await
    .map_err(|_| String::from("chat_provider_storage"))?;
    if let Some(key) = i.api_key.filter(|x| !x.trim().is_empty()) {
        sqlx::query("INSERT INTO chat_provider_secrets(provider_id,api_key) VALUES(?,?) ON CONFLICT(provider_id) DO UPDATE SET api_key=excluded.api_key").bind(&i.id).bind(key).execute(&p).await.map_err(|_| String::from("chat_provider_storage"))?;
    }
    load(&p, &i.id).await
}
pub async fn delete(id: String) -> Result<(), String> {
    let p = pool().await?;
    sqlx::query("DELETE FROM chat_providers WHERE id=?")
        .bind(id)
        .execute(&p)
        .await
        .map_err(|_| String::from("chat_provider_storage"))
        .map(|_| ())
}
pub async fn model(i: ChatModelInput) -> Result<ChatProvider, String> {
    if i.provider_id.is_empty() || i.model_id.trim().is_empty() {
        return Err("chat_model_invalid".into());
    }
    let p = pool().await?;
    sqlx::query("INSERT INTO chat_provider_models(provider_id,model_id,enabled,is_default) VALUES(?,?,?,?) ON CONFLICT(provider_id,model_id) DO UPDATE SET enabled=excluded.enabled,is_default=excluded.is_default").bind(&i.provider_id).bind(&i.model_id).bind(i.enabled.unwrap_or(true) as i64).bind(i.is_default.unwrap_or(false) as i64).execute(&p).await.map_err(|_| String::from("chat_provider_storage"))?;
    load(&p, &i.provider_id).await
}
pub async fn test_connection(id: String) -> Result<String, String> {
    let p = pool().await?;
    let r = sqlx::query("SELECT base_url,protocol FROM chat_providers WHERE id=?")
        .bind(&id)
        .fetch_one(&p)
        .await
        .map_err(|_| String::from("chat_provider_not_found"))?;
    let url: String = r.get("base_url");
    if !valid_url(&url) {
        return Err(String::from("chat_provider_invalid"));
    }
    let protocol: String = r.get("protocol");
    if !valid_protocol(&protocol) {
        return Err(String::from("chat_provider_invalid"));
    }
    let key: Option<String> = sqlx::query_scalar("SELECT api_key FROM chat_provider_secrets WHERE provider_id=?")
        .bind(&id)
        .fetch_optional(&p)
        .await
        .unwrap_or(None);
    probe_endpoint(&url, &protocol, key.as_deref()).await
}

pub async fn test_probe(input: ChatProviderProbeInput) -> Result<String, String> {
    if !valid_url(&input.base_url) || !valid_protocol(&input.protocol) {
        return Err(String::from("chat_provider_invalid"));
    }
    probe_endpoint(&input.base_url, &input.protocol, input.api_key.as_deref()).await
}

async fn probe_endpoint(base_url: &str, protocol: &str, api_key: Option<&str>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let trimmed = base_url.trim_end_matches('/');
    let target = match protocol {
        "anthropic_messages" => format!("{trimmed}/v1/models"),
        _ => format!("{trimmed}/models"),
    };

    let mut req = client.get(&target);
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        if protocol == "anthropic_messages" {
            req = req.header("x-api-key", key.trim()).header("anthropic-version", "2023-06-01");
        } else {
            req = req.header("authorization", format!("Bearer {}", key.trim()));
        }
    }

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                Ok("connected".into())
            } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                Err("chat_provider_auth_failed".into())
            } else if status == reqwest::StatusCode::NOT_FOUND {
                // If /models returns 404, fallback to base url check or accept if reachable
                Ok("connected".into())
            } else {
                Err(format!("chat_provider_http_error: {}", status.as_u16()))
            }
        }
        Err(err) => Err(format!("chat_provider_network_error: {err}")),
    }
}

pub async fn fetch_remote_models(
    id: Option<String>,
    probe: Option<ChatProviderProbeInput>,
) -> Result<Vec<String>, String> {
    let (url, protocol, key) = if let Some(p) = probe {
        (p.base_url, p.protocol, p.api_key)
    } else if let Some(provider_id) = id {
        let p = pool().await?;
        let r = sqlx::query("SELECT base_url,protocol FROM chat_providers WHERE id=?")
            .bind(&provider_id)
            .fetch_one(&p)
            .await
            .map_err(|_| String::from("chat_provider_not_found"))?;
        let key: Option<String> = sqlx::query_scalar("SELECT api_key FROM chat_provider_secrets WHERE provider_id=?")
            .bind(&provider_id)
            .fetch_optional(&p)
            .await
            .unwrap_or(None);
        (r.get("base_url"), r.get("protocol"), key)
    } else {
        return Err("chat_provider_invalid".into());
    };

    if !valid_url(&url) || !valid_protocol(&protocol) {
        return Err("chat_provider_invalid".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let trimmed = url.trim_end_matches('/');
    let target = match protocol.as_str() {
        "anthropic_messages" => format!("{trimmed}/v1/models"),
        _ => format!("{trimmed}/models"),
    };

    let mut req = client.get(&target);
    if let Some(ref k) = key.filter(|k| !k.trim().is_empty()) {
        if protocol == "anthropic_messages" {
            req = req.header("x-api-key", k.trim()).header("anthropic-version", "2023-06-01");
        } else {
            req = req.header("authorization", format!("Bearer {}", k.trim()));
        }
    }

    let resp = req.send().await.map_err(|e| format!("chat_provider_network_error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("chat_provider_http_error: {}", resp.status().as_u16()));
    }

    let parsed: OpenAiModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("chat_provider_parse_error: {e}"))?;

    let mut ids: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

pub async fn batch_sync_models(
    provider_id: String,
    models: Vec<ChatModelInput>,
) -> Result<ChatProvider, String> {
    let p = pool().await?;
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM chat_providers WHERE id=?")
        .bind(&provider_id)
        .fetch_optional(&p)
        .await
        .map_err(|_| String::from("chat_provider_storage"))?;
    if exists.is_none() {
        return Err(String::from("chat_provider_not_found"));
    }

    let mut tx = p.begin().await.map_err(|_| String::from("chat_provider_storage"))?;
    sqlx::query("DELETE FROM chat_provider_models WHERE provider_id=?")
        .bind(&provider_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| String::from("chat_provider_storage"))?;

    for m in models {
        if m.model_id.trim().is_empty() {
            continue;
        }
        sqlx::query(
            "INSERT INTO chat_provider_models(provider_id,model_id,enabled,is_default) VALUES(?,?,?,?) \
             ON CONFLICT(provider_id, model_id) DO UPDATE SET enabled=excluded.enabled",
        )
        .bind(&provider_id)
        .bind(m.model_id.trim())
        .bind(m.enabled.unwrap_or(true) as i64)
        .bind(m.is_default.unwrap_or(false) as i64)
        .execute(&mut *tx)
        .await
        .map_err(|_| String::from("chat_provider_storage"))?;
    }
    tx.commit().await.map_err(|_| String::from("chat_provider_storage"))?;

    load(&p, &provider_id).await
}
pub async fn delete_model(provider_id: String, model_id: String) -> Result<(), String> {
    let p = pool().await?;
    sqlx::query("DELETE FROM chat_provider_models WHERE provider_id=? AND model_id=?")
        .bind(provider_id)
        .bind(model_id)
        .execute(&p)
        .await
        .map_err(|_| String::from("chat_provider_storage"))
        .map(|_| ())
}

#[cfg(test)]
mod url_tests {
    use super::valid_url;

    #[test]
    fn https_endpoints_are_valid() {
        assert!(valid_url("https://api.openai.com/v1"));
        assert!(valid_url("https://159.138.99.104:8080/v1"));
    }

    #[test]
    fn http_endpoints_are_valid_on_any_host() {
        assert!(valid_url("http://localhost:8080/v1"));
        assert!(valid_url("http://127.0.0.1:11434/v1"));
        assert!(valid_url("http://159.138.99.104:8080/v1"));
    }

    #[test]
    fn unsupported_schemes_and_url_parts_are_rejected() {
        assert!(!valid_url("ftp://api.example.com"));
        assert!(!valid_url("api.example.com/v1"));
        assert!(!valid_url(""));
        assert!(!valid_url("https://user:pw@api.example.com/v1"));
        assert!(!valid_url("https://api.example.com/v1?token=secret"));
        assert!(!valid_url("https://api.example.com/v1#frag"));
        assert!(!valid_url("https://"));
    }
}
