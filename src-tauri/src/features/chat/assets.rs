use super::types::{now, AssetDescriptor, Message, Result};
use base64::Engine;
use image::GenericImageView;
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, Transaction};
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime},
};

pub const MAX_ASSET_BYTES: usize = 6 * 1024 * 1024;
pub const MAX_SIDE: u32 = 8192;
pub const MAX_PIXELS: u64 = 12_000_000;
const MAX_HISTORY_REFS: usize = 16;
const MAX_HISTORY_BYTES: u64 = 32 * 1024 * 1024;
const MAX_HISTORY_PIXELS: u64 = 48_000_000;
const STAGE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_OWNER_STAGES: usize = 32;
const MAX_OWNER_STAGE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAsset {
    pub stage_id: String,
    pub media_type: String,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone)]
struct Stage {
    owner: String,
    path: PathBuf,
    asset_id: String,
    media_type: String,
    byte_length: u64,
    width: u32,
    height: u32,
    created_at: SystemTime,
}

#[derive(Default)]
pub(crate) struct AssetState {
    stages: HashMap<String, Stage>,
}

static ASSETS: LazyLock<tokio::sync::Mutex<AssetState>> =
    LazyLock::new(|| tokio::sync::Mutex::new(AssetState::default()));
static SESSION: LazyLock<String> = LazyLock::new(|| uuid::Uuid::new_v4().to_string());

pub(crate) fn valid_stage_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    uuid::Uuid::parse_str(id).is_ok()
        && bytes.len() == 36
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
}

pub fn owner_for_label(label: &str) -> Result<String> {
    if !matches!(label, "main" | "quick-chat") {
        return Err("chat_asset_forbidden".into());
    }
    Ok(format!("{}:main", SESSION.as_str()))
}
pub(crate) fn session_owner() -> String {
    format!("{}:main", SESSION.as_str())
}

fn root() -> Result<PathBuf> {
    crate::app_paths::chat_assets_dir().map_err(|_| "chat_asset_storage".into())
}
fn dirs(root: &Path) -> Result<(PathBuf, PathBuf, PathBuf)> {
    let staging = root.join("staging");
    let objects = root.join("objects");
    let trash = root.join("trash");
    for path in [&staging, &objects, &trash] {
        std::fs::create_dir_all(path).map_err(|_| "chat_asset_storage".to_string())?;
    }
    Ok((staging, objects, trash))
}

#[cfg(unix)]
fn sync_dir(path: &Path) -> std::io::Result<()> {
    std::fs::File::open(path)?.sync_all()
}
#[cfg(not(unix))]
fn sync_dir(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Rename is the commit point. On platforms which support directory fsync, persist both
/// directory entries as well (one sync when source and destination share a parent).
fn durable_rename(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(source, target)?;
    let source_parent = source.parent();
    let target_parent = target.parent();
    if let Some(parent) = target_parent {
        sync_dir(parent)?;
    }
    if source_parent != target_parent {
        if let Some(parent) = source_parent {
            sync_dir(parent)?;
        }
    }
    Ok(())
}

fn prune_expired_locked(state: &mut AssetState, now: SystemTime) {
    state.stages.retain(|_, stage| {
        let live = now
            .duration_since(stage.created_at)
            .map(|age| age < STAGE_TTL)
            .unwrap_or(false);
        if !live {
            let _ = std::fs::remove_file(&stage.path);
        }
        live
    });
}

fn owner_usage(state: &AssetState, owner: &str) -> (usize, u64) {
    state
        .stages
        .values()
        .filter(|stage| stage.owner == owner)
        .fold((0usize, 0u64), |(count, bytes), stage| {
            (count + 1, bytes.saturating_add(stage.byte_length))
        })
}

fn exact_png(bytes: &[u8]) -> Result<()> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("chat_asset_format".into());
    }
    let mut at = 8usize;
    let mut first = true;
    loop {
        if at.checked_add(12).is_none_or(|end| end > bytes.len()) {
            return Err("chat_asset_decode".into());
        }
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let kind = &bytes[at + 4..at + 8];
        let end = at
            .checked_add(12)
            .and_then(|v| v.checked_add(len))
            .ok_or_else(|| "chat_asset_decode".to_string())?;
        if end > bytes.len() || (first && kind != b"IHDR") {
            return Err("chat_asset_decode".into());
        }
        first = false;
        if kind == b"acTL" {
            return Err("chat_asset_animated".into());
        }
        at = end;
        if kind == b"IEND" {
            return if len == 0 && at == bytes.len() {
                Ok(())
            } else {
                Err("chat_asset_decode".into())
            };
        }
    }
}

fn exact_jpeg(bytes: &[u8]) -> Result<()> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err("chat_asset_format".into());
    }
    let mut at = 2usize;
    let mut entropy = false;
    while at < bytes.len() {
        if entropy {
            while at < bytes.len() && bytes[at] != 0xff {
                at += 1;
            }
            if at >= bytes.len() {
                return Err("chat_asset_decode".into());
            }
        }
        while at < bytes.len() && bytes[at] == 0xff {
            at += 1;
        }
        if at >= bytes.len() {
            return Err("chat_asset_decode".into());
        }
        let marker = bytes[at];
        at += 1;
        if entropy && (marker == 0x00 || (0xd0..=0xd7).contains(&marker)) {
            continue;
        }
        entropy = false;
        if marker == 0xd9 {
            return if at == bytes.len() {
                Ok(())
            } else {
                Err("chat_asset_decode".into())
            };
        }
        if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if at + 2 > bytes.len() {
            return Err("chat_asset_decode".into());
        }
        let len = u16::from_be_bytes(bytes[at..at + 2].try_into().unwrap()) as usize;
        if len < 2 || at.checked_add(len).is_none_or(|end| end > bytes.len()) {
            return Err("chat_asset_decode".into());
        }
        at += len;
        if marker == 0xda {
            entropy = true;
        }
    }
    Err("chat_asset_decode".into())
}

fn exact_webp(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return Err("chat_asset_format".into());
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if declared.checked_add(8) != Some(bytes.len()) {
        return Err("chat_asset_decode".into());
    }
    let mut at = 12usize;
    while at < bytes.len() {
        if at + 8 > bytes.len() {
            return Err("chat_asset_decode".into());
        }
        let kind = &bytes[at..at + 4];
        let len = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        let data = at + 8;
        let end = data
            .checked_add(len)
            .ok_or_else(|| "chat_asset_decode".to_string())?;
        let padded = end
            .checked_add(len & 1)
            .ok_or_else(|| "chat_asset_decode".to_string())?;
        if padded > bytes.len() {
            return Err("chat_asset_decode".into());
        }
        if kind == b"ANIM"
            || kind == b"ANMF"
            || (kind == b"VP8X" && len >= 1 && bytes[data] & 0x02 != 0)
        {
            return Err("chat_asset_animated".into());
        }
        at = padded;
    }
    Ok(())
}

fn inspect(bytes: &[u8]) -> Result<(String, u32, u32, String)> {
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
        return Err("chat_asset_size".into());
    }
    let format = image::guess_format(bytes).map_err(|_| "chat_asset_format".to_string())?;
    let media = match format {
        image::ImageFormat::Png => {
            exact_png(bytes)?;
            "image/png"
        }
        image::ImageFormat::Jpeg => {
            exact_jpeg(bytes)?;
            "image/jpeg"
        }
        image::ImageFormat::WebP => {
            exact_webp(bytes)?;
            "image/webp"
        }
        _ => return Err("chat_asset_format".into()),
    };
    let reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "chat_asset_decode".to_string())?;
    if width == 0
        || height == 0
        || width > MAX_SIDE
        || height > MAX_SIDE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("chat_asset_dimensions".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_PIXELS * 8);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "chat_asset_decode".to_string())?;
    if decoded.dimensions() != (width, height) {
        return Err("chat_asset_decode".into());
    }
    let asset_id = format!("{:x}", Sha256::digest(bytes));
    Ok((media.into(), width, height, asset_id))
}

pub async fn stage(owner: String, bytes: &[u8]) -> Result<StagedAsset> {
    let (media_type, width, height, asset_id) = inspect(bytes)?;
    let mut state = ASSETS.lock().await;
    let created_at = SystemTime::now();
    prune_expired_locked(&mut state, created_at);
    let (count, staged_bytes) = owner_usage(&state, &owner);
    if count >= MAX_OWNER_STAGES
        || staged_bytes
            .checked_add(bytes.len() as u64)
            .is_none_or(|total| total > MAX_OWNER_STAGE_BYTES)
    {
        return Err("chat_asset_capacity".into());
    }
    let root = root()?;
    let (staging, _, _) = dirs(&root)?;
    let stage_id = uuid::Uuid::new_v4().to_string();
    let path = staging.join(format!("{stage_id}.part"));
    let temp = staging.join(format!("{stage_id}.tmp"));
    let mut file = std::fs::File::create(&temp).map_err(|_| "chat_asset_storage".to_string())?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err("chat_asset_storage".into());
    }
    if durable_rename(&temp, &path).is_err() {
        let _ = std::fs::remove_file(&temp);
        let _ = std::fs::remove_file(&path);
        return Err("chat_asset_storage".into());
    }
    let result = StagedAsset {
        stage_id: stage_id.clone(),
        media_type: media_type.clone(),
        byte_length: bytes.len() as u64,
        width,
        height,
    };
    state.stages.insert(
        stage_id,
        Stage {
            owner,
            path,
            asset_id,
            media_type,
            byte_length: bytes.len() as u64,
            width,
            height,
            created_at,
        },
    );
    Ok(result)
}

/// Idempotently releases only stages owned by the caller. Unknown and foreign IDs are ignored,
/// preventing both existence probing and cross-window deletion.
fn release_locked(state: &mut AssetState, owner: &str, stage_ids: &[String]) {
    for id in stage_ids {
        let owned = state
            .stages
            .get(id)
            .is_some_and(|stage| stage.owner == owner);
        if owned {
            if let Some(stage) = state.stages.remove(id) {
                let _ = std::fs::remove_file(stage.path);
            }
        }
    }
}

pub async fn release(owner: &str, stage_ids: &[String]) -> Result<()> {
    if stage_ids.len() > MAX_OWNER_STAGES || stage_ids.iter().any(|id| !valid_stage_id(id)) {
        return Err("chat_asset_stage_invalid".into());
    }
    let mut state = ASSETS.lock().await;
    prune_expired_locked(&mut state, SystemTime::now());
    release_locked(&mut state, owner, stage_ids);
    Ok(())
}

pub(crate) async fn lock() -> tokio::sync::MutexGuard<'static, AssetState> {
    let mut state = ASSETS.lock().await;
    prune_expired_locked(&mut state, SystemTime::now());
    state
}
pub(crate) fn staged_budget(
    state: &AssetState,
    owner: &str,
    ids: &[String],
) -> Result<(usize, u64, u64)> {
    if ids.len() > 4 {
        return Err("chat_invalid_input".into());
    }
    let mut unique = HashSet::new();
    let (mut bytes, mut pixels) = (0u64, 0u64);
    for id in ids {
        if !valid_stage_id(id) || !unique.insert(id) {
            return Err("chat_asset_stage_invalid".into());
        }
        let stage = state
            .stages
            .get(id)
            .filter(|stage| stage.owner == owner)
            .ok_or_else(|| "chat_asset_stage_forbidden".to_string())?;
        bytes = bytes
            .checked_add(stage.byte_length)
            .ok_or_else(|| "chat_context_limit".to_string())?;
        pixels = pixels
            .checked_add(u64::from(stage.width) * u64::from(stage.height))
            .ok_or_else(|| "chat_context_limit".to_string())?;
    }
    validate_budget(ids.len(), bytes, pixels)?;
    Ok((ids.len(), bytes, pixels))
}
pub(crate) fn validate_budget(refs: usize, bytes: u64, pixels: u64) -> Result<()> {
    if refs > MAX_HISTORY_REFS || bytes > MAX_HISTORY_BYTES || pixels > MAX_HISTORY_PIXELS {
        Err("chat_context_limit".into())
    } else {
        Ok(())
    }
}
#[derive(Default)]
pub(crate) struct PublishedObjects {
    paths: Vec<PathBuf>,
    committed: bool,
}
impl PublishedObjects {
    pub(crate) fn commit(mut self) {
        self.committed = true;
    }
}
impl Drop for PublishedObjects {
    fn drop(&mut self) {
        if !self.committed {
            for path in self.paths.iter().rev() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}
/// Caller holds the asset guard from before its DB transaction starts through commit/rollback.
pub(crate) async fn promote(
    state: &AssetState,
    tx: &mut Transaction<'_, Sqlite>,
    owner: &str,
    message_id: &str,
    stage_ids: &[String],
) -> Result<PublishedObjects> {
    if stage_ids.len() > 4 {
        return Err("chat_invalid_input".into());
    }
    let mut unique = HashSet::new();
    let stages: Vec<Stage> = stage_ids
        .iter()
        .map(|id| {
            if !valid_stage_id(id) || !unique.insert(id) {
                return Err("chat_asset_stage_invalid".into());
            }
            state
                .stages
                .get(id)
                .filter(|s| s.owner == owner)
                .cloned()
                .ok_or_else(|| "chat_asset_stage_forbidden".to_string())
        })
        .collect::<Result<_>>()?;
    let root = root()?;
    let (_, objects, _) = dirs(&root)?;
    let mut published = PublishedObjects::default();
    for (ordinal, stage) in stages.iter().enumerate() {
        let relpath = format!("objects/{}", stage.asset_id);
        let object = objects.join(&stage.asset_id);
        let metadata_exists: i64 =
            sqlx::query_scalar("SELECT count(*) FROM chat_assets WHERE asset_id=?")
                .bind(&stage.asset_id)
                .fetch_one(&mut **tx)
                .await
                .map_err(|_| "chat_storage".to_string())?;
        let object_valid = object.exists()
            && read_verified(&root, &stage.asset_id, &relpath, stage.byte_length as i64).is_ok();
        if !object_valid {
            // A poisoned content-addressed path must not block repair on platforms whose rename
            // cannot replace an existing file.
            if object.exists() {
                std::fs::remove_file(&object).map_err(|_| "chat_asset_storage".to_string())?;
            }
            let temp = objects.join(format!(".{}.{}.tmp", stage.asset_id, uuid::Uuid::new_v4()));
            let mut source =
                std::fs::File::open(&stage.path).map_err(|_| "chat_asset_storage".to_string())?;
            let mut target =
                std::fs::File::create(&temp).map_err(|_| "chat_asset_storage".to_string())?;
            std::io::copy(&mut source, &mut target)
                .and_then(|_| target.sync_all())
                .map_err(|_| "chat_asset_storage".to_string())?;
            if durable_rename(&temp, &object).is_err() {
                let _ = std::fs::remove_file(&temp);
                // rename may have succeeded before a directory fsync failed.
                let _ = std::fs::remove_file(&object);
                return Err("chat_asset_storage".into());
            }
            if metadata_exists == 0 {
                published.paths.push(object.clone());
            }
        }
        sqlx::query("INSERT OR IGNORE INTO chat_assets(asset_id,media_type,byte_length,width,height,storage_relpath,created_at) VALUES(?,?,?,?,?,?,?)")
            .bind(&stage.asset_id).bind(&stage.media_type).bind(stage.byte_length as i64).bind(i64::from(stage.width)).bind(i64::from(stage.height)).bind(relpath).bind(now())
            .execute(&mut **tx).await.map_err(|_| "chat_storage".to_string())?;
        sqlx::query("INSERT INTO chat_message_assets(message_id,ordinal,asset_id) VALUES(?,?,?)")
            .bind(message_id)
            .bind(ordinal as i64)
            .bind(&stage.asset_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| "chat_storage".to_string())?;
    }
    Ok(published)
}

pub(crate) fn consume_locked(state: &mut AssetState, stage_ids: &[String]) {
    for id in stage_ids {
        if let Some(stage) = state.stages.remove(id) {
            let _ = std::fs::remove_file(stage.path);
        }
    }
}
pub(crate) fn trash_objects_locked(asset_ids: &[String]) -> Result<Vec<(PathBuf, PathBuf)>> {
    let root = root()?;
    let (_, objects, trash) = dirs(&root)?;
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for id in asset_ids {
        let source = objects.join(id);
        let target = trash.join(id);
        if source.exists() {
            if durable_rename(&source, &target).is_err() {
                if target.exists() {
                    let _ = durable_rename(&target, &source);
                }
                for (source, target) in moved.iter().rev() {
                    let _ = durable_rename(target, source);
                }
                return Err("chat_asset_storage".into());
            }
            moved.push((source, target));
        }
    }
    Ok(moved)
}
pub(crate) fn restore_trash_locked(moved: &[(PathBuf, PathBuf)]) {
    for (source, target) in moved.iter().rev() {
        let _ = durable_rename(target, source);
    }
}
pub(crate) fn purge_trash_locked(moved: &[(PathBuf, PathBuf)]) {
    for (_, target) in moved {
        let _ = std::fs::remove_file(target);
    }
}

fn descriptor_rows(rows: Vec<sqlx::sqlite::SqliteRow>) -> Result<Vec<AssetDescriptor>> {
    rows.into_iter()
        .map(|row| {
            Ok(AssetDescriptor {
                asset_id: row
                    .try_get("asset_id")
                    .map_err(|_| "chat_storage".to_string())?,
                media_type: row
                    .try_get("media_type")
                    .map_err(|_| "chat_storage".to_string())?,
                byte_length: row
                    .try_get("byte_length")
                    .map_err(|_| "chat_storage".to_string())?,
                width: row
                    .try_get("width")
                    .map_err(|_| "chat_storage".to_string())?,
                height: row
                    .try_get("height")
                    .map_err(|_| "chat_storage".to_string())?,
                ordinal: row
                    .try_get("ordinal")
                    .map_err(|_| "chat_storage".to_string())?,
                display_name: row
                    .try_get("display_name")
                    .map_err(|_| "chat_storage".to_string())?,
            })
        })
        .collect()
}
pub(crate) async fn attach_descriptors_tx(
    tx: &mut Transaction<'_, Sqlite>,
    messages: &mut [Message],
) -> Result<()> {
    for message in messages {
        let rows = sqlx::query("SELECT a.asset_id,a.media_type,a.byte_length,a.width,a.height,ma.ordinal,ma.display_name FROM chat_message_assets ma JOIN chat_assets a ON a.asset_id=ma.asset_id WHERE ma.message_id=? ORDER BY ma.ordinal")
            .bind(&message.id).fetch_all(&mut **tx).await.map_err(|_| "chat_storage".to_string())?;
        message.assets = descriptor_rows(rows)?;
    }
    Ok(())
}

fn read_verified(root: &Path, asset_id: &str, rel: &str, byte_length: i64) -> Result<Vec<u8>> {
    let canonical = format!("objects/{asset_id}");
    if rel != canonical || byte_length <= 0 || byte_length as usize > MAX_ASSET_BYTES {
        return Err("chat_asset_corrupt".into());
    }
    let data =
        std::fs::read(root.join(&canonical)).map_err(|_| "chat_asset_corrupt".to_string())?;
    if data.len() != byte_length as usize || format!("{:x}", Sha256::digest(&data)) != asset_id {
        return Err("chat_asset_corrupt".into());
    }
    Ok(data)
}

pub(crate) fn validate_history(history: &[Message]) -> Result<()> {
    let (mut refs, mut bytes, mut pixels) = (0usize, 0u64, 0u64);
    for asset in history
        .iter()
        .filter(|m| m.role == "user")
        .flat_map(|m| &m.assets)
    {
        refs += 1;
        bytes = bytes
            .checked_add(asset.byte_length as u64)
            .ok_or_else(|| "chat_context_limit".to_string())?;
        pixels = pixels
            .checked_add((asset.width as u64) * (asset.height as u64))
            .ok_or_else(|| "chat_context_limit".to_string())?;
    }
    validate_budget(refs, bytes, pixels)
}

fn images_from_history(history: &[Message]) -> Result<HashMap<String, Vec<String>>> {
    validate_history(history)?;
    let root = root()?;
    let mut out = HashMap::new();
    for message in history.iter().filter(|m| m.role == "user") {
        let mut images = Vec::new();
        for asset in &message.assets {
            let rel = format!("objects/{}", asset.asset_id);
            let data = read_verified(&root, &asset.asset_id, &rel, asset.byte_length)?;
            images.push(format!(
                "data:{};base64,{}",
                asset.media_type,
                base64::engine::general_purpose::STANDARD.encode(data)
            ));
        }
        if !images.is_empty() {
            out.insert(message.id.clone(), images);
        }
    }
    Ok(out)
}
pub async fn provider_images(
    _pool: &sqlx::SqlitePool,
    history: &[Message],
) -> Result<HashMap<String, Vec<String>>> {
    images_from_history(history)
}

fn origin_allowed(origin: &str, required_origin: Option<&str>) -> bool {
    required_origin.is_none_or(|required| origin == required)
}

pub async fn read_exact(
    pool: &sqlx::SqlitePool,
    conversation: &str,
    message: &str,
    ordinal: i64,
    asset: &str,
    required_origin: Option<&str>,
) -> Result<Vec<u8>> {
    super::types::uuid(conversation)?;
    super::types::uuid(message)?;
    if ordinal < 0
        || ordinal >= 4
        || asset.len() != 64
        || !asset
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(super::types::invalid());
    }
    let row = sqlx::query("SELECT a.storage_relpath,a.byte_length,c.origin FROM chat_message_assets ma JOIN chat_messages m ON m.id=ma.message_id JOIN chat_conversations c ON c.id=m.conversation_id JOIN chat_assets a ON a.asset_id=ma.asset_id WHERE m.conversation_id=? AND m.id=? AND ma.ordinal=? AND a.asset_id=?")
        .bind(conversation).bind(message).bind(ordinal).bind(asset).fetch_optional(pool).await.map_err(|_| "chat_storage".to_string())?.ok_or_else(|| "chat_asset_not_found".to_string())?;
    let origin: String = row
        .try_get("origin")
        .map_err(|_| "chat_storage".to_string())?;
    if !origin_allowed(&origin, required_origin) {
        return Err("chat_asset_forbidden".into());
    }
    let rel: String = row
        .try_get("storage_relpath")
        .map_err(|_| "chat_storage".to_string())?;
    let len: i64 = row
        .try_get("byte_length")
        .map_err(|_| "chat_storage".to_string())?;
    read_verified(&root()?, asset, &rel, len)
}

pub async fn reconcile(pool: &sqlx::SqlitePool) -> Result<()> {
    let mut state = ASSETS.lock().await;
    prune_expired_locked(&mut state, SystemTime::now());
    let root = root()?;
    let (staging, objects, trash) = dirs(&root)?;
    let live_stages: HashSet<PathBuf> = state.stages.values().map(|s| s.path.clone()).collect();
    for entry in std::fs::read_dir(&staging).map_err(|_| "chat_asset_storage".to_string())? {
        let path = entry.map_err(|_| "chat_asset_storage".to_string())?.path();
        if !live_stages.contains(&path) {
            std::fs::remove_file(path).map_err(|_| "chat_asset_storage".to_string())?;
        }
    }
    sqlx::query("DELETE FROM chat_assets WHERE NOT EXISTS (SELECT 1 FROM chat_message_assets ma WHERE ma.asset_id=chat_assets.asset_id)").execute(pool).await.map_err(|_| "chat_storage".to_string())?;
    let rows = sqlx::query("SELECT asset_id,storage_relpath,byte_length FROM chat_assets")
        .fetch_all(pool)
        .await
        .map_err(|_| "chat_storage".to_string())?;
    let mut known = HashSet::new();
    let mut metadata = Vec::new();
    for row in rows {
        let id: String = row
            .try_get("asset_id")
            .map_err(|_| "chat_storage".to_string())?;
        let rel: String = row
            .try_get("storage_relpath")
            .map_err(|_| "chat_storage".to_string())?;
        let len: i64 = row
            .try_get("byte_length")
            .map_err(|_| "chat_storage".to_string())?;
        known.insert(id.clone());
        metadata.push((id, rel, len));
    }
    for entry in std::fs::read_dir(&trash).map_err(|_| "chat_asset_storage".to_string())? {
        let entry = entry.map_err(|_| "chat_asset_storage".to_string())?;
        let id = entry.file_name().to_string_lossy().to_string();
        if known.contains(&id) && !objects.join(&id).exists() {
            durable_rename(&entry.path(), &objects.join(id))
                .map_err(|_| "chat_asset_storage".to_string())?;
        } else {
            std::fs::remove_file(entry.path()).map_err(|_| "chat_asset_storage".to_string())?;
        }
    }
    for (id, rel, len) in metadata {
        if let Err(error) = read_verified(&root, &id, &rel, len) {
            // Referenced metadata is intentionally retained: initialization must remain usable,
            // while reads/provider construction surface the stable corruption error.
            log::error!("chat asset corruption: asset_id={id} error={error}");
        }
    }
    for entry in std::fs::read_dir(objects).map_err(|_| "chat_asset_storage".to_string())? {
        let entry = entry.map_err(|_| "chat_asset_storage".to_string())?;
        if !known.contains(&entry.file_name().to_string_lossy().to_string()) {
            std::fs::remove_file(entry.path()).map_err(|_| "chat_asset_storage".to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn encoded(format: image::ImageFormat) -> Vec<u8> {
        let image = image::DynamicImage::new_rgba8(2, 3);
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }
    #[test]
    fn asset_owner_allows_chat_windows_and_rejects_other_labels() {
        let main = owner_for_label("main").unwrap();
        assert_eq!(owner_for_label("quick-chat").unwrap(), main);
        assert_eq!(
            owner_for_label("settings").unwrap_err(),
            "chat_asset_forbidden"
        );
    }
    #[test]
    fn validates_exact_static_formats_and_rejects_trailing_or_animation() {
        assert_eq!(inspect(b"not an image").unwrap_err(), "chat_asset_format");
        for (format, media) in [
            (image::ImageFormat::Png, "image/png"),
            (image::ImageFormat::Jpeg, "image/jpeg"),
            (image::ImageFormat::WebP, "image/webp"),
        ] {
            let bytes = encoded(format);
            let (got, w, h, id) = inspect(&bytes).unwrap();
            assert_eq!((got.as_str(), w, h), (media, 2, 3));
            assert_eq!(id.len(), 64);
            let mut trailing = bytes;
            trailing.extend_from_slice(&[0, 0xff, 0xd9]);
            assert_eq!(inspect(&trailing).unwrap_err(), "chat_asset_decode");
        }
        let mut png = encoded(image::ImageFormat::Png);
        let iend = png.len() - 12;
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&8u32.to_be_bytes());
        chunk.extend_from_slice(b"acTL");
        chunk.extend_from_slice(&[0; 12]);
        png.splice(iend..iend, chunk);
        assert_eq!(inspect(&png).unwrap_err(), "chat_asset_animated");
    }
    #[test]
    fn stage_ids_match_the_frontend_uuid_schema() {
        assert!(valid_stage_id("123e4567-e89b-42d3-a456-426614174000"));
        assert!(!valid_stage_id("123e4567-e89b-02d3-a456-426614174000"));
        assert!(!valid_stage_id("123e4567-e89b-42d3-c456-426614174000"));
        assert!(!valid_stage_id("123e4567-e89b-42d3-a456-42661417400"));
    }
    #[test]
    fn expiry_prunes_active_entries_and_files_and_usage_is_owner_scoped() {
        let dir = tempfile::tempdir().unwrap();
        let expired_path = dir.path().join("expired.part");
        let live_path = dir.path().join("live.part");
        std::fs::write(&expired_path, b"old").unwrap();
        std::fs::write(&live_path, b"new").unwrap();
        let make = |owner: &str, path: PathBuf, bytes, created_at| Stage {
            owner: owner.into(),
            path,
            asset_id: "0".repeat(64),
            media_type: "image/png".into(),
            byte_length: bytes,
            width: 1,
            height: 1,
            created_at,
        };
        let now = std::time::UNIX_EPOCH + Duration::from_secs(2 * STAGE_TTL.as_secs());
        let mut state = AssetState::default();
        state.stages.insert(
            "expired".into(),
            make("a", expired_path.clone(), 10, now - STAGE_TTL),
        );
        state.stages.insert(
            "live".into(),
            make("a", live_path.clone(), 20, now - Duration::from_secs(1)),
        );
        state.stages.insert(
            "foreign".into(),
            make("b", dir.path().join("foreign"), 30, now),
        );
        prune_expired_locked(&mut state, now);
        assert!(!expired_path.exists());
        assert!(live_path.exists());
        assert_eq!(owner_usage(&state, "a"), (1, 20));
        assert_eq!(owner_usage(&state, "b"), (1, 30));
    }
    #[test]
    fn release_is_owner_bound_and_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let a_id = "123e4567-e89b-42d3-a456-426614174000".to_string();
        let b_id = "123e4567-e89b-42d3-a456-426614174001".to_string();
        let a_path = dir.path().join("a.part");
        let b_path = dir.path().join("b.part");
        std::fs::write(&a_path, b"a").unwrap();
        std::fs::write(&b_path, b"b").unwrap();
        let make = |owner: &str, path: PathBuf| Stage {
            owner: owner.into(),
            path,
            asset_id: "0".repeat(64),
            media_type: "image/png".into(),
            byte_length: 1,
            width: 1,
            height: 1,
            created_at: SystemTime::now(),
        };
        let mut state = AssetState::default();
        state
            .stages
            .insert(a_id.clone(), make("owner-a", a_path.clone()));
        state
            .stages
            .insert(b_id.clone(), make("owner-b", b_path.clone()));
        release_locked(&mut state, "owner-a", &[a_id.clone(), b_id.clone()]);
        assert!(!state.stages.contains_key(&a_id));
        assert!(!a_path.exists());
        assert!(state.stages.contains_key(&b_id));
        assert!(b_path.exists());
        release_locked(&mut state, "owner-a", &[a_id]);
        assert!(state.stages.contains_key(&b_id));
    }
    #[test]
    fn quick_asset_reads_are_origin_scoped_while_main_reads_all_origins() {
        assert!(origin_allowed("quick-chat", Some("quick-chat")));
        assert!(!origin_allowed("workspace", Some("quick-chat")));
        assert!(!origin_allowed("sidebar", Some("quick-chat")));
        assert!(origin_allowed("workspace", None));
        assert!(origin_allowed("quick-chat", None));
    }
    #[test]
    fn corrupt_and_missing_objects_return_the_stable_corruption_error() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"expected";
        let id = format!("{:x}", Sha256::digest(bytes));
        std::fs::create_dir(dir.path().join("objects")).unwrap();
        assert_eq!(
            read_verified(
                dir.path(),
                &id,
                &format!("objects/{id}"),
                bytes.len() as i64
            )
            .unwrap_err(),
            "chat_asset_corrupt"
        );
        std::fs::write(dir.path().join("objects").join(&id), b"damaged").unwrap();
        assert_eq!(
            read_verified(
                dir.path(),
                &id,
                &format!("objects/{id}"),
                bytes.len() as i64
            )
            .unwrap_err(),
            "chat_asset_corrupt"
        );
    }
    #[test]
    fn rejects_history_over_aggregate_reference_and_pixel_budgets_before_io() {
        let descriptor = AssetDescriptor {
            asset_id: "0".repeat(64),
            media_type: "image/png".into(),
            byte_length: 1,
            width: 3000,
            height: 4000,
            ordinal: 0,
            display_name: None,
        };
        let message = |id: usize, count: usize| Message {
            id: id.to_string(),
            conversation_id: "c".into(),
            ordinal: id as i64,
            role: "user".into(),
            content: String::new(),
            reply_to: None,
            request_id: "r".into(),
            status: "completed".into(),
            error_code: None,
            finish_reason: None,
            app_type: "chat".into(),
            provider_id: "p".into(),
            model: "m".into(),
            created_at: 0,
            updated_at: 0,
            assets: vec![descriptor.clone(); count],
        };
        assert_eq!(
            validate_history(&[message(1, 17)]).unwrap_err(),
            "chat_context_limit"
        );
        assert_eq!(
            validate_history(&[message(1, 4), message(2, 1)]).unwrap_err(),
            "chat_context_limit"
        );
    }
}
