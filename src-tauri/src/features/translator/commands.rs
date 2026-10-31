//! Translator module powered by user-configured chat models.
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tauri::WebviewWindow;

/// 默认翻译提示词模板（业内顶尖标准：专业原生级母语翻译、保留 Markdown 结构与代码公式、信达雅无注释输出）
pub const DEFAULT_TRANSLATION_TEMPLATE: &str =
    "You are a professional, native-level translator. Translate the text below into {lang}.\n\n\
     Requirements:\n\
     1. Accuracy & Fluency: Convey the original meaning faithfully without omitting, exaggerating, or explaining. The translation must sound natural, idiomatic, and culturally appropriate to native speakers.\n\
     2. Structure & Formatting: Preserve all original formatting, paragraph breaks, bullet points, numbered lists, URLs, code blocks, and LaTeX formulas ($...$ or $$...$$).\n\
     3. Untranslatable Tokens: Keep proper nouns, brand names, technical identifiers, variables, and code syntax unchanged.\n\
     4. Output Constraints: Output ONLY the translated text. Do NOT wrap in quotes, do NOT include headings, and do NOT add any preamble, conversational filler, or explanatory notes.\n\n\
     <source_text>\n{text}\n</source_text>";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatorModelOption {
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub is_default: bool,
}

pub(super) struct ProviderSecretAndConfig {
    pub provider_id: String,
    pub provider_name: String,
    pub base_url: String,
    pub protocol: String,
    pub model_id: String,
    pub api_key: Option<String>,
}

pub(super) async fn get_pool() -> Result<SqlitePool, String> {
    crate::chat::repository::shared_pool().await.map_err(|_| "translator_storage".to_string())
}

/// 与 chat 命令一致：翻译浮窗只接受主窗口调用，不向其它 WebView 开放。
fn authorize(window: &WebviewWindow) -> Result<(), String> {
    match window.label() {
        "main" | "translator" | "translator-capture" => Ok(()),
        _ => Err("main_window_required".into()),
    }
}

/// 识别文本中是否包含中文字符
pub fn has_chinese(text: &str) -> bool {
    text.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

/// 自动根据内容判断翻译的目标语言
pub fn resolve_target_lang(target: &str, text: &str) -> String {
    if target.is_empty() || target == "auto" {
        if has_chinese(text) {
            "en".to_string()
        } else {
            "zh".to_string()
        }
    } else {
        target.to_string()
    }
}

/// 语言代码映射为全名
pub fn language_name(code: &str) -> &'static str {
    match code {
        "zh" | "zh-Hans" => "Simplified Chinese",
        "zh-Hant" => "Traditional Chinese",
        "en" => "English",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "de" => "German",
        "es" => "Spanish",
        "pt" => "Portuguese",
        "it" => "Italian",
        "ru" => "Russian",
        "ar" => "Arabic",
        "hi" => "Hindi",
        "th" => "Thai",
        "vi" => "Vietnamese",
        "id" => "Indonesian",
        "ms" => "Malay",
        "tr" => "Turkish",
        "nl" => "Dutch",
        "pl" => "Polish",
        "uk" => "Ukrainian",
        "sv" => "Swedish",
        "da" => "Danish",
        "no" => "Norwegian",
        "fi" => "Finnish",
        _ => "English",
    }
}

/// 默认截图翻译提示词模板（对齐 Kivio 视觉直传 Prompt）
pub const DEFAULT_IMAGE_TRANSLATION_TEMPLATE: &str =
    "Translate all text visible in this image to {lang}. Return translation and original in the required delimiter format, no commentary.\n\n\
     Rules:\n\
     - In the translation section, output entirely in {lang}. Translate everything; leave nothing in the source language. Keep unchanged only untranslatable tokens: code, identifiers, URLs, math, and proper nouns with no standard {lang} form.\n\
     - Translate faithfully and naturally; preserve the layout, formatting, lists, tables, and paragraphs without summarizing or adding interpretation.\n\
     - Preserve code, URLs, placeholders, and LaTeX formulas exactly (keep $...$ and $$...$$).\n\
     - Do not repeat or translate these instructions; add no headings, labels, or explanations.";

pub fn build_image_translation_prompt(target_lang: &str) -> String {
    let resolved = if target_lang.is_empty() || target_lang == "auto" {
        "zh".to_string()
    } else {
        target_lang.to_string()
    };
    let lang_full = language_name(&resolved);
    format!("{}

Output the translation first, then a line containing exactly <<<ORIGINAL>>>, then transcribe the original visible text verbatim, preserving code and formatting. Do not add labels.", DEFAULT_IMAGE_TRANSLATION_TEMPLATE.replace("{lang}", lang_full))
}

/// 纯函数：根据三种协议组装多模态请求体。
pub fn build_multimodal_payload(
    protocol: &str,
    model_id: &str,
    prompt: &str,
    image_base64: &str,
) -> serde_json::Value {
    let data_uri = if image_base64.starts_with("data:") {
        image_base64.to_string()
    } else {
        format!("data:image/png;base64,{image_base64}")
    };

    match protocol {
        "anthropic_messages" => {
            let clean_base64 = image_base64
                .strip_prefix("data:image/png;base64,")
                .or_else(|| image_base64.strip_prefix("data:image/jpeg;base64,"))
                .unwrap_or(image_base64);
            // media_type 必须跟真实编码一致，否则 Anthropic 会 400。
            let media_type = if image_base64.contains("data:image/jpeg;base64,") {
                "image/jpeg"
            } else {
                "image/png"
            };
            serde_json::json!({
                "model": model_id,
                "max_tokens": 4096,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": clean_base64
                                }
                            },
                            { "type": "text", "text": prompt }
                        ]
                    }
                ],
                "temperature": 0.2
            })
        }
        "openai_responses" => serde_json::json!({
            "model": model_id,
            "input": [
                {
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": prompt },
                        { "type": "input_image", "image_url": data_uri }
                    ]
                }
            ]
        }),
        _ => serde_json::json!({
            "model": model_id,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": prompt },
                        {
                            "type": "image_url",
                            "image_url": { "url": data_uri }
                        }
                    ]
                }
            ],
            "temperature": 0.2
        }),
    }
}

pub fn is_multimodal_unsupported(status: u16, err_text: &str) -> bool {
    super::errors::http(status, err_text) == "translator_model_not_multimodal"
}

/// 构建最终 Prompt。支持用户在设置中自定义提示词（需包含 `{text}`，支持 `{lang}`）。
pub fn build_translation_prompt(
    text: &str,
    target_lang: &str,
    custom_template: Option<&str>,
) -> String {
    let resolved = resolve_target_lang(target_lang, text);
    let lang_full = language_name(&resolved);
    let template = match custom_template.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(custom) if custom.contains("{text}") => custom,
        _ => DEFAULT_TRANSLATION_TEMPLATE,
    };
    template
        .replace("{lang}", lang_full)
        .replace("{text}", text)
}

/// 移除推理模型可能输出的 `<think>...</think>` 标签内容
pub fn strip_thinking_block(raw: &str) -> String {
    if let Some(start) = raw.find("<think>") {
        if let Some(end) = raw[start..].find("</think>") {
            let after = &raw[start + end + 8..];
            let before = &raw[..start];
            let combined = format!("{}{}", before.trim(), after.trim());
            return combined.trim().to_string();
        }
    }
    raw.trim().to_string()
}

/// 列出「设置 → 对话模型」中已启用的全部模型，默认项优先。
async fn list_enabled_models(pool: &SqlitePool) -> Result<Vec<TranslatorModelOption>, String> {
    let rows = sqlx::query(
        "SELECT p.id AS provider_id, p.name AS provider_name, m.model_id AS model_id, \
         (p.is_default = 1 AND m.is_default = 1) AS is_default \
         FROM chat_providers p \
         JOIN chat_provider_models m ON m.provider_id = p.id \
         WHERE p.enabled = 1 AND m.enabled = 1 \
         ORDER BY p.is_default DESC, m.is_default DESC, p.name ASC, m.model_id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| "translator_storage".to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| TranslatorModelOption {
            provider_id: row.get("provider_id"),
            provider_name: row.get("provider_name"),
            model_id: row.get("model_id"),
            is_default: row.get::<i64, _>("is_default") != 0,
        })
        .collect())
}

/// 解析翻译要使用的提供商与模型：优先用户选择，失效或未选择时回退到默认项。
pub(super) async fn load_provider_and_model(
    pool: &SqlitePool,
    explicit: Option<(&str, &str)>,
) -> Result<ProviderSecretAndConfig, String> {
    let (provider_id, base_url, protocol, provider_name, model_id) = match explicit {
        Some((provider_id, model_id)) => {
            // 用户选择必须仍处于启用状态，否则回退默认，避免使用已停用的模型。
            let provider_row = sqlx::query(
                "SELECT name, base_url, protocol FROM chat_providers WHERE id = ? AND enabled = 1",
            )
            .bind(provider_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| "translator_storage".to_string())?;
            let model_ok: Option<String> = sqlx::query_scalar(
                "SELECT model_id FROM chat_provider_models \
                 WHERE provider_id = ? AND model_id = ? AND enabled = 1",
            )
            .bind(provider_id)
            .bind(model_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| "translator_storage".to_string())?;
            match (provider_row, model_ok) {
                (Some(row), Some(model_id)) => (
                    provider_id.to_string(),
                    row.get::<String, _>("base_url"),
                    row.get::<String, _>("protocol"),
                    row.get::<String, _>("name"),
                    model_id,
                ),
                _ => load_default_provider_and_model(pool).await?,
            }
        }
        None => load_default_provider_and_model(pool).await?,
    };

    // 密钥只在这里读取，不向上层或前端暴露。
    let api_key: Option<String> =
        sqlx::query_scalar("SELECT api_key FROM chat_provider_secrets WHERE provider_id = ?")
            .bind(&provider_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    Ok(ProviderSecretAndConfig {
        provider_id,
        provider_name,
        base_url,
        protocol,
        model_id,
        api_key,
    })
}

/// 默认模型：优先 is_default，否则取第一个已启用项。
async fn load_default_provider_and_model(
    pool: &SqlitePool,
) -> Result<(String, String, String, String, String), String> {
    let provider_row = sqlx::query(
        "SELECT id, name, base_url, protocol FROM chat_providers \
         WHERE enabled = 1 \
         ORDER BY is_default DESC, updated_at DESC, id ASC \
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|_| "translator_storage".to_string())?
    .ok_or_else(|| "translator_no_active_provider".to_string())?;

    let provider_id: String = provider_row.get("id");
    let provider_name: String = provider_row.get("name");
    let base_url: String = provider_row.get("base_url");
    let protocol: String = provider_row.get("protocol");

    let model_row = sqlx::query(
        "SELECT model_id FROM chat_provider_models \
         WHERE provider_id = ? AND enabled = 1 \
         ORDER BY is_default DESC, model_id ASC \
         LIMIT 1",
    )
    .bind(&provider_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| "translator_storage".to_string())?
    .ok_or_else(|| "translator_no_active_model".to_string())?;

    Ok((
        provider_id,
        base_url,
        protocol,
        provider_name,
        model_row.get("model_id"),
    ))
}

pub(super) fn resolve_endpoint(base: &str, protocol: &str) -> Result<String, String> {
    let mut url = url::Url::parse(base.trim()).map_err(|_| "translator_config".to_string())?;
    let path = url.path().trim_end_matches('/');
    let expected = match protocol {
        "anthropic_messages" => "messages",
        "openai_responses" => "responses",
        _ => "chat/completions",
    };
    if path.ends_with(&format!("/{expected}")) {
        // already full
    } else if path.ends_with("/v1") {
        url.set_path(&format!("{path}/{expected}"));
    } else if path.is_empty() || path == "/" {
        url.set_path(&format!("/v1/{expected}"));
    } else {
        url.set_path(&format!("{path}/v1/{expected}"));
    }
    Ok(url.into())
}

#[tauri::command]
pub async fn translator_list_models(
    window: WebviewWindow,
) -> Result<Vec<TranslatorModelOption>, String> {
    authorize(&window)?;
    let pool = get_pool().await?;
    list_enabled_models(&pool).await
}

#[tauri::command]
pub fn translator_resolve_target_lang(text: String) -> String {
    resolve_target_lang("auto", text.trim())
}

/// 名称启发式：判断某个模型是否可能具备视觉（多模态）能力。
/// 仅用于"当前模型不支持图片时自动改用其他已启用模型"这一个回退场景。
pub fn is_likely_vision_model(model_id: &str) -> bool {
    let lower = model_id.to_ascii_lowercase();
    const HINTS: &[&str] = &[
        "vision", "-vl", "vl-", "multimodal", "omni", "llava", "pixtral", "internvl", "qvq",
        "gpt-4o", "gpt-4.1", "gpt-5", "gpt-6", "claude-3", "claude-4", "claude-sonnet",
        "claude-opus", "gemini", "glm-4", "glm-5", "qwen2.5-vl", "qwen3-vl", "doubao-vision",
        "step-1v", "yi-vision", "molmo", "minicpm-v",
    ];
    HINTS.iter().any(|hint| lower.contains(hint))
}

/// 从已启用的对话模型中挑选一个可能支持视觉的模型（排除当前失败的模型）。
pub(super) async fn pick_vision_fallback(
    pool: &SqlitePool,
    exclude_provider: &str,
    exclude_model: &str,
) -> Option<(String, String)> {
    let rows = sqlx::query(
        "SELECT p.id AS provider_id, m.model_id AS model_id \
         FROM chat_providers p \
         JOIN chat_provider_models m ON m.provider_id = p.id \
         WHERE p.enabled = 1 AND m.enabled = 1 \
         ORDER BY p.is_default DESC, m.is_default DESC, p.name ASC",
    )
    .fetch_all(pool)
    .await
    .ok()?;

    rows.into_iter().find_map(|row| {
        let provider_id: String = row.get("provider_id");
        let model_id: String = row.get("model_id");
        if provider_id == exclude_provider && model_id == exclude_model {
            return None;
        }
        if !is_likely_vision_model(&model_id) {
            return None;
        }
        Some((provider_id, model_id))
    })
}

/// 向指定模型发送多模态翻译请求（单次尝试，不做回退）。
pub(super) async fn call_vision_model(
    config: &ProviderSecretAndConfig,
    prompt: &str,
    image_base64: &str,
) -> Result<String, String> {
    let endpoint = resolve_endpoint(&config.base_url, &config.protocol)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "translator_config".to_string())?;

    let payload =
        build_multimodal_payload(&config.protocol, &config.model_id, prompt, image_base64);

    let mut req = client.post(&endpoint);
    if let Some(key) = config.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        if config.protocol == "anthropic_messages" {
            req = req
                .header("x-api-key", key.trim())
                .header("anthropic-version", "2023-06-01");
        } else {
            req = req.header("authorization", format!("Bearer {}", key.trim()));
        }
    }

    let resp = req
        .json(&payload)
        .send()
        .await
        .map_err(super::errors::network)?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        if is_multimodal_unsupported(status.as_u16(), &err_text) {
            return Err("translator_model_not_multimodal".into());
        }
        return Err(super::errors::http(status.as_u16(), &err_text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "translator_invalid_response".to_string())?;

    let translated = super::result::response_text(&config.protocol, &json);

    let translated = strip_thinking_block(&translated);
    if translated.trim().is_empty() { return Err("translator_invalid_response".into()); }
    Ok(translated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{sqlite::SqliteConnectOptions, Connection};

    /// 与迁移 56 保持一致的提供商目录表结构，仅用于隔离测试。
    const PROVIDER_SCHEMA: &str = "CREATE TABLE chat_providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, \
        base_url TEXT NOT NULL, protocol TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, \
        is_default INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); \
        CREATE TABLE chat_provider_models (provider_id TEXT NOT NULL, model_id TEXT NOT NULL, \
        enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, \
        PRIMARY KEY(provider_id, model_id)); \
        CREATE TABLE chat_provider_secrets (provider_id TEXT PRIMARY KEY, api_key TEXT NOT NULL);";

    async fn database() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("translator.db");
        std::fs::File::create(&path).unwrap();
        let options = SqliteConnectOptions::new().filename(&path).foreign_keys(true);
        let mut c = sqlx::SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(PROVIDER_SCHEMA).execute(&mut c).await.unwrap();
        c.close().await.unwrap();
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        (dir, pool)
    }

    async fn seed(pool: &SqlitePool) {
        for (id, name, enabled, is_default, updated) in [
            ("prov-a", "Alpha", 1, 0, 100),
            ("prov-b", "Beta", 1, 1, 50),
            ("prov-off", "Disabled", 0, 0, 200),
        ] {
            sqlx::query(
                "INSERT INTO chat_providers(id,name,base_url,protocol,enabled,is_default,created_at,updated_at) \
                 VALUES(?,?,?,?,?,?,0,?)",
            )
            .bind(id)
            .bind(name)
            .bind("https://example.test/v1")
            .bind("openai_chat")
            .bind(enabled)
            .bind(is_default)
            .bind(updated)
            .execute(pool)
            .await
            .unwrap();
        }
        for (provider, model, enabled, is_default) in [
            ("prov-a", "a-default", 1, 1),
            ("prov-a", "a-other", 1, 0),
            ("prov-a", "a-off", 0, 0),
            ("prov-b", "b-default", 1, 1),
            ("prov-off", "off-model", 1, 1),
        ] {
            sqlx::query(
                "INSERT INTO chat_provider_models(provider_id,model_id,enabled,is_default) VALUES(?,?,?,?)",
            )
            .bind(provider)
            .bind(model)
            .bind(enabled)
            .bind(is_default)
            .execute(pool)
            .await
            .unwrap();
        }
        sqlx::query("INSERT INTO chat_provider_secrets(provider_id,api_key) VALUES('prov-a','key-a')")
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn list_only_enabled_models_with_default_first() {
        let (_dir, pool) = database().await;
        seed(&pool).await;
        let models = list_enabled_models(&pool).await.unwrap();
        let keys: Vec<String> = models
            .iter()
            .map(|m| format!("{}:::{}", m.provider_id, m.model_id))
            .collect();
        assert_eq!(
            keys,
            vec![
                "prov-b:::b-default".to_string(),
                "prov-a:::a-default".to_string(),
                "prov-a:::a-other".to_string(),
            ]
        );
        assert!(models[0].is_default);
        assert_eq!(models[0].provider_name, "Beta");
    }

    #[tokio::test]
    async fn explicit_selection_overrides_the_default_model() {
        let (_dir, pool) = database().await;
        seed(&pool).await;
        let config = load_provider_and_model(&pool, Some(("prov-a", "a-other")))
            .await
            .unwrap();
        assert_eq!(config.provider_id, "prov-a");
        assert_eq!(config.model_id, "a-other");
        assert_eq!(config.api_key.as_deref(), Some("key-a"));
    }

    #[tokio::test]
    async fn stale_or_disabled_selection_falls_back_to_the_default_model() {
        let (_dir, pool) = database().await;
        seed(&pool).await;
        for selection in [
            Some(("prov-a", "a-off")),
            Some(("prov-off", "off-model")),
            Some(("missing", "missing")),
            None,
        ] {
            let config = load_provider_and_model(&pool, selection).await.unwrap();
            assert_eq!(config.provider_id, "prov-b", "{selection:?}");
            assert_eq!(config.model_id, "b-default", "{selection:?}");
        }
    }

    #[tokio::test]
    async fn missing_catalog_reports_a_model_error_instead_of_panicking() {
        let (_dir, pool) = database().await;
        let err = match load_provider_and_model(&pool, None).await {
            Ok(_) => panic!("expected a missing-provider error"),
            Err(err) => err,
        };
        assert_eq!(err, "translator_no_active_provider");
        assert!(list_enabled_models(&pool).await.unwrap().is_empty());
    }

    #[test]
    fn test_multimodal_payload_structures() {
        let chat = build_multimodal_payload("openai_chat", "gpt-4o", "Translate", "AAAA");
        assert_eq!(chat["model"], "gpt-4o");
        assert_eq!(chat["messages"][0]["content"][0]["type"], "text");
        assert_eq!(chat["messages"][0]["content"][1]["type"], "image_url");

        let anthropic =
            build_multimodal_payload("anthropic_messages", "claude-3-5", "Translate", "AAAA");
        assert_eq!(anthropic["messages"][0]["content"][0]["type"], "image");
        assert_eq!(
            anthropic["messages"][0]["content"][0]["source"]["type"],
            "base64"
        );

        let resp = build_multimodal_payload("openai_responses", "resp-model", "Translate", "AAAA");
        assert_eq!(resp["input"][0]["content"][0]["type"], "input_text");
        assert_eq!(resp["input"][0]["content"][1]["type"], "input_image");
    }

    #[test]
    fn test_multimodal_unsupported_error_classifier() {
        assert!(is_multimodal_unsupported(
            400,
            "The model does not support image input"
        ));
        assert!(is_multimodal_unsupported(400, "Unsupported vision content"));
        assert!(!is_multimodal_unsupported(500, "Internal server error"));
        assert!(!is_multimodal_unsupported(401, "Invalid API key"));
    }

    #[test]
    fn test_vision_model_heuristic() {
        assert!(is_likely_vision_model("gpt-4o"));
        assert!(is_likely_vision_model("claude-3-5-sonnet-20241022"));
        assert!(is_likely_vision_model("qwen2.5-vl-72b"));
        assert!(is_likely_vision_model("gemini-2.0-flash"));
        assert!(!is_likely_vision_model("kimi-for-coding"));
        assert!(!is_likely_vision_model("deepseek-reasoner"));
    }

    #[test]
    fn test_chinese_detection() {
        assert!(has_chinese("你好世界"));
        assert!(has_chinese("Hello 世界"));
        assert!(!has_chinese("Hello world"));
        assert!(!has_chinese("12345 @#$%"));
    }

    #[test]
    fn test_resolve_target_lang() {
        assert_eq!(resolve_target_lang("auto", "你好世界"), "en");
        assert_eq!(resolve_target_lang("auto", "Hello world"), "zh");
        assert_eq!(resolve_target_lang("ja", "Hello world"), "ja");
    }

    #[test]
    fn test_prompt_construction() {
        let prompt = build_translation_prompt("Hello world", "zh", None);
        assert!(prompt.contains("Simplified Chinese"));
        assert!(prompt.contains("<source_text>\nHello world\n</source_text>"));

        let custom = build_translation_prompt("hi", "zh", Some("Translate to {lang}: {text}"));
        assert_eq!(custom, "Translate to Simplified Chinese: hi");
    }

    #[test]
    fn test_strip_thinking_block() {
        let with_think = "<think>\nThinking about the translation...\n</think>\n\n你好，世界！";
        assert_eq!(strip_thinking_block(with_think), "你好，世界！");

        let normal = "Hello, world!";
        assert_eq!(strip_thinking_block(normal), "Hello, world!");
    }

    #[test]
    fn test_resolve_endpoint() {
        assert_eq!(
            resolve_endpoint("https://api.openai.com/v1", "openai_chat").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            resolve_endpoint("https://api.openai.com/v1/chat/completions", "openai_chat").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            resolve_endpoint("https://api.anthropic.com", "anthropic_messages").unwrap(),
            "https://api.anthropic.com/v1/messages"
        );
    }
}

pub(super) async fn call_text_model(config: &ProviderSecretAndConfig, prompt: &str) -> Result<String, String> {
    let endpoint = resolve_endpoint(&config.base_url, &config.protocol)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()
        .map_err(|_| "translator_config".to_string())?;
    let payload = match config.protocol.as_str() {
        "anthropic_messages" => serde_json::json!({"model":config.model_id,"max_tokens":4096,
            "messages":[{"role":"user","content":prompt}],"temperature":0.2}),
        "openai_responses" => serde_json::json!({"model":config.model_id,"input":prompt}),
        _ => serde_json::json!({"model":config.model_id,"messages":[{"role":"user","content":prompt}],"temperature":0.2}),
    };
    let mut req = client.post(endpoint);
    if let Some(key) = config.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        if config.protocol == "anthropic_messages" {
            req = req.header("x-api-key", key.trim()).header("anthropic-version", "2023-06-01");
        } else { req = req.bearer_auth(key.trim()); }
    }
    let response = req.json(&payload).send().await.map_err(super::errors::network)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(super::errors::http(status.as_u16(), &body));
    }
    let json = response.json::<serde_json::Value>().await.map_err(|_| "translator_invalid_response".to_owned())?;
    let text = strip_thinking_block(&super::result::response_text(&config.protocol, &json));
    if text.trim().is_empty() { return Err("translator_invalid_response".into()); }
    Ok(text)
}
