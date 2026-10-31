//! Single-request visual translation wire contract and protocol decoding.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub original: Option<String>,
    pub translated: String,
    pub image_base64: String,
    pub elapsed_ms: u64,
}

pub fn parse_result(
    raw: &str,
    image_base64: String,
    elapsed_ms: u64,
) -> Result<ScreenshotResult, String> {
    let clean = super::commands::strip_thinking_block(raw);
    let (translated, original) = match clean.split_once("<<<ORIGINAL>>>") {
        Some((translation, original)) => (translation.trim(), Some(original.trim())),
        None => (clean.trim(), None),
    };
    if translated.is_empty() {
        return Err("translator_empty_image_translation".into());
    }
    Ok(ScreenshotResult {
        original: original.filter(|s| !s.is_empty()).map(str::to_owned),
        translated: translated.to_owned(),
        image_base64,
        elapsed_ms,
    })
}

pub fn response_text(protocol: &str, value: &serde_json::Value) -> String {
    let blocks = |items: Option<&Vec<serde_json::Value>>| -> String {
        items
            .into_iter()
            .flatten()
            .filter_map(|v| v.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    if protocol == "anthropic_messages" {
        return blocks(value.get("content").and_then(|v| v.as_array()));
    }
    if protocol == "openai_responses" {
        if let Some(text) = value.get("output_text").and_then(|v| v.as_str()) {
            return text.to_owned();
        }
        let output = value
            .get("output")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .map(|item| blocks(item.get("content").and_then(|v| v.as_array())))
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if !output.is_empty() {
            return output;
        }
    }
    value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delimiter_missing_original_and_empty_are_honest() {
        let result = parse_result(
            "译文\n<<<ORIGINAL>>>\n```rs\nlet x = 1;\n```",
            "crop".into(),
            37,
        )
        .unwrap();
        assert_eq!(result.original.as_deref(), Some("```rs\nlet x = 1;\n```"));
        assert_eq!(result.translated, "译文");
        assert_eq!(result.elapsed_ms, 37);
        assert_eq!(result.image_base64, "crop");
        for text in ["translation", "translation<<<ORIGINAL>>> "] {
            assert_eq!(parse_result(text, "crop".into(), 0).unwrap().original, None);
        }
        for text in ["", "  ", "<<<ORIGINAL>>>source"] {
            assert!(parse_result(text, String::new(), 0).is_err());
        }
    }
    #[test]
    fn all_protocols_decode_actual_text_blocks_then_parse() {
        let cases = [
            (
                "openai_chat",
                serde_json::json!({"choices":[{"message":{"content":"translated<<<ORIGINAL>>>source"}}]}),
            ),
            (
                "anthropic_messages",
                serde_json::json!({"content":[{"type":"thinking"},{"text":"translated"},{"text":"<<<ORIGINAL>>>source"}]}),
            ),
            (
                "openai_responses",
                serde_json::json!({"output":[{"type":"reasoning"},{"content":[{"text":"translated<<<ORIGINAL>>>source"}]}]}),
            ),
        ];
        for (protocol, payload) in cases {
            let parsed =
                parse_result(&response_text(protocol, &payload), "crop".into(), 12).unwrap();
            assert_eq!(parsed.translated, "translated");
            assert_eq!(parsed.original.as_deref(), Some("source"));
        }
        assert_eq!(
            response_text(
                "openai_responses",
                &serde_json::json!({"output_text":"flat"})
            ),
            "flat"
        );
    }
}
