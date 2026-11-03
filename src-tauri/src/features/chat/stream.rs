use super::types::{Message, Result};
use crate::provider::chat_runtime::{Protocol, Runtime};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
pub const MAX_FRAME: usize = 1024 * 1024;
pub const MAX_ANSWER: usize = 2 * 1024 * 1024;
#[derive(Debug)]
pub enum Part {
    Text(String),
    Done(String),
}
/// Byte buffering means split UTF-8 is decoded only after a complete SSE line.
pub struct Decoder {
    buffer: Vec<u8>,
    data: Vec<String>,
    size: usize,
    protocol: Protocol,
    done: bool,
    finish: Option<String>,
    rejection: Option<super::chat_delta::Rejection>,
}
impl Decoder {
    pub fn new(protocol: Protocol) -> Self {
        Self {
            buffer: Vec::new(),
            data: Vec::new(),
            size: 0,
            protocol,
            done: false,
            finish: None,
            rejection: None,
        }
    }
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Part>> {
        let mut out = Vec::new();
        for &b in bytes {
            // The terminal frame is the stream boundary. Ignore ALL trailing bytes,
            // including SSE keepalive comments, independent of network partitioning.
            // run() stops reading at this same boundary; no trailing payload is used.
            if self.done {
                break;
            }
            if b != b'\n' {
                self.buffer.push(b);
                if self.buffer.len() + self.size > MAX_FRAME {
                    return Err("chat_frame_limit".into());
                }
                continue;
            }
            let line = std::mem::take(&mut self.buffer);
            self.size += line.len() + 1;
            if self.size > MAX_FRAME {
                return Err("chat_frame_limit".into());
            }
            let line = std::str::from_utf8(&line)
                .map_err(|_| "chat_protocol".to_string())?
                .trim_end_matches('\r');
            if line.is_empty() {
                if self.data.is_empty() {
                    self.size = 0;
                    continue;
                }
                let data = self.data.join("\n");
                self.data.clear();
                self.size = 0;
                if let Some(part) = self.parse(&data).map_err(|error| {
                    // Fixed vocabulary only: never log upstream strings, values or keys.
                    log::warn!(
                        "chat stream rejected protocol={:?} reason=event_payload diagnostic={:?}",
                        self.protocol,
                        self.rejection
                            .unwrap_or_else(|| super::chat_delta::Rejection::new(
                                super::chat_delta::Subreason::UnsupportedPayload,
                                super::chat_delta::Field::Envelope,
                                None
                            ))
                    );
                    error
                })? {
                    out.push(part)
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                let data = data.strip_prefix(' ').unwrap_or(data);
                self.data.push(data.into());
            } else if !(line.starts_with(':')
                || line.starts_with("event:")
                || line.starts_with("id:")
                || line.starts_with("retry:"))
            {
                return Err("chat_protocol".into());
            }
        }
        Ok(out)
    }
    fn parse(&mut self, data: &str) -> Result<Option<Part>> {
        if data == "[DONE]" {
            if self.protocol != Protocol::Chat || self.finish.is_none() {
                self.rejection = Some(super::chat_delta::Rejection::new(
                    super::chat_delta::Subreason::TerminalBeforeFinish,
                    super::chat_delta::Field::Envelope,
                    None,
                ));
                return Err("chat_protocol".into());
            }
            self.done = true;
            return Ok(Some(Part::Done(self.finish.clone().unwrap())));
        }
        let v: Value = serde_json::from_str(data).map_err(|_| {
            self.rejection = Some(super::chat_delta::Rejection::new(
                super::chat_delta::Subreason::InvalidJson,
                super::chat_delta::Field::Envelope,
                None,
            ));
            "chat_protocol".to_string()
        })?;
        let bad = || "chat_protocol".to_string();
        match self.protocol {
            Protocol::Chat => super::chat_delta::parse(&v, &mut self.finish).map_err(|rejection| {
                self.rejection = Some(rejection);
                "chat_protocol".to_string()
            }),
            Protocol::Messages => match v["type"].as_str().ok_or_else(bad)? {
                "content_block_start" => {
                    let block = &v["content_block"];
                    match block["type"].as_str() {
                        Some("thinking")
                            if block["thinking"].is_string() && block["signature"].is_string() =>
                        {
                            return Ok(None)
                        }
                        Some("redacted_thinking") if block["data"].is_string() => return Ok(None),
                        Some("text") if block["text"].is_string() => {}
                        _ => return Err(bad()),
                    }
                    Ok(v["content_block"]["text"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| Part::Text(s.into())))
                }
                "content_block_delta" => {
                    let delta = &v["delta"];
                    match delta["type"].as_str() {
                        Some("thinking_delta") if delta["thinking"].is_string() => return Ok(None),
                        Some("signature_delta") if delta["signature"].is_string() => {
                            return Ok(None)
                        }
                        Some("text_delta") => {}
                        _ => return Err(bad()),
                    }
                    Ok(Some(Part::Text(
                        v["delta"]["text"].as_str().ok_or_else(bad)?.into(),
                    )))
                }
                "message_delta" => {
                    let reason = v["delta"]["stop_reason"].as_str().ok_or_else(bad)?;
                    if !["end_turn", "max_tokens", "stop_sequence"].contains(&reason) {
                        return Err(bad());
                    }
                    self.finish = Some(reason.into());
                    Ok(None)
                }
                "message_stop" => {
                    let reason = self.finish.clone().ok_or_else(bad)?;
                    self.done = true;
                    Ok(Some(Part::Done(reason)))
                }
                "message_start" | "content_block_stop" | "ping" => Ok(None),
                _ => Err(bad()),
            },
            Protocol::Responses => match v["type"].as_str().ok_or_else(bad)? {
                "response.output_text.delta" => Ok(Some(Part::Text(
                    v["delta"].as_str().ok_or_else(bad)?.into(),
                ))),
                "response.completed" => {
                    if v["response"]["status"] != "completed" {
                        return Err(bad());
                    }
                    let output = v["response"]["output"].as_array().ok_or_else(bad)?;
                    for item in output {
                        validate_output_item(item)?;
                    }
                    self.done = true;
                    Ok(Some(Part::Done("completed".into())))
                }
                "response.output_item.added" | "response.output_item.done" => {
                    validate_output_item(&v["item"])?;
                    Ok(None)
                }
                "response.content_part.added" | "response.content_part.done" => {
                    if !matches!(
                        v["part"]["type"].as_str(),
                        Some("output_text" | "reasoning_text")
                    ) || !v["part"]["text"].is_string()
                    {
                        return Err(bad());
                    }
                    Ok(None)
                }
                "response.output_text.annotation.added" => {
                    if !v.get("annotation").is_some_and(valid_annotation) {
                        return Err(bad());
                    }
                    Ok(None)
                }
                "response.reasoning_summary_part.added"
                | "response.reasoning_summary_part.done" => {
                    if v["part"]["type"] != "summary_text" || !v["part"]["text"].is_string() {
                        return Err(bad());
                    }
                    Ok(None)
                }
                "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                    if !v["delta"].is_string() {
                        return Err(bad());
                    }
                    Ok(None)
                }
                "response.reasoning_summary_text.done" | "response.reasoning_text.done" => {
                    if !v["text"].is_string() {
                        return Err(bad());
                    }
                    Ok(None)
                }
                "response.created" | "response.in_progress" | "response.output_text.done" => {
                    Ok(None)
                }
                _ => Err(bad()),
            },
        }
    }
    #[cfg(test)]
    pub(super) fn rejection(&self) -> Option<super::chat_delta::Rejection> {
        self.rejection
    }
    pub fn eof(&self) -> Result<()> {
        if self.done && self.buffer.is_empty() && self.data.is_empty() {
            Ok(())
        } else {
            log::warn!(
                "chat stream rejected protocol={:?} reason=incomplete_eof",
                self.protocol
            );
            Err("chat_protocol_eof".into())
        }
    }
}
/// Official OpenAI output union: only text messages and opaque reasoning are
/// compatible with this text-only surface. Tools/refusals remain stable errors.
fn validate_output_item(item: &Value) -> Result<()> {
    let valid = match item["type"].as_str() {
        Some("message") => item.get("content").is_none_or(|content| {
            content.as_array().is_some_and(|parts| {
                parts
                    .iter()
                    .all(|part| part["type"] == "output_text" && part["text"].is_string())
            })
        }),
        Some("reasoning") => {
            item["id"].is_string()
                && item["summary"].as_array().is_some_and(|parts| {
                    parts
                        .iter()
                        .all(|part| part["type"] == "summary_text" && part["text"].is_string())
                })
                && item.get("content").is_none_or(|content| {
                    content.as_array().is_some_and(|parts| {
                        parts.iter().all(|part| {
                            part["type"] == "reasoning_text" && part["text"].is_string()
                        })
                    })
                })
                && item
                    .get("encrypted_content")
                    .is_none_or(|v| v.is_null() || v.is_string())
                && item.get("status").is_none_or(|v| {
                    matches!(v.as_str(), Some("in_progress" | "completed" | "incomplete"))
                })
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("chat_protocol".into())
    }
}

// SDK output-text citation metadata is discarded, never fetched or rendered.
fn valid_annotation(value: &Value) -> bool {
    if value.is_null() {
        return true;
    }
    let strings = |keys: &[&str]| keys.iter().all(|key| value[*key].is_string());
    let indices = |keys: &[&str]| keys.iter().all(|key| value[*key].as_u64().is_some());
    match value["type"].as_str() {
        Some("file_citation") => strings(&["file_id", "filename"]) && indices(&["index"]),
        Some("file_path") => strings(&["file_id"]) && indices(&["index"]),
        Some("url_citation") => {
            strings(&["url", "title"]) && indices(&["start_index", "end_index"])
        }
        Some("container_file_citation") => {
            strings(&["container_id", "file_id", "filename"])
                && indices(&["start_index", "end_index"])
        }
        _ => false,
    }
}

fn sse_mime(value: Option<&str>) -> bool {
    value.is_some_and(|h| {
        h.split(';')
            .next()
            .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))
    })
}

/// Per-request knobs that do not belong in the stored conversation.
pub struct Request {
    pub model: String,
    pub reasoning: Option<String>,
    pub images: Option<Vec<String>>,
}

/// Anthropic budgets thinking tokens instead of naming an effort level.
/// Levels mirror the shared reasoning scale; `minimal` collapses onto the API minimum.
fn thinking_budget(level: &str) -> Option<u32> {
    match level {
        "minimal" | "low" => Some(1024),
        "medium" => Some(2048),
        "high" => Some(4096),
        "xhigh" => Some(8192),
        "max" => Some(16384),
        _ => None,
    }
}

pub const MAX_IMAGES: usize = 4;

/// Clipboard images arrive as data URIs; only these encodings are forwarded.
pub fn normalize_images(images: Option<&[String]>) -> Result<Vec<String>> {
    let Some(list) = images else {
        return Ok(Vec::new());
    };
    if list.len() > MAX_IMAGES {
        return Err("chat_invalid_input".into());
    }
    for uri in list {
        if ![
            "data:image/png;base64,",
            "data:image/jpeg;base64,",
            "data:image/webp;base64,",
        ]
        .iter()
        .any(|prefix| uri.starts_with(prefix))
        {
            return Err("chat_invalid_input".into());
        }
    }
    Ok(list.to_vec())
}

fn anthropic_image(uri: &str) -> Value {
    let (media_type, data) = if let Some(rest) = uri.strip_prefix("data:image/jpeg;base64,") {
        ("image/jpeg", rest)
    } else if let Some(rest) = uri.strip_prefix("data:image/webp;base64,") {
        ("image/webp", rest)
    } else {
        (
            "image/png",
            uri.strip_prefix("data:image/png;base64,").unwrap_or(uri),
        )
    };
    json!({"type":"image","source":{"type":"base64","media_type":media_type,"data":data}})
}

/// Only the newest user turn carries images; history stays plain strings.
fn messages_with_images(protocol: Protocol, history: &[Message], images: &[String]) -> Vec<Value> {
    let last_user = history.iter().rposition(|m| m.role == "user");
    history
        .iter()
        .enumerate()
        .map(|(index, m)| {
            if Some(index) != last_user || images.is_empty() {
                return json!({"role":m.role,"content":m.content});
            }
            let mut parts: Vec<Value> = vec![match protocol {
                Protocol::Responses => json!({"type":"input_text","text":m.content}),
                _ => json!({"type":"text","text":m.content}),
            }];
            for uri in images {
                parts.push(match protocol {
                    Protocol::Messages => anthropic_image(uri),
                    Protocol::Responses => json!({"type":"input_image","image_url":uri}),
                    Protocol::Chat => json!({"type":"image_url","image_url":{"url":uri}}),
                });
            }
            json!({"role":m.role,"content":parts})
        })
        .collect()
}

pub fn body(
    protocol: Protocol,
    model: &str,
    history: &[Message],
    reasoning: Option<&str>,
    images: &[String],
) -> Value {
    let messages: Vec<Value> = messages_with_images(protocol, history, images);
    let effort = reasoning
        .map(str::trim)
        .filter(|level| matches!(*level, "minimal" | "low" | "medium" | "high" | "xhigh" | "max"));
    let mut payload = match protocol {
        Protocol::Messages => {
            json!({"model":model,"messages":messages,"stream":true,"max_tokens":8192})
        }
        Protocol::Chat => json!({"model":model,"messages":messages,"stream":true}),
        Protocol::Responses => json!({"model":model,"input":messages,"stream":true,"store":false}),
    };
    match (protocol, effort) {
        (_, None) => {}
        (Protocol::Chat, Some(level)) => {
            payload["reasoning_effort"] = json!(level);
        }
        (Protocol::Responses, Some(level)) => {
            payload["reasoning"] = json!({"effort": level});
        }
        (Protocol::Messages, Some(level)) => {
            if let Some(budget) = thinking_budget(level) {
                // Thinking requires headroom above the stored budget.
                payload["max_tokens"] = json!(8192 + budget);
                payload["thinking"] = json!({"type": "enabled", "budget_tokens": budget});
            }
        }
    }
    payload
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            return;
        }
    }
}
pub async fn run(
    client: reqwest::Client,
    runtime: Runtime,
    request: Request,
    history: Vec<Message>,
    mut cancel: watch::Receiver<bool>,
    tx: mpsc::Sender<Result<Part>>,
) {
    let job = async {
        let attachments = normalize_images(request.images.as_deref())?;
        let mut http_req = client.post(&runtime.endpoint).json(&body(
            runtime.protocol,
            &request.model,
            &history,
            request.reasoning.as_deref(),
            &attachments,
        ));
        http_req = match runtime.protocol {
            Protocol::Messages => http_req
                .header("x-api-key", &runtime.key)
                .header("anthropic-version", "2023-06-01"),
            _ => http_req.bearer_auth(&runtime.key),
        };
        let response = tokio::time::timeout(Duration::from_secs(15), http_req.send())
            .await
            .map_err(|_| "chat_timeout".to_string())?
            .map_err(|e| {
                if e.is_timeout() {
                    "chat_timeout"
                } else {
                    "chat_network"
                }
                .to_string()
            })?;
        let code = response.status().as_u16();
        if !(200..300).contains(&code) {
            return Err(match code {
                401 | 403 => "chat_auth",
                429 => "chat_rate_limit",
                _ => "chat_http",
            }
            .into());
        }
        if !sse_mime(
            response
                .headers()
                .get("content-type")
                .and_then(|h| h.to_str().ok()),
        ) {
            log::warn!(
                "chat stream rejected protocol={:?} reason=content_type status={}",
                runtime.protocol,
                code
            );
            return Err("chat_protocol".into());
        }
        let mut stream = response.bytes_stream();
        let mut decoder = Decoder::new(runtime.protocol);
        let mut size = 0;
        loop {
            let chunk = tokio::time::timeout(Duration::from_secs(60), stream.next())
                .await
                .map_err(|_| "chat_timeout".to_string())?;
            let Some(chunk) = chunk else {
                decoder.eof()?;
                break;
            };
            let chunk = chunk.map_err(|_| "chat_network".to_string())?;
            for part in decoder.feed(&chunk)? {
                if let Part::Text(s) = &part {
                    size += s.len();
                    if size > MAX_ANSWER {
                        return Err("chat_answer_limit".into());
                    }
                }
                let done = matches!(part, Part::Done(_));
                tx.send(Ok(part))
                    .await
                    .map_err(|_| "chat_cancelled".to_string())?;
                if done {
                    return Ok(());
                }
            }
        }
        Ok(())
    };
    let result = tokio::select! {
     biased;
     _=cancelled(&mut cancel)=>Err("chat_cancelled".to_string()),
     result=tokio::time::timeout(Duration::from_secs(600),job)=>result.unwrap_or_else(|_|Err("chat_timeout".into())),
    };
    if let Err(e) = result {
        let _ = tx.send(Err(e)).await;
    }
}

#[cfg(test)]
#[test]
fn chat_stream_mime_is_exact_case_insensitive_media_type() {
    for mime in ["text/event-stream", "Text/Event-Stream; charset=utf-8"] {
        assert!(sse_mime(Some(mime)));
    }
    for mime in [
        None,
        Some("application/json"),
        Some("text/event-stream-malformed"),
        Some(""),
    ] {
        assert!(!sse_mime(mime));
    }
}
