//! Submission and accepted completion boundary; network work never holds the opening lock.
use super::{attempt::{AcceptedTranslation, Identity}, commands as c, sizing::Mode, window::OPENING};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

fn authorize(window: &WebviewWindow, capture: bool) -> Result<(), String> {
    if window.label() == "translator" || (!capture && window.label() == "main") ||
        (capture && window.label() == "translator-capture") { Ok(()) }
    else { Err("translator_config".into()) }
}
#[tauri::command]
pub fn translator_invalidate(window: WebviewWindow, generation: u64, revision: u64) -> Result<(), String> {
    authorize(&window, false)?;
    let mut s = OPENING.lock().map_err(|_| "translator_storage")?;
    if s.opening.generation != generation || s.opening.mode != Mode::Input { return Err("translator_obsolete".into()); }
    s.authority.invalidate(revision)?;
    Ok(())
}
fn begin(generation: u64, revision: u64, mode: Mode) -> Result<Identity, String> {
    let mut s = OPENING.lock().map_err(|_| "translator_storage")?;
    if s.opening.generation != generation || s.opening.mode != mode { return Err("translator_obsolete".into()); }
    s.authority.begin(generation, revision)
}
fn validate(id: Identity) -> Result<(), String> {
    let s = OPENING.lock().map_err(|_| "translator_storage")?;
    if s.opening.generation != id.generation { return Err("translator_obsolete".into()); }
    s.authority.validate(id)
}
fn finish(id: Identity) -> Result<(), String> {
    let mut s = OPENING.lock().map_err(|_| "translator_storage")?;
    if s.opening.generation != id.generation { return Err("translator_obsolete".into()); }
    s.authority.accept(id)?;
    Ok(())
}
#[tauri::command]
pub async fn translator_translate_text(window: WebviewWindow, generation: u64, revision: u64,
    text: String, target_lang: Option<String>, provider_id: Option<String>, model_id: Option<String>,
    custom_prompt: Option<String>) -> Result<AcceptedTranslation, String> {
    authorize(&window, false)?;
    let id = begin(generation, revision, Mode::Input)?;
    let work = async {
        if text.trim().is_empty() { return Err("translator_invalid_response".into()); }
        let pool = c::get_pool().await?;
        let selection = provider_id.as_deref().zip(model_id.as_deref());
        let config = c::load_provider_and_model(&pool, selection).await?;
        validate(id)?;
        let target = c::resolve_target_lang(target_lang.as_deref().unwrap_or("auto"), &text);
        let prompt = c::build_translation_prompt(text.trim(), &target, custom_prompt.as_deref());
        let translated = c::call_text_model(&config, &prompt).await?;
        Ok(AcceptedTranslation { identity: id, translated })
    }.await;
    match work {
        Ok(value) => { finish(id)?; Ok(value) },
        Err(error) => { finish(id)?; Err(super::errors::safe(error)) }
    }
}
fn publish(app: &AppHandle, opening: &super::sizing::Opening) {
    if let Some(w) = app.get_webview_window(super::window::TRANSLATOR_WINDOW_LABEL) {
        let _ = w.emit("translator:prefill", opening);
    }
}
#[tauri::command]
pub async fn translator_translate_image(app: AppHandle, window: WebviewWindow, image_base64: String,
    session_id: u64, generation: u64, target_lang: Option<String>, provider_id: Option<String>,
    model_id: Option<String>) -> Result<super::result::ScreenshotResult, String> {
    authorize(&window, true)?;
    if window.label() != "translator-capture" { return Err("translator_config".into()); }
    super::lifecycle::validate_translation(session_id, generation)?;
    // Thumbnail ACK retained the crop before model discovery; never let duplicate submission replace it.
    let _ = image_base64;
    let result = run_image(&app, generation, target_lang, provider_id, model_id, true).await;
    // A rejected duplicate never owns retirement. The original request must keep
    // its watchdog/cancellation lease until its own terminal completion.
    if result.as_ref().err().map(String::as_str) != Some("translator_busy") {
        super::lifecycle::finish_translation(session_id);
    }
    result
}
#[tauri::command]
pub async fn translator_retry_image(app: AppHandle, window: WebviewWindow, generation: u64,
    target_lang: Option<String>, provider_id: Option<String>, model_id: Option<String>) -> Result<(), String> {
    if window.label() != "translator" { return Err("translator_config".into()); }
    run_image(&app, generation, target_lang, provider_id, model_id, false).await.map(|_| ())
}
async fn run_image(app: &AppHandle, generation: u64, target_lang: Option<String>,
    provider_id: Option<String>, model_id: Option<String>, initial: bool) -> Result<super::result::ScreenshotResult, String> {
    let (id, image) = {
        let mut s = OPENING.lock().map_err(|_| "translator_storage")?;
        if s.opening.generation != generation || s.opening.mode != Mode::Screenshot { return Err("translator_obsolete".into()); }
        if (initial && s.authority.has_started()) || (!initial &&
            !s.opening.card.as_ref().is_some_and(|c| c.phase == "error")) { return Err("translator_busy".into()); }
        let image = s.crop.clone().filter(|s| !s.trim().is_empty()).ok_or("translator_invalid_response")?;
        let id = s.authority.begin(generation, 0)?;
            s.opening.result = None;
        let card = s.opening.card.as_mut().ok_or("translator_obsolete")?;
        card.phase = "loading"; card.error_code = None; card.attempt = id.attempt;
        card.started_at = super::card::now(); card.elapsed_ms = 0;
        s.opening.revision += 1;
        publish(app, &s.opening);
        (id, image)
    };
    let started = std::time::Instant::now();
    let work = async {
        let pool = c::get_pool().await?;
        let mut config = c::load_provider_and_model(&pool, provider_id.as_deref().zip(model_id.as_deref())).await?;
        let target = match target_lang.as_deref() { None | Some("auto") | Some("") => "zh", Some(v) => v }.to_owned();
        let prompt = c::build_image_translation_prompt(&target);
        validate(id)?;
        let raw = match c::call_vision_model(&config, &prompt, &image).await {
            Ok(text) => text,
            Err(error) if error == "translator_model_not_multimodal" => {
                validate(id)?;
                let (p, m) = c::pick_vision_fallback(&pool, &config.provider_id, &config.model_id).await.ok_or(error)?;
                config = c::load_provider_and_model(&pool, Some((&p, &m))).await?;
                validate(id)?;
                c::call_vision_model(&config, &prompt, &image).await?
            }
            Err(error) => return Err(error),
        };
        let result = super::result::parse_result(&raw, image.clone(), started.elapsed().as_millis() as u64)?;
        Ok(result)
    }.await;
    // Accept and publish under the same authority lock; close/new cannot resurrect a card.
    let mut s = OPENING.lock().map_err(|_| "translator_storage")?;
    if s.opening.generation != generation { return Err("translator_obsolete".into()); }
    s.authority.accept(id)?;
    let elapsed = started.elapsed().as_millis() as u64;
    match work {
        Ok(result) => {
            let card = s.opening.card.as_mut().ok_or("translator_obsolete")?;
            card.phase = "success"; card.elapsed_ms = elapsed;
            s.opening.result = Some(result.clone()); s.opening.revision += 1;
            publish(app, &s.opening); Ok(result)
        }
        Err(error) => {
            let error = super::errors::safe(error);
            let card = s.opening.card.as_mut().ok_or("translator_obsolete")?;
            card.phase = "error"; card.error_code = Some(error.clone()); card.elapsed_ms = elapsed;
            s.opening.revision += 1; publish(app, &s.opening); Err(error)
        }
    }
}
