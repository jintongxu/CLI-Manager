//! Offline SDK-shaped fixtures. Reasoning must never become answer text.
use super::stream::{Decoder, Part};
use crate::provider::chat_runtime::Protocol;
use serde_json::{json, Value};

fn frame(value: Value) -> String {
    format!("data: {value}\n\n")
}
fn check_partitions(protocol: Protocol, raw: &str) {
    // Every two-way partition, including cuts inside UTF-8 and terminal/comments.
    for cut in 0..=raw.len() {
        let mut decoder = Decoder::new(protocol);
        let mut text = String::new();
        let mut done = 0;
        for bytes in [&raw.as_bytes()[..cut], &raw.as_bytes()[cut..]] {
            for part in decoder.feed(bytes).unwrap() {
                match part {
                    Part::Text(s) => text.push_str(&s),
                    Part::Done(_) => done += 1,
                }
            }
        }
        decoder.eof().unwrap();
        assert_eq!(text, "你好");
        assert_eq!(done, 1);
    }
    let mut decoder = Decoder::new(protocol);
    for byte in raw.as_bytes() {
        decoder.feed(&[*byte]).unwrap();
    }
    decoder.eof().unwrap();
}

#[test]
fn chat_sdk_reasoning_answer_terminal_all_partitions() {
    let reasoning = json!({"type":"reasoning","id":"r","summary":[],"encrypted_content":null,"status":"completed"});
    let message = json!({"type":"message","content":[{"type":"output_text","text":"你好"}]});
    let mut raw = frame(json!({"type":"response.output_item.added","item":reasoning}));
    for state in ["added", "done"] {
        raw += &frame(
            json!({"type":format!("response.content_part.{state}"),"part":{"type":"reasoning_text","text":"PRIVATE"}}),
        );
        raw += &frame(
            json!({"type":format!("response.reasoning_summary_part.{state}"),"part":{"type":"summary_text","text":"PRIVATE"}}),
        );
    }
    for prefix in ["response.reasoning_summary_text", "response.reasoning_text"] {
        raw += &frame(json!({"type":format!("{prefix}.delta"),"delta":"PRIVATE"}));
        raw += &frame(json!({"type":format!("{prefix}.done"),"text":"PRIVATE"}));
    }
    raw += &frame(json!({"type":"response.output_item.done","item":reasoning}));
    raw += &frame(json!({"type":"response.output_text.delta","delta":"你好"}));
    raw += &frame(
        json!({"type":"response.completed","response":{"status":"completed","output":[reasoning,message]}}),
    );
    raw += ": keepalive\n\n";
    check_partitions(Protocol::Responses, &raw);

    let mut raw = String::new();
    for block in [
        json!({"type":"thinking","thinking":"PRIVATE","signature":"opaque"}),
        json!({"type":"redacted_thinking","data":"opaque"}),
    ] {
        raw += &frame(json!({"type":"content_block_start","index":0,"content_block":block}));
    }
    for delta in [
        json!({"type":"thinking_delta","thinking":"PRIVATE"}),
        json!({"type":"signature_delta","signature":"opaque"}),
    ] {
        raw += &frame(json!({"type":"content_block_delta","index":0,"delta":delta}));
    }
    raw += &frame(
        json!({"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}),
    );
    raw += &frame(
        json!({"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"你好"}}),
    );
    raw += &frame(json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}));
    raw += &frame(json!({"type":"message_stop"}));
    raw += ": keepalive\r\n\r\n";
    check_partitions(Protocol::Messages, &raw);

    let raw = frame(
        json!({"choices":[{"index":0,"delta":{"role":"assistant","content":null,"refusal":null},"finish_reason":null}]}),
    ) + &frame(
        json!({"choices":[{"index":0,"delta":{"content":"你好","refusal":null},"finish_reason":"stop"}]}),
    ) + "data: [DONE]\n\n: keepalive\n\n";
    check_partitions(Protocol::Chat, &raw);
}

#[test]
fn chat_reasoning_unknown_malformed_tools_refusal_and_eof_fail_closed() {
    for (p, value) in [
        (
            Protocol::Responses,
            json!({"type":"response.output_text.annotation.added","annotation":{"type":"unknown"}}),
        ),
        (
            Protocol::Chat,
            json!({"choices":[{"index":0,"delta":{"refusal":"no"}}]}),
        ),
        (
            Protocol::Chat,
            json!({"choices":[{"index":0,"delta":{"reasoning_content":{}}}]}),
        ),
        (
            Protocol::Chat,
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{}]}}]}),
        ),
        (
            Protocol::Chat,
            json!({"choices":[{"index":0,"delta":{},"finish_reason":42}]}),
        ),
        (
            Protocol::Messages,
            json!({"type":"content_block_start","content_block":{"type":"tool_use"}}),
        ),
        (
            Protocol::Messages,
            json!({"type":"content_block_start","content_block":{"type":"thinking","thinking":7,"signature":""}}),
        ),
        (
            Protocol::Messages,
            json!({"type":"content_block_delta","delta":{"type":"signature_delta"}}),
        ),
        (
            Protocol::Messages,
            json!({"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}),
        ),
        (Protocol::Messages, json!({"type":"unknown"})),
        (
            Protocol::Responses,
            json!({"type":"response.reasoning_text.delta","delta":null}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.reasoning_text.other","text":"PRIVATE"}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.output_item.done","item":{"type":"reasoning","id":"r","summary":{}}}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call"}]}}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.completed","response":{"status":"incomplete"}}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.completed","response":{"status":"completed","output":{}}}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.content_part.added","part":{"type":"reasoning_text","text":null}}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.refusal.delta","delta":"no"}),
        ),
        (
            Protocol::Responses,
            json!({"type":"response.output_item.done","item":{"type":"message","content":[{"type":"refusal","refusal":"no"}]}}),
        ),
    ] {
        assert_eq!(
            Decoder::new(p).feed(frame(value).as_bytes()).unwrap_err(),
            "chat_protocol"
        );
    }
    for (p, value) in [
        (
            Protocol::Responses,
            json!({"type":"response.reasoning_text.delta","delta":"PRIVATE"}),
        ),
        (
            Protocol::Messages,
            json!({"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"PRIVATE"}}),
        ),
    ] {
        let mut decoder = Decoder::new(p);
        assert!(decoder.feed(frame(value).as_bytes()).unwrap().is_empty());
        assert_eq!(decoder.eof().unwrap_err(), "chat_protocol_eof");
    }
}

#[test]
fn chat_nullable_empty_and_documented_compatible_reasoning_all_partitions() {
    let mut raw = frame(json!({"error":null,"choices":[{"index":0,"delta":{
        "role":"assistant","content":null,"refusal":null,"tool_calls":[],"function_call":null,
        "reasoning_content":"PRIVATE","reasoning":null},"finish_reason":null}]}));
    raw += &frame(
        json!({"choices":[{"index":0,"delta":{"reasoning":"PRIVATE","reasoning_content":""}}]}),
    );
    raw += &frame(
        json!({"choices":[{"index":0,"delta":{"content":"你好","tool_calls":null},"finish_reason":"stop"}]}),
    );
    raw += &frame(json!({"choices":[],"usage":{"total_tokens":8}}));
    raw += "data: [DONE]\n\n";
    check_partitions(Protocol::Chat, &raw);
    let mut decoder = Decoder::new(Protocol::Chat);
    assert!(decoder.feed(frame(json!({"choices":[{"index":0,"delta":{"reasoning":"PRIVATE"},"finish_reason":"stop"}]})).as_bytes()).unwrap().is_empty());
    assert_eq!(decoder.eof().unwrap_err(), "chat_protocol_eof");
}

#[test]
fn chat_structural_rejections_are_fixed_vocabulary_without_payload_or_key_strings() {
    use super::chat_delta::{Field, Shape, Subreason};
    for (delta, reason, field, shape) in [
        (
            json!({"tool_calls":[{"secret":"CANARY"}]}),
            Subreason::ToolPayload,
            Field::ToolCalls,
            Shape::Array,
        ),
        (
            json!({"function_call":{}}),
            Subreason::ToolPayload,
            Field::FunctionCall,
            Shape::EmptyObject,
        ),
        (
            json!({"tool_calls":{}}),
            Subreason::ToolPayload,
            Field::ToolCalls,
            Shape::EmptyObject,
        ),
        (
            json!({"reasoning":[]}),
            Subreason::InvalidFieldType,
            Field::Reasoning,
            Shape::EmptyArray,
        ),
        (
            json!({"reasoning_content":7}),
            Subreason::InvalidFieldType,
            Field::ReasoningContent,
            Shape::Number,
        ),
        (
            json!({"content":false}),
            Subreason::InvalidFieldType,
            Field::Content,
            Shape::Bool,
        ),
        (
            json!({"CANARY_key":"CANARY_payload"}),
            Subreason::UnknownDeltaField,
            Field::Unknown,
            Shape::String,
        ),
        (
            json!({"refusal":"CANARY"}),
            Subreason::RefusalPayload,
            Field::Refusal,
            Shape::String,
        ),
    ] {
        let mut decoder = Decoder::new(Protocol::Chat);
        assert_eq!(
            decoder
                .feed(frame(json!({"choices":[{"index":0,"delta":delta}]})).as_bytes())
                .unwrap_err(),
            "chat_protocol"
        );
        let rejection = decoder.rejection().unwrap();
        assert_eq!(
            (rejection.subreason, rejection.field, rejection.shape),
            (reason, field, shape)
        );
        let logged = format!("{rejection:?}");
        assert!(!logged.contains("CANARY"));
        assert!(!logged.contains("http"));
    }
    for (value, reason) in [
        (json!({"error":{},"choices":[]}), Subreason::UpstreamError),
        (json!({"choices":[],"usage":null}), Subreason::ChoicesShape),
        (
            json!({"choices":[{"index":1,"delta":{}}]}),
            Subreason::ChoiceIndex,
        ),
        (
            json!({"choices":[{"index":0,"delta":null}]}),
            Subreason::DeltaShape,
        ),
        (
            json!({"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
            Subreason::UnsupportedFinish,
        ),
    ] {
        let mut decoder = Decoder::new(Protocol::Chat);
        assert!(decoder.feed(frame(value).as_bytes()).is_err());
        assert_eq!(decoder.rejection().unwrap().subreason, reason);
    }
    let mut decoder = Decoder::new(Protocol::Chat);
    assert!(decoder.feed(b"data: CANARY_NOT_JSON\n\n").is_err());
    assert_eq!(
        decoder.rejection().unwrap().subreason,
        Subreason::InvalidJson
    );
    let mut decoder = Decoder::new(Protocol::Chat);
    assert!(decoder.feed(b"data: [DONE]\n\n").is_err());
    assert_eq!(
        decoder.rejection().unwrap().subreason,
        Subreason::TerminalBeforeFinish
    );
}
