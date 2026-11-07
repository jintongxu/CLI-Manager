use tauri::ipc::{InvokeBody, Request, Response};

/// Extracts a raw command payload without JSON/Base64 expansion.
pub(crate) fn request_bytes<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("chat_asset_binary_required".into()),
    }
}

/// Returns a raw IPC response body, surfaced to JavaScript as an ArrayBuffer.
pub(crate) fn response_bytes(bytes: Vec<u8>) -> Response {
    Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use super::response_bytes;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    #[test]
    fn response_uses_raw_ipc_body_without_json_serialization() {
        let body = response_bytes(vec![0, 1, 127, 255]).body().unwrap();
        assert!(matches!(body, InvokeResponseBody::Raw(bytes) if bytes == vec![0, 1, 127, 255]));
    }
}
