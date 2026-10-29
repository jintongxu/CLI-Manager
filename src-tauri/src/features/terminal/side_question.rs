use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[path = "side_question_process.rs"]
pub(crate) mod process;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideQuestionMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideQuestionRequest {
    #[serde(default)]
    request_id: String,
    #[serde(default)]
    thread_id: String,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    messages: Vec<SideQuestionMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SideQuestionContextRequest {
    request_id: String,
    source_session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SideQuestionContext {
    available: bool,
    text: String,
    truncated: bool,
    reason: Option<String>,
}
impl SideQuestionContext {
    fn unavailable(reason: &str) -> Self {
        Self { available: false, text: String::new(), truncated: false, reason: Some(reason.into()) }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    request_id: String,
    thread_id: String,
    text: String,
}

fn validate_request(request: &mut SideQuestionRequest) -> Result<(), String> {
    let legacy = request.messages.is_empty() && request.prompt.is_some();
    if legacy {
        request.messages.push(SideQuestionMessage { role: "user".into(), content: request.prompt.take().unwrap() });
        if request.request_id.is_empty() { request.request_id = uuid::Uuid::new_v4().to_string(); }
        if request.thread_id.is_empty() { request.thread_id = uuid::Uuid::new_v4().to_string(); }
    }
    if request.request_id.trim().is_empty() || request.thread_id.trim().is_empty()
        || request.request_id.len() > 200 || request.thread_id.len() > 200 {
        return Err("side_question_invalid_identity".into());
    }
    if request.messages.is_empty() || request.messages.len() > 200 || request.messages.len() % 2 == 0
        || request.messages.iter().enumerate().any(|(index, message)| {
            message.role != if index % 2 == 0 { "user" } else { "assistant" } || message.content.trim().is_empty()
        }) {
        return Err("side_question_invalid_messages".into());
    }
    if request.context.chars().count() > 40_000
        || request.quote.len() + request.context.len() + request.messages.iter().map(|message| message.content.len()).sum::<usize>() > 512_000 {
        return Err("side_question_request_too_large".into());
    }
    Ok(())
}

/// A single isolated inference, never a terminal/PTY or a source-session mutation.
#[tauri::command]
pub async fn side_question_ask(app: tauri::AppHandle, mut request: SideQuestionRequest) -> Result<String, String> {
    validate_request(&mut request)?;
    let registration = process::Registration::new(request.request_id.clone())?;
    let request_id = request.request_id.clone();
    let thread_id = request.thread_id.clone();
    let mut payload = serde_json::to_value(&request).map_err(|_| "side_question_encode")?;
    payload["type"] = "ask".into();
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let value = process::run(resource_dir, payload, registration, Duration::from_secs(120), |text| {
            let _ = app.emit_to("main", "side-question-progress", Progress { request_id: request_id.clone(), thread_id: thread_id.clone(), text });
        })?;
        if value.get("requestId").and_then(|value| value.as_str()) != Some(&request_id)
            || value.get("threadId").and_then(|value| value.as_str()) != Some(&thread_id) {
            return Err("side_question_identity".into());
        }
        value.get("answer").and_then(|value| value.as_str()).filter(|answer| !answer.trim().is_empty())
            .map(str::to_string).ok_or_else(|| "side_question_empty_answer".into())
    }).await.map_err(|_| "side_question_join".to_string())?
}

#[tauri::command]
pub fn side_question_cancel(request_id: String) {
    process::cancel(&request_id);
}

/// Resolve source=pi through the backend history index only. No frontend paths, cwd
/// approximation, latest-session guesses, remote reads or credentials in diagnostics.
#[tauri::command]
pub async fn side_question_context(app: tauri::AppHandle, request: SideQuestionContextRequest) -> Result<SideQuestionContext, String> {
    if request.request_id.trim().is_empty() || request.request_id.len() > 200 {
        return Err("side_question_invalid_identity".into());
    }
    // Register before the first await (history lookup can itself outlive deletion).
    let registration = process::Registration::new(request.request_id.clone())?;
    if request.source_session_id.trim().is_empty() || request.source_session_id.len() > 200 {
        return Ok(SideQuestionContext::unavailable("source_identity_missing"));
    }
    let resource_dir = app.path().resource_dir().ok();
    let sessions = match crate::commands::history::history_list_sessions(
        app, Some("pi".into()), None, None, None, None, None,
        Some(request.source_session_id.clone()), None, None,
    ).await {
        Ok(sessions) => sessions,
        Err(_) => {
            context_diagnostic("history", "source_index_unavailable");
            return Ok(SideQuestionContext::unavailable("source_index_unavailable"));
        },
    };
    if registration.is_cancelled() { return Err("side_question_cancelled".into()); }
    let mut paths: Vec<_> = sessions.into_iter()
        .filter(|session| session.source == "pi" && session.session_id == request.source_session_id)
        .map(|session| session.file_path).collect();
    paths.sort();
    paths.dedup();
    if paths.len() != 1 {
        context_diagnostic("history", if paths.is_empty() { "source_not_found" } else { "source_ambiguous" });
        return Ok(SideQuestionContext::unavailable(if paths.is_empty() { "source_not_found" } else { "source_ambiguous" }));
    }
    context_diagnostic("history", "source_index_exact");
    let path = PathBuf::from(&paths[0]);
    if !path.is_absolute() || paths[0].starts_with("\\\\") || paths[0].starts_with("//") || !path.is_file() {
        context_diagnostic("path", "source_not_local");
        return Ok(SideQuestionContext::unavailable("source_not_local"));
    }
    context_diagnostic("path", "source_path_local");
    let payload = serde_json::json!({ "type": "context", "sourceSessionId": request.source_session_id, "sessionPath": path });
    tauri::async_runtime::spawn_blocking(move || {
        match process::run(resource_dir, payload, registration, Duration::from_secs(15), |_| {}) {
            Ok(value) => {
                let context = serde_json::from_value::<SideQuestionContext>(value).map_err(|_| {
                    context_diagnostic("decode", "source_context_protocol");
                    "side_question_context_protocol".to_string()
                })?;
                if let Some(reason) = context.reason.as_deref() {
                    context_diagnostic("snapshot", safe_snapshot_reason(reason));
                } else if context.available {
                    context_diagnostic("snapshot", "source_context_available");
                }
                Ok(context)
            },
            Err(error) => context_process_error(error),
        }
    }).await.map_err(|_| "side_question_join".to_string())?
}

// Only fixed, locally selected codes reach diagnostics; never log payloads or error text.
fn context_diagnostic(stage: &str, code: &str) {
    log::warn!("side_question_context stage={} code={}", stage, code);
}

fn safe_snapshot_reason(reason: &str) -> &'static str {
    match reason {
        "source_read_failed" => "source_read_failed",
        "source_header_invalid" => "source_header_invalid",
        "source_identity_mismatch" => "source_identity_mismatch",
        "source_parse_failed" => "source_parse_failed",
        "source_projection_init_failed" => "source_projection_init_failed",
        "source_projection_failed" => "source_projection_failed",
        "source_extract_failed" => "source_extract_failed",
        "source_text_unavailable" => "source_text_unavailable",
        _ => "source_unreadable",
    }
}

fn context_process_error(error: String) -> Result<SideQuestionContext, String> {
    if error.starts_with("side_question_packaged_runtime_missing") {
        context_diagnostic("resolve", "source_runtime_missing");
        return Err("side_question_packaged_runtime_missing: reinstall CLI-Manager (side-question runtime resources are missing)".into());
    }
    if error.starts_with("side_question_node_required") {
        context_diagnostic("start", "source_node_required");
        return Err("side_question_node_required: install Node.js >=22.19.0 and restart CLI-Manager".into());
    }
    let (stage, code) = match error.as_str() {
        "side_question_timeout" => ("process", "source_timeout"),
        "side_question_protocol" => ("protocol", "source_process_protocol"),
        "side_question_frame" => ("protocol", "source_process_frame"),
        "side_question_identity" => ("protocol", "source_process_identity"),
        "side_question_exit" => ("exit", "source_process_exit"),
        "side_question_empty_answer" => ("protocol", "source_process_empty"),
        "side_question_sidecar_start" => ("start", "source_process_start"),
        "side_question_stdin" => ("start", "source_process_stdin"),
        "side_question_stdout" => ("start", "source_process_stdout"),
        "side_question_wait" => ("exit", "source_process_wait"),
        "side_question_failed" => ("sidecar", "source_process_failed"),
        "side_question_cancelled" => ("process", "source_process_cancelled"),
        _ => ("process", "source_unreadable"),
    };
    context_diagnostic(stage, code);
    Ok(SideQuestionContext::unavailable(code))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_preserves_safe_stage_codes_and_never_arbitrary_error_text() {
        for (error, reason) in [
            ("side_question_timeout", "source_timeout"),
            ("side_question_exit", "source_process_exit"),
            ("side_question_protocol", "source_process_protocol"),
            ("side_question_identity", "source_process_identity"),
            ("side_question_sidecar_start", "source_process_start"),
            ("side_question_frame", "source_process_frame"),
            ("side_question_empty_answer", "source_process_empty"),
            ("PRIVATE C:/credential transcript", "source_unreadable"),
        ] {
            assert_eq!(context_process_error(error.into()).unwrap().reason.as_deref(), Some(reason));
        }
        for error in ["side_question_packaged_runtime_missing", "side_question_node_required"] {
            let safe = context_process_error(format!("{error}: PRIVATE C:/secret")).unwrap_err();
            assert!(safe.starts_with(error));
            assert!(!safe.contains("PRIVATE"));
        }
        assert_eq!(safe_snapshot_reason("PRIVATE C:/secret"), "source_unreadable");
    }
    #[test]
    fn structured_camel_case_and_legacy_requests() {
        let mut request: SideQuestionRequest = serde_json::from_str(r#"{"requestId":"r1","threadId":"t1","messages":[{"role":"user","content":"why"},{"role":"assistant","content":"because"},{"role":"user","content":"more"}]}"#).unwrap();
        validate_request(&mut request).unwrap();
        let encoded = serde_json::to_value(request).unwrap();
        assert_eq!(encoded["requestId"], "r1");
        assert!(encoded.get("request_id").is_none());
        let mut legacy: SideQuestionRequest = serde_json::from_str(r#"{"prompt":"explain this"}"#).unwrap();
        validate_request(&mut legacy).unwrap();
        assert_eq!(legacy.messages[0].content, "explain this");
        assert!(!legacy.request_id.is_empty());
    }
    #[test]
    fn reject_invalid_turns_and_frontend_paths() {
        let mut request: SideQuestionRequest = serde_json::from_str(r#"{"requestId":"r","threadId":"t","messages":[{"role":"assistant","content":"no"}]}"#).unwrap();
        assert!(validate_request(&mut request).is_err());
        let context: SideQuestionContextRequest = serde_json::from_str(r#"{"requestId":"ctx","sourceSessionId":"id"}"#).unwrap();
        assert_eq!(context.request_id, "ctx");
        assert!(serde_json::from_str::<SideQuestionContextRequest>(r#"{"sourceSessionId":"id"}"#).is_err());
        assert!(serde_json::from_str::<SideQuestionContextRequest>(r#"{"requestId":"ctx","sourceSessionId":"id","sessionPath":"evil"}"#).is_err());
    }
    #[test]
    fn request_size_identity_and_turn_limits_are_enforced() {
        fn valid() -> SideQuestionRequest {
            serde_json::from_str(r#"{"requestId":"r","threadId":"t","messages":[{"role":"user","content":"why"}]}"#).unwrap()
        }
        let mut request = valid();
        request.request_id = " ".into();
        assert_eq!(validate_request(&mut request).unwrap_err(), "side_question_invalid_identity");
        let mut request = valid();
        request.context = "\u{1f600}".repeat(40_000);
        validate_request(&mut request).unwrap();
        request.context.push('x');
        assert_eq!(validate_request(&mut request).unwrap_err(), "side_question_request_too_large");
        let mut request = valid();
        request.quote = "x".repeat(512_001);
        assert_eq!(validate_request(&mut request).unwrap_err(), "side_question_request_too_large");
        let mut request = valid();
        request.messages.push(SideQuestionMessage { role: "assistant".into(), content: "unfinished".into() });
        assert_eq!(validate_request(&mut request).unwrap_err(), "side_question_invalid_messages");
    }
}

// Native exit waits for cancellation and owned-process cleanup before terminating.
pub fn shutdown() { process::shutdown(); }
