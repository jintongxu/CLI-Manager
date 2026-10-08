//! Exact, expiring cleanup scope. Validation never replaces a token or grants wider scope.
pub use super::artifact_classify::{ArtifactCandidate, CleanupBlocker};
use super::*;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
const RULE_VERSION: u32 = 1;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPlan {
    pub token: String,
    pub rule_version: u32,
    pub request: FinishRequest,
    pub delete_branch: bool,
    pub source_oid: String,
    pub base_oid: String,
    pub phase: String,
    pub candidates: Vec<ArtifactCandidate>,
    pub preserved: Vec<CleanupBlocker>,
    pub blocker: Option<String>,
    pub provenance_notice: String,
    pub expires_in_seconds: u64,
    pub admission_scope: String,
    pub session_ids: Vec<String>,
    pub admission_acquired: bool,
}
#[derive(Clone)]
struct Authorization {
    plan: CleanupPlan,
    root: Option<String>,
    project: String,
    common: String,
    registration: String,
    git_scope: String,
    ordinary: Option<receipt::Ownership>,
    candidate_identities: Vec<String>,
    issued: Instant,
}
static PLANS: OnceLock<Mutex<HashMap<String, Authorization>>> = OnceLock::new();
fn plans() -> &'static Mutex<HashMap<String, Authorization>> {
    PLANS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn git_scope(ctx: &Context) -> Result<String, String> {
    // Hash Git's actual ignored/untracked/tracked view; changes to rules or tracking that
    // change scope invalidate the original token, without scanning candidate contents.
    let mut hash = Sha256::new();
    for args in [
        vec!["ls-files", "-z", "--stage"],
        vec!["ls-files", "-z", "--others", "--exclude-standard"],
        vec![
            "ls-files",
            "-z",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
    ] {
        hash.update(run_git_checked(&ctx.target, args)?.as_bytes());
    }
    // Explicit rule bytes capture changes even when the current classification is unchanged.
    for path in [
        ctx.common.join("info/exclude"),
        ctx.target.join(".gitignore"),
    ] {
        if let Some(m) = worktree_root_metadata(&path)? {
            if receipt::unsafe_link(&m) || !m.is_file() || m.len() > 1024 * 1024 {
                return Err("finish_ignore_rules_invalid".into());
            }
            hash.update(fs::read(path).map_err(|e| format!("finish_ignore_rules_failed: {e}"))?);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn base(ctx: &Context) -> Result<String, String> {
    Ok(run_git_checked(
        &ctx.project,
        [
            "rev-parse",
            "--verify",
            &format!("refs/heads/{}", ctx.request.base_branch),
        ],
    )?
    .trim()
    .into())
}
fn registration(ctx: &Context) -> Result<String, String> {
    run_git_checked(&ctx.project, ["worktree", "list", "--porcelain"])
}
fn preflight(ctx: &Context, delete_branch: bool) -> Result<Authorization, String> {
    force_delete::ensure_scoped_prune(ctx)?;
    let state = inspect(ctx)?;
    if let Some(error) = state.blocker {
        return Err(error);
    }
    if state.outcome.is_none() {
        return Err("finish_merge_not_confirmed".into());
    }
    let r = load(ctx)?;
    let root = worktree_root_metadata(&ctx.target)?
        .map(|_| receipt::root_identity(&ctx.target))
        .transpose()?;
    let recovering = r.as_ref().is_some_and(|r| {
        matches!(
            r.phase.as_str(),
            "cleanup_intent" | "branch_intent" | "done"
        )
    });
    let classification = if recovering {
        // Inspection verified original ownership; never classify/adopt partial residuals.
        artifact_classify::Classification {
            candidates: vec![],
            preserved: vec![],
            provenance_notice: "finish_self_temp_provenance_missing".into(),
        }
    } else if state.checkout_valid {
        if let Some(m) = r.as_ref().and_then(|r| r.artifacts.as_ref()) {
            artifact_classify::classify_owned(ctx, &m.roots)?
        } else {
            artifact_classify::classify(ctx)?
        }
    } else {
        if root.is_some() && r.as_ref().is_none_or(|r| r.ownership.is_none()) {
            return Err("finish_legacy_residual_manual_review".into());
        }
        artifact_classify::Classification {
            candidates: vec![],
            preserved: vec![],
            provenance_notice: "finish_self_temp_provenance_missing".into(),
        }
    };
    // Read-only ordinary evidence prevents a fresh confirmation from adopting a changed
    // root outside authorized caches. It is bounded independently of cache content.
    let roots: Vec<String> = classification
        .candidates
        .iter()
        .map(|c| c.path.clone())
        .collect();
    let ordinary = if recovering {
        None
    } else if state.checkout_valid && classification.preserved.is_empty() {
        Some(receipt::snapshot_excluding(&ctx.target, &roots)?)
    } else {
        None
    };
    let candidate_identities = classification
        .candidates
        .iter()
        .map(|c| receipt::root_identity(&local_path_from_input(&c.path)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Authorization {
        candidate_identities,
        plan: CleanupPlan {
            token: uuid::Uuid::new_v4().to_string(),
            rule_version: RULE_VERSION,
            request: ctx.request.clone(),
            delete_branch,
            source_oid: state.source_oid.ok_or("finish_unknown")?,
            base_oid: base(ctx)?,
            phase: state.phase,
            blocker: if classification.preserved.is_empty() {
                None
            } else {
                Some("finish_unknown_content_preserved".into())
            },
            candidates: classification.candidates,
            preserved: classification.preserved,
            provenance_notice: classification.provenance_notice,
            expires_in_seconds: 600,
            session_ids: Vec::new(),
            admission_acquired: false,
            admission_scope:
                "daemon-wide local PTY Create (all GUI windows/transports); not external processes"
                    .into(),
        },
        root,
        project: receipt::root_identity(&ctx.project)?,
        common: receipt::root_identity(&ctx.common)?,
        registration: registration(ctx)?,
        git_scope: if state.checkout_valid {
            git_scope(ctx)?
        } else {
            String::new()
        },
        ordinary,
        issued: Instant::now(),
    })
}
fn plan(ctx: &Context, delete_branch: bool) -> Result<CleanupPlan, String> {
    let authorization = preflight(ctx, delete_branch)?;
    let result = authorization.plan.clone();
    let mut plans = plans().lock().map_err(|_| "finish_plan_lock_failed")?;
    plans.retain(|_, p| p.issued.elapsed() < Duration::from_secs(600));
    if plans.len() >= 64 {
        return Err("finish_plan_limit".into());
    }
    plans.insert(result.token.clone(), authorization);
    Ok(result)
}
fn validate(ctx: &Context, delete_branch: bool, token: &str) -> Result<Authorization, String> {
    let original = plans()
        .lock()
        .map_err(|_| "finish_plan_lock_failed")?
        .get(token)
        .cloned()
        .ok_or("finish_plan_unknown")?;
    if original.issued.elapsed() >= Duration::from_secs(600) {
        return Err("finish_plan_expired".into());
    }
    if original.plan.request != ctx.request || original.plan.delete_branch != delete_branch {
        return Err("finish_plan_request_changed".into());
    }
    let current = preflight(ctx, delete_branch)?;
    if original.candidate_identities != current.candidate_identities
        || original.root != current.root
        || original.project != current.project
        || original.common != current.common
        || original.registration != current.registration
        || original.plan.source_oid != current.plan.source_oid
        || original.plan.base_oid != current.plan.base_oid
        || original.git_scope != current.git_scope
        || original.plan.candidates != current.plan.candidates
        || original.plan.preserved != current.plan.preserved
    {
        return Err("finish_plan_changed".into());
    }
    if let Some(blocker) = &original.plan.blocker {
        return Err(format!(
            "{blocker}: {}",
            original
                .plan
                .preserved
                .first()
                .map_or("", |p| p.path.as_str())
        ));
    }
    if let Some(owned) = &original.ordinary {
        let roots: Vec<String> = original
            .plan
            .candidates
            .iter()
            .map(|c| c.path.clone())
            .collect();
        receipt::verify_subset_excluding(&ctx.target, owned, &roots)?;
    }
    Ok(original)
}
#[cfg(test)]
fn execute(ctx: &Context, delete_branch: bool, token: &str) -> Result<FinishState, String> {
    execute_guarded(ctx, delete_branch, token, || Ok(()))
}
#[cfg(test)]
thread_local! { static BEFORE_OWNERSHIP: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = std::cell::RefCell::new(None); }
fn execute_guarded<F: FnMut() -> Result<(), String>>(
    ctx: &Context,
    delete_branch: bool,
    token: &str,
    mut guard: F,
) -> Result<FinishState, String> {
    let started = Instant::now();
    guard()?;
    let authorization = validate(ctx, delete_branch, token)?;
    let valid = checkout_valid(ctx)?;
    let existing = load(ctx)?;
    // New ownership is forbidden once any previous delete intent was published.
    let needs_prepare = existing.as_ref().is_none_or(|r| r.phase == "merged");
    if needs_prepare && valid {
        let mut r =
            existing.unwrap_or_else(|| new_receipt(ctx, authorization.plan.source_oid.clone()));
        if r.outcome.is_none() {
            r.outcome = historical_outcome(ctx, &r.source_oid)?;
            r.base_oid = Some(base(ctx)?);
            r.phase = "merged".into();
        }
        cleanup_gate(ctx, &r, valid)?;
        let roots: Vec<String> = authorization
            .plan
            .candidates
            .iter()
            .map(|c| c.path.clone())
            .collect();
        let manifest = if roots.is_empty() {
            None
        } else {
            Some(artifact_manifest::prepare(
                ctx,
                &roots,
                artifact_manifest::Budgets::default(),
            )?)
        };
        // Recheck the exact same plan after potentially long hashing and before publication.
        validate(ctx, delete_branch, token)?;
        if let Some(m) = &manifest {
            artifact_manifest::verify_with_limits(
                ctx,
                m,
                artifact_manifest::Budgets {
                    time: Duration::from_secs(600).saturating_sub(started.elapsed()),
                    ..Default::default()
                },
            )?;
        }
        #[cfg(test)]
        BEFORE_OWNERSHIP.with(|hook| {
            if let Some(action) = hook.borrow_mut().take() {
                action();
            }
        });
        // Never replace confirmed ordinary evidence with a later, freshly adopted
        // snapshot. Hashing/verification may have taken minutes since validation.
        let original = authorization
            .ordinary
            .as_ref()
            .ok_or("finish_plan_changed")?;
        receipt::verify_subset_excluding(&ctx.target, original, &roots)?;
        r.ownership = Some(original.clone());
        r.artifacts = manifest;
        r.version = 2;
        r.delete_branch = Some(delete_branch);
        r.phase = "cleanup_intent".into();
        if started.elapsed() > Duration::from_secs(600) {
            return Err("finish_artifact_budget: time".into());
        }
        guard()?;
        // Last scope/unknown/native-subset check immediately before durable intent.
        validate(ctx, delete_branch, token)?;
        ctx.journal.save(&r)?;
    }
    plans()
        .lock()
        .map_err(|_| "finish_plan_lock_failed")?
        .remove(token);
    guard()?;
    let source = authorization.plan.source_oid.clone();
    let expected_base = authorization.plan.base_oid.clone();
    cleanup_guarded(
        ctx,
        delete_branch,
        |ctx| {
            run_git_worktree_remove_with_retry(&ctx.project, &path_to_git_arg(&ctx.target))
                .map(|_| ())
        },
        || {
            guard()?;
            if tip(ctx)?.is_some_and(|oid| oid != source) {
                return Err("finish_source_changed".into());
            }
            if base(ctx)? != expected_base {
                return Err("finish_base_changed".into());
            }
            if let Some(r) = load(ctx)? {
                cleanup_gate(ctx, &r, checkout_valid(ctx)?)?;
            }
            Ok(())
        },
    )
}
fn daemon(
    bridge: &crate::daemon::client::DaemonBridge,
) -> Result<std::sync::Arc<crate::daemon::client::DaemonClient>, String> {
    let client = bridge.get().ok_or("finish_admission_daemon_unavailable")?;
    if !client
        .info()
        .features
        .iter()
        .any(|f| f == crate::daemon::protocol::FEATURE_WORKTREE_ADMISSION)
    {
        return Err("finish_admission_feature_missing".into());
    }
    Ok(client)
}
fn fence(
    client: &crate::daemon::client::DaemonClient,
    path: &str,
    token: &str,
    action: &str,
) -> Result<(), String> {
    use crate::daemon::protocol::{ClientFrame, DaemonFrame};
    let id = client.next_request_id();
    match client.request(
        id,
        &ClientFrame::WorktreeAdmission {
            id,
            path: path.into(),
            token: token.into(),
            action: action.into(),
        },
    )? {
        DaemonFrame::Ok { .. } => Ok(()),
        DaemonFrame::Err { message, .. } => Err(message),
        _ => Err("finish_admission_reply_invalid".into()),
    }
}
fn sessions(
    client: &crate::daemon::client::DaemonClient,
    ctx: &Context,
) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for session in client.list()? {
        if session.alive
            && crate::daemon::worktree_admission::associated_cwd(
                &ctx.request.worktree_path,
                session.cwd.as_deref(),
            )?
        {
            result.push(session.session_id);
        }
    }
    result.sort();
    Ok(result)
}
pub(super) fn legacy_cleanup(
    ctx: &Context,
    delete_branch: bool,
    client: &crate::daemon::client::DaemonClient,
) -> Result<FinishState, String> {
    if !client
        .info()
        .features
        .iter()
        .any(|f| f == crate::daemon::protocol::FEATURE_WORKTREE_ADMISSION)
    {
        return Err("finish_admission_feature_missing".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    fence(client, &ctx.request.worktree_path, &token, "acquire")?;
    let result = (|| {
        if !sessions(client, ctx)?.is_empty() {
            return Err("finish_sessions_still_active".into());
        }
        cleanup(ctx, delete_branch)
    })();
    let release = fence(client, &ctx.request.worktree_path, &token, "release");
    match result {
        Err(e) => Err(e),
        Ok(state) => {
            release?;
            Ok(state)
        }
    }
}
#[tauri::command]
pub async fn git_worktree_finish_cleanup_plan(
    req: FinishRequest,
    delete_branch: bool,
    daemon_bridge: tauri::State<'_, crate::daemon::client::DaemonBridge>,
) -> Result<CleanupPlan, String> {
    let client = daemon(&daemon_bridge)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        let ctx = context(req)?;
        let mut result = plan(&ctx, delete_branch)?;
        result.session_ids = sessions(&client, &ctx)?;
        if let Some(a) = plans()
            .lock()
            .map_err(|_| "finish_plan_lock_failed")?
            .get_mut(&result.token)
        {
            a.plan.session_ids = result.session_ids.clone();
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
#[tauri::command]
pub async fn git_worktree_finish_cleanup_validate(
    req: FinishRequest,
    delete_branch: bool,
    token: String,
    daemon_bridge: tauri::State<'_, crate::daemon::client::DaemonBridge>,
) -> Result<CleanupPlan, String> {
    let client = daemon(&daemon_bridge)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        let ctx = context(req)?;
        let mut a = validate(&ctx, delete_branch, &token)?;
        fence(&client, &ctx.request.worktree_path, &token, "acquire")?;
        let check = (|| {
            let now = sessions(&client, &ctx)?;
            if now.iter().any(|id| !a.plan.session_ids.contains(id)) {
                return Err("finish_sessions_changed".into());
            }
            a.plan.admission_acquired = true;
            Ok(a.plan)
        })();
        if check.is_err() {
            let _ = fence(&client, &ctx.request.worktree_path, &token, "release");
        }
        check
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
#[tauri::command]
pub async fn git_worktree_finish_cleanup_confirmed(
    req: FinishRequest,
    delete_branch: bool,
    token: String,
    daemon_bridge: tauri::State<'_, crate::daemon::client::DaemonBridge>,
) -> Result<FinishState, String> {
    let client = daemon(&daemon_bridge)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        let ctx = context(req)?;
        fence(&client, &ctx.request.worktree_path, &token, "check")?;
        let result = (|| {
            validate(&ctx, delete_branch, &token)?;
            if !sessions(&client, &ctx)?.is_empty() {
                return Err("finish_sessions_still_active".into());
            }
            execute_guarded(&ctx, delete_branch, &token, || {
                fence(&client, &ctx.request.worktree_path, &token, "check")?;
                if !sessions(&client, &ctx)?.is_empty() {
                    return Err("finish_sessions_still_active".into());
                }
                Ok(())
            })
        })();
        let release = fence(&client, &ctx.request.worktree_path, &token, "release");
        match result {
            Err(e) => Err(e),
            Ok(state) => {
                release?;
                Ok(state)
            }
        }
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
// Cancel exact request-bound authorization even if the daemon is unavailable.
fn cancel(ctx: &Context, token: &str) -> Result<(), String> {
    let mut plans = plans().lock().map_err(|_| "finish_plan_lock_failed")?;
    if let Some(a) = plans.get(token) {
        if a.plan.request != ctx.request {
            return Err("finish_plan_request_changed".into());
        }
        plans.remove(token);
    }
    Ok(())
}
#[tauri::command]
pub async fn git_worktree_finish_cleanup_release(
    req: FinishRequest,
    token: String,
    daemon_bridge: tauri::State<'_, crate::daemon::client::DaemonBridge>,
) -> Result<(), String> {
    {
        let _lock = acquire_worktree_merge_lock()?;
        cancel(&context(req.clone())?, &token)?;
    }
    let client = daemon(&daemon_bridge)?;
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        fence(&client, &req.worktree_path, &token, "release")
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
#[cfg(test)]
#[path = "finish_artifact_tests.rs"]
mod tests;
