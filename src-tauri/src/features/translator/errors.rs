//! Privacy boundary: only allowlisted codes cross IPC. Never return/log provider bodies.
pub fn network(error: reqwest::Error) -> String {
    if error.is_timeout() { "translator_timeout" } else { "translator_network" }.into()
}
pub fn http(status: u16, body: &str) -> String {
    let json: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    // Providers may populate both fields (or a null/numeric code). Neither field
    // may mask an auth/quota type and accidentally enable the vision fallback.
    let codes: Vec<String> = ["/error/code", "/error/type"].into_iter()
        .filter_map(|path| json.pointer(path).and_then(|v| v.as_str()))
        .map(str::to_ascii_lowercase).collect();
    let has = |expected: &[&str]| codes.iter().any(|code| expected.contains(&code.as_str()));
    let quota = has(&["insufficient_quota", "quota_exceeded", "billing_hard_limit_reached", "credit_balance_too_low"]);
    if status == 401 || status == 403 || has(&["invalid_api_key", "authentication_error", "permission_denied"]) { return "translator_auth".into(); }
    if status == 402 || quota { return "translator_quota".into(); }
    if status == 429 || has(&["rate_limit_exceeded", "rate_limit_error"]) { return "translator_rate".into(); }
    if status >= 500 { return "translator_server".into(); }
    let message = json.pointer("/error/message").and_then(|v| v.as_str()).unwrap_or(body).to_ascii_lowercase();
    if [400, 415, 422].contains(&status) && (
        has(&["unsupported_image", "image_not_supported", "unsupported_vision"]) ||
        ((message.contains("image") || message.contains("vision") || message.contains("multimodal")) &&
         (message.contains("not support") || message.contains("unsupported") || message.contains("does not support")))) {
        return "translator_model_not_multimodal".into();
    }
    "translator_invalid_response".into()
}
pub fn safe(error: String) -> String {
    const CODES: &[&str] = &["translator_network", "translator_timeout", "translator_auth", "translator_quota",
        "translator_rate", "translator_server", "translator_invalid_response", "translator_model_not_multimodal",
        "translator_no_active_provider", "translator_no_active_model", "translator_config", "translator_storage",
        "translator_obsolete", "translator_busy"];
    if CODES.contains(&error.as_str()) { error }
    else if error.starts_with("translator_storage") { "translator_storage".into() }
    else { "translator_invalid_response".into() }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn priority_and_privacy() {
        for (status, body, expected) in [
            (400, r#"{"error":{"code":null,"type":"authentication_error","message":"image unsupported SECRET"}}"#, "translator_auth"),
            (400, r#"{"error":{"code":"unsupported_image","type":"insufficient_quota","message":"SECRET"}}"#, "translator_quota"),
            (400, r#"{"error":{"code":123,"type":"rate_limit_error","message":"image unsupported SECRET"}}"#, "translator_rate"),
            (401, "unsupported image secret", "translator_auth"),
            (403, "vision unsupported", "translator_auth"),
            (429, "image unsupported", "translator_rate"),
            (429, r#"{"error":{"code":"insufficient_quota","message":"image unsupported SECRET"}}"#, "translator_quota"),
            (500, "image unsupported", "translator_server"),
            (400, "image request invalid", "translator_invalid_response"),
            (400, "The model does not support image input", "translator_model_not_multimodal"),
        ] { assert_eq!(http(status, body), expected); }
        assert_eq!(safe("raw secret request response".into()), "translator_invalid_response");
    }
}
