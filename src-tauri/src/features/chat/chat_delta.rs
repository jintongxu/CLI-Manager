//! Text-only Chat compatibility. Evidence: installed OpenAI Delta schema and
//! pi-ai 1.4.0 api/openai-completions.js reasoningFields string checks.
use super::stream::Part;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Subreason {
    InvalidJson,
    TerminalBeforeFinish,
    UnsupportedPayload,
    UpstreamError,
    ChoicesShape,
    ChoiceIndex,
    DeltaShape,
    ToolPayload,
    RefusalPayload,
    InvalidFieldType,
    UnsupportedRole,
    UnsupportedFinish,
    UnknownDeltaField,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Field {
    Envelope,
    Error,
    Choices,
    Index,
    Delta,
    ToolCalls,
    FunctionCall,
    Refusal,
    Role,
    FinishReason,
    Content,
    ReasoningContent,
    Reasoning,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Shape {
    Missing,
    Null,
    EmptyString,
    String,
    EmptyArray,
    Array,
    EmptyObject,
    Object,
    Bool,
    Number,
}
impl Shape {
    fn of(value: Option<&Value>) -> Self {
        match value {
            None => Self::Missing,
            Some(Value::Null) => Self::Null,
            Some(Value::String(v)) if v.is_empty() => Self::EmptyString,
            Some(Value::String(_)) => Self::String,
            Some(Value::Array(v)) if v.is_empty() => Self::EmptyArray,
            Some(Value::Array(_)) => Self::Array,
            Some(Value::Object(v)) if v.is_empty() => Self::EmptyObject,
            Some(Value::Object(_)) => Self::Object,
            Some(Value::Bool(_)) => Self::Bool,
            Some(Value::Number(_)) => Self::Number,
        }
    }
}
/// This is deliberately incapable of carrying upstream keys, strings or values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Rejection {
    pub subreason: Subreason,
    pub field: Field,
    pub shape: Shape,
}
impl Rejection {
    pub fn new(subreason: Subreason, field: Field, value: Option<&Value>) -> Self {
        Self {
            subreason,
            field,
            shape: Shape::of(value),
        }
    }
}

pub(super) fn parse(value: &Value, finish: &mut Option<String>) -> Result<Option<Part>, Rejection> {
    use Field::*;
    use Subreason::*;
    let reject = |reason, field, value| Rejection::new(reason, field, value);
    // Compatibility null sentinels mean absence, not an actual upstream error/tool.
    if value.get("error").is_some_and(|v| !v.is_null()) {
        return Err(reject(UpstreamError, Error, value.get("error")));
    }
    let choices = value
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| reject(ChoicesShape, Choices, value.get("choices")))?;
    if choices.is_empty() && value.get("usage").is_some_and(Value::is_object) {
        return Ok(None);
    }
    if choices.len() != 1 {
        return Err(reject(ChoicesShape, Choices, value.get("choices")));
    }
    let choice = &choices[0];
    if choice["index"].as_u64() != Some(0) {
        return Err(reject(ChoiceIndex, Index, choice.get("index")));
    }
    let delta = &choice["delta"];
    let object = delta
        .as_object()
        .ok_or_else(|| reject(DeltaShape, Delta, choice.get("delta")))?;
    for (key, field) in [("tool_calls", ToolCalls), ("function_call", FunctionCall)] {
        let v = delta.get(key);
        let absent = v.is_none_or(Value::is_null)
            || (key == "tool_calls" && v.and_then(Value::as_array).is_some_and(Vec::is_empty));
        if !absent {
            return Err(reject(ToolPayload, field, v));
        }
    }
    if delta.get("refusal").is_some_and(|v| !v.is_null()) {
        return Err(reject(RefusalPayload, Refusal, delta.get("refusal")));
    }
    if delta
        .get("role")
        .is_some_and(|v| v.as_str() != Some("assistant"))
    {
        return Err(reject(UnsupportedRole, Role, delta.get("role")));
    }
    for (key, field) in [
        ("content", Content),
        ("reasoning_content", ReasoningContent),
        ("reasoning", Reasoning),
    ] {
        if delta
            .get(key)
            .is_some_and(|v| !v.is_null() && !v.is_string())
        {
            return Err(reject(InvalidFieldType, field, delta.get(key)));
        }
    }
    // Only documented string extensions above; no arbitrary objects/reasoning_details.
    for (key, v) in object {
        if ![
            "role",
            "content",
            "refusal",
            "tool_calls",
            "function_call",
            "reasoning_content",
            "reasoning",
        ]
        .contains(&key.as_str())
        {
            return Err(reject(UnknownDeltaField, Unknown, Some(v)));
        }
    }
    if let Some(reason) = choice.get("finish_reason").filter(|v| !v.is_null()) {
        if !reason.is_string() {
            return Err(reject(InvalidFieldType, FinishReason, Some(reason)));
        }
        if !matches!(reason.as_str(), Some("stop" | "length")) {
            return Err(reject(UnsupportedFinish, FinishReason, Some(reason)));
        }
        *finish = reason.as_str().map(str::to_owned);
    }
    // Reasoning is validated and discarded; never answer text/history.
    Ok(delta["content"]
        .as_str()
        .map(|text| Part::Text(text.into())))
}
