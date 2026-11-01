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
        }
    }
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Part>> {
        let mut out = Vec::new();
        for &b in bytes {
            if self.done {
                if !b.is_ascii_whitespace() {
                    return Err("chat_protocol".into());
                } else {
                    continue;
                }
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
                if let Some(part) = self.parse(&data)? {
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
                return Err("chat_protocol".into());
            }
            self.done = true;
            return Ok(Some(Part::Done(self.finish.clone().unwrap())));
        }
        let v: Value = serde_json::from_str(data).map_err(|_| "chat_protocol".to_string())?;
        let bad = || "chat_protocol".to_string();
        match self.protocol {
            Protocol::Chat => {
                if v.get("error").is_some() {
                    return Err(bad());
                }
                let choices = v["choices"].as_array().ok_or_else(bad)?;
                if choices.is_empty() && v.get("usage").is_some() {
                    return Ok(None);
                }
                if choices.len() != 1 || choices[0]["index"].as_u64() != Some(0) {
                    return Err(bad());
                }
                let c = &choices[0];
                let d = &c["delta"];
                if d.get("tool_calls").is_some()
                    || d.get("function_call").is_some()
                    || d.get("refusal").is_some_and(|v| !v.is_null())
                {
                    return Err(bad());
                }
                if let Some(reason) = c["finish_reason"].as_str() {
                    if !["stop", "length"].contains(&reason) {
                        return Err(bad());
                    }
                    self.finish = Some(reason.into());
                }
                if !d
                    .as_object()
                    .is_some_and(|o| o.keys().all(|k| ["role", "content"].contains(&k.as_str())))
                {
                    return Err(bad());
                }
                if let Some(text) = d["content"].as_str() {
                    return Ok(Some(Part::Text(text.into())));
                }
                if d.get("content").is_some_and(|c| !c.is_null()) {
                    return Err(bad());
                }
                Ok(None)
            }
            Protocol::Messages => match v["type"].as_str().ok_or_else(bad)? {
                "content_block_start" => {
                    if v["content_block"]["type"] != "text" {
                        return Err(bad());
                    }
                    Ok(v["content_block"]["text"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| Part::Text(s.into())))
                }
                "content_block_delta" => {
                    if v["delta"]["type"] != "text_delta" {
                        return Err(bad());
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
                    if let Some(output) = v["response"]["output"].as_array() {
                        for item in output {
                            if item["type"] != "message" {
                                return Err(bad());
                            }
                        }
                    }
                    self.done = true;
                    Ok(Some(Part::Done("completed".into())))
                }
                "response.output_item.added" | "response.output_item.done" => {
                    if v["item"]["type"] != "message" {
                        return Err(bad());
                    }
                    Ok(None)
                }
                "response.content_part.added" | "response.content_part.done" => {
                    if v["part"]["type"] != "output_text" {
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
    pub fn eof(&self) -> Result<()> {
        if self.done && self.buffer.is_empty() && self.data.is_empty() {
            Ok(())
        } else {
            Err("chat_protocol_eof".into())
        }
    }
}
/// Per-request knobs that do not belong in the stored conversation.
pub struct Request {
    pub model: String,
    pub reasoning: Option<String>,
    pub images: Option<Vec<String>>,
}

/// Anthropic budgets thinking tokens instead of naming an effort level.
fn thinking_budget(level: &str) -> Option<u32> {
    match level {
        "low" => Some(1024),
        "medium" => Some(2048),
        "high" => Some(4096),
        _ => None,
    }
}

pub const MAX_IMAGES: usize = 4;

/// Clipboard images arrive as data URIs; only these encodings are forwarded.
pub fn normalize_images(images: Option<&[String]>) -> Result<Vec<String>> {
    let Some(list) = images else { return Ok(Vec::new()); };
    if list.len() > MAX_IMAGES {
        return Err("chat_invalid_input".into());
    }
    for uri in list {
        if !["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,"]
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
        ("image/png", uri.strip_prefix("data:image/png;base64,").unwrap_or(uri))
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
        .filter(|level| matches!(*level, "minimal" | "low" | "medium" | "high"));
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
        let mut http_req =
            client
                .post(&runtime.endpoint)
                .json(&body(
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
        if !response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.starts_with("text/event-stream"))
        {
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
