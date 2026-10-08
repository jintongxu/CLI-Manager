//! Rust-owned finish authority. Inspect is read-only; merge, cleanup and ack are journaled.
use super::*;
#[path = "force_delete.rs"]
pub mod force_delete;
#[path = "finish_receipt.rs"]
mod receipt;
use receipt::{Journal, Receipt};
#[path = "finish_artifact_classify.rs"]
mod artifact_classify;
#[path = "finish_artifact_manifest.rs"]
mod artifact_manifest;
#[path = "finish_cleanup_plan.rs"]
pub mod cleanup_plan;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinishRequest {
    pub worktree_id: String,
    pub project_path: String,
    pub worktree_path: String,
    pub branch: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishState {
    pub checkout_valid: bool,
    pub merged: bool,
    pub outcome: Option<String>,
    pub source_oid: Option<String>,
    pub cleanup_ready: bool,
    pub cleanup_pending: bool,
    pub blocker: Option<String>,
    pub unknown: bool,
    pub done: bool,
    pub stash_reference: Option<String>,
    pub merge_result: Option<GitWorktreeMergeResult>,
    pub phase: String,
    pub cleanup_plan_required: bool,
}

struct Context {
    request: FinishRequest,
    project: PathBuf,
    target: PathBuf,
    common: PathBuf,
    journal: Journal,
}

// 绑定调用方项目 checkout 和 common Git 管理目录；禁止目标路径越界或经过链接。
fn context(mut req: FinishRequest) -> Result<Context, String> {
    validate_worktree_branch(&req.branch)?;
    validate_plain_branch_name(&req.base_branch)?;
    if req.branch == req.base_branch {
        return Err("finish_source_equals_base".into());
    }
    ensure_supported_local_path(&req.worktree_path)?;
    // Projects may themselves be valid linked checkouts. Keep the requested
    // checkout as the merge target, as validate/create and ordinary merge do.
    open_main_repo(&req.project_path)?;
    let project = local_path_from_input(&req.project_path)
        .canonicalize()
        .map_err(|e| format!("finish_project_path_failed: {e}"))?;
    let common_arg = run_git_checked(
        &project,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let common = local_path_from_input(common_arg.trim())
        .canonicalize()
        .map_err(|e| format!("finish_common_path_failed: {e}"))?;
    let target = local_path_from_input(&req.worktree_path);
    if !target.is_absolute() {
        return Err("worktree_path_not_absolute".into());
    }
    // Reject traversal and links in every extant component, even when the leaf is absent.
    for component in target.components() {
        if matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        ) {
            return Err("finish_unsafe_path".into());
        }
    }
    let mut cursor = PathBuf::new();
    for component in target.components() {
        cursor.push(component.as_os_str());
        if let Some(meta) = worktree_root_metadata(&cursor)? {
            if receipt::unsafe_link(&meta) {
                return Err("finish_unsafe_link".into());
            }
        }
    }
    let target = match worktree_root_metadata(&target)? {
        Some(_) => target
            .canonicalize()
            .map_err(|e| format!("finish_path_failed: {e}"))?,
        None => {
            // Normalize the longest existing ancestor without swallowing I/O errors.
            let mut ancestor = target.clone();
            let mut tail = Vec::new();
            while worktree_root_metadata(&ancestor)?.is_none() {
                tail.push(
                    ancestor
                        .file_name()
                        .ok_or("finish_unsafe_path")?
                        .to_os_string(),
                );
                ancestor = ancestor.parent().ok_or("finish_unsafe_path")?.to_path_buf();
            }
            let mut normalized = ancestor
                .canonicalize()
                .map_err(|e| format!("finish_path_failed: {e}"))?;
            for part in tail.into_iter().rev() {
                normalized.push(part);
            }
            normalized
        }
    };
    let target_cmp = normalize_path_for_compare(&target);
    let registrations = parse_worktree_list_entries(&run_git_checked(
        &project,
        ["worktree", "list", "--porcelain"],
    )?);
    if registrations.iter().any(|entry| {
        normalize_path_for_compare(&entry.path).starts_with(&(target_cmp.clone() + "/"))
    }) {
        return Err("finish_contains_other_worktree".into());
    }
    let protected = [&project, &common];
    for path in protected {
        let p = normalize_path_for_compare(path);
        if target_cmp == p
            || p.starts_with(&(target_cmp.clone() + "/"))
            || target_cmp.starts_with(&(p + "/"))
        {
            return Err("finish_protected_path".into());
        }
    }
    req.project_path = path_to_git_arg(&project);
    req.worktree_path = path_to_git_arg(&target);
    let journal = Journal::new(&common, &req.worktree_id)?;
    Ok(Context {
        request: req,
        project,
        target,
        common,
        journal,
    })
}

// 仅可信普通合并意图允许按当前祖先证据恢复；stash/阻塞阶段不能推断已完成。
fn load(ctx: &Context) -> Result<Option<Receipt>, String> {
    let mut receipt = ctx.journal.load()?;
    if let Some(r) = &receipt {
        if r.request != ctx.request || r.repo != path_to_git_arg(&ctx.common) {
            return Err("finish_receipt_identity_mismatch".into());
        }
    }
    // A normal merge can finish before its completion record is flushed. Only a
    // trusted intent and current source ancestry can recover it; stash intents
    // and any durable restore blocker are deliberately never cleared here.
    if let Some(r) = &mut receipt {
        if r.phase == "merge_intent"
            && r.blocker.is_none()
            && r.outcome.is_none()
            && r.stash_reference.is_none()
            && tip(ctx)?.as_deref() == Some(&r.source_oid)
            && historical_outcome(ctx, &r.source_oid)?.is_some()
        {
            r.outcome = Some("merged".into());
            r.base_oid = Some(
                run_git_checked(
                    &ctx.project,
                    [
                        "rev-parse",
                        &format!("refs/heads/{}", ctx.request.base_branch),
                    ],
                )?
                .trim()
                .into(),
            );
            r.phase = "merged".into();
        }
    }
    Ok(receipt)
}

fn tip(ctx: &Context) -> Result<Option<String>, String> {
    if !branch_exists(&ctx.project, &ctx.request.branch)? {
        return Ok(None);
    }
    Ok(Some(
        run_git_checked(
            &ctx.project,
            [
                "rev-parse",
                "--verify",
                &format!("refs/heads/{}", ctx.request.branch),
            ],
        )?
        .trim()
        .into(),
    ))
}

// 登记、分支、Git 指针和真实仓库根必须同时匹配，不能接受向上发现的其它仓库。
fn checkout_valid(ctx: &Context) -> Result<bool, String> {
    match worktree_registration(&ctx.project, &ctx.target, &ctx.request.branch)? {
        WorktreeRegistration::Mismatched => return Err("worktree_branch_mismatch".into()),
        WorktreeRegistration::Missing => return Ok(false),
        WorktreeRegistration::Matched => {}
    }
    if worktree_root_metadata(&ctx.target)?.is_none() {
        return Ok(false);
    }
    let git_file = ctx.target.join(".git");
    let Some(meta) = worktree_root_metadata(&git_file)? else {
        return Ok(false);
    };
    if receipt::unsafe_link(&meta) || !meta.is_file() {
        return Err("finish_checkout_git_invalid".into());
    }
    let common_result = run_git_raw(
        &ctx.target,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    if !common_result.success {
        return Ok(false);
    }
    let common = common_result.stdout;
    if normalize_path_for_compare(&local_path_from_input(common.trim()))
        != normalize_path_for_compare(&ctx.common)
    {
        return Err("finish_checkout_repo_mismatch".into());
    }
    let root = run_git_checked(&ctx.target, ["rev-parse", "--show-toplevel"])?;
    if normalize_path_for_compare(&local_path_from_input(root.trim()))
        != normalize_path_for_compare(&ctx.target)
    {
        return Err("finish_checkout_root_mismatch".into());
    }
    let branch = run_git_checked(&ctx.target, ["symbolic-ref", "--short", "HEAD"])?;
    if branch.trim() != ctx.request.branch {
        return Err("worktree_branch_mismatch".into());
    }
    Ok(true)
}

// 未提交或新提交内容都必须保留，不用 finish 的清理路径隐式丢弃。
fn clean_source(ctx: &Context, oid: &str) -> Result<(), String> {
    let head = run_git_checked(&ctx.target, ["rev-parse", "HEAD"])?;
    if head.trim() != oid {
        return Err("finish_source_changed".into());
    }
    if !run_git_checked(
        &ctx.target,
        ["status", "--porcelain", "--untracked-files=all"],
    )?
    .trim()
    .is_empty()
    {
        return Err("finish_dirty_checkout".into());
    }
    Ok(())
}

// 历史祖先关系只证明提交已合并，不证明残留目录归属或授权删除。
fn historical_outcome(ctx: &Context, oid: &str) -> Result<Option<String>, String> {
    let base = format!("refs/heads/{}", ctx.request.base_branch);
    let output = run_git_raw(&ctx.project, ["merge-base", "--is-ancestor", oid, &base])?;
    if output.success {
        return Ok(Some("merged".into()));
    }
    // A nonzero ancestry result does not authorize cleanup. Missing base is an error.
    run_git_checked(&ctx.project, ["rev-parse", "--verify", &base])?;
    Ok(None)
}

// 每次删除前复核 source/base、恢复阻塞和目录归属；旧凭据不能授权新内容。
fn cleanup_gate(ctx: &Context, r: &Receipt, valid: bool) -> Result<(), String> {
    if worktree_root_metadata(&ctx.target)?.is_some() {
        if let Some(identity) = &r.checkout_identity {
            if receipt::root_identity(&ctx.target)? != *identity {
                return Err("finish_root_replaced".into());
            }
        }
    }
    if r.blocker.is_some() {
        return Err(r.blocker.clone().unwrap());
    }
    if r.outcome.is_none() {
        return Err("finish_merge_not_confirmed".into());
    }
    if let Some(oid) = tip(ctx)? {
        if oid != r.source_oid {
            return Err("finish_source_changed".into());
        }
    }
    // Evidence must still belong to the requested base, not just some past merge.
    let base_oid = run_git_checked(
        &ctx.project,
        [
            "rev-parse",
            "--verify",
            &format!("refs/heads/{}", ctx.request.base_branch),
        ],
    )?;
    if r.outcome.as_deref() == Some("no_diff") {
        if has_branch_content_diff(&ctx.project, base_oid.trim(), &r.source_oid)? {
            return Err("finish_base_changed".into());
        }
    } else {
        let evidence = r
            .base_oid
            .as_deref()
            .ok_or("finish_merge_evidence_missing")?;
        if !run_git_raw(
            &ctx.project,
            ["merge-base", "--is-ancestor", evidence, base_oid.trim()],
        )?
        .success
        {
            return Err("finish_base_changed".into());
        }
    }
    if valid
        && !matches!(
            r.phase.as_str(),
            "cleanup_intent" | "branch_intent" | "done"
        )
    {
        clean_source(ctx, &r.source_oid)?;
    }
    if valid && r.phase == "merged" {
        return Ok(());
    }
    if worktree_root_metadata(&ctx.target)?.is_some() {
        let Some(owned) = &r.ownership else {
            if valid && r.phase == "merged" {
                return Ok(());
            }
            return Err("finish_legacy_residual_manual_review".into());
        };
        let roots = r.artifacts.as_ref().map_or(&[][..], |m| m.roots.as_slice());
        receipt::verify_subset_excluding(&ctx.target, owned, roots)?;
        if let Some(m) = &r.artifacts {
            artifact_manifest::verify(ctx, m)?;
        }
    }
    Ok(())
}

// Only an unmutated preparation may be replaced by current checkout evidence.
fn refreshable_preparation(r: &Receipt) -> bool {
    r.phase == "prepared"
        && r.outcome.is_none()
        && r.blocker.is_none()
        && r.stash_reference.is_none()
        && r.base_oid.is_none()
        && r.delete_branch.is_none()
        && !r.acknowledged
}

// 只读重建可恢复阶段，不关闭会话或自动清理，缺少证据时返回 unknown/阻塞。
fn inspect(ctx: &Context) -> Result<FinishState, String> {
    let valid = checkout_valid(ctx)?;
    let r = load(ctx)?;
    let source = tip(ctx)?;
    let outcome = match &r {
        Some(r) => r.outcome.clone(),
        None => match &source {
            Some(oid) => historical_outcome(ctx, oid)?,
            None => None,
        },
    };
    let mut state = FinishState {
        checkout_valid: valid,
        merged: outcome.as_deref() == Some("merged"),
        outcome,
        source_oid: source
            .clone()
            .or_else(|| r.as_ref().map(|r| r.source_oid.clone())),
        cleanup_ready: false,
        cleanup_pending: false,
        blocker: None,
        unknown: !valid && r.is_none(),
        done: false,
        stash_reference: r.as_ref().and_then(|r| r.stash_reference.clone()),
        merge_result: None,
        phase: r
            .as_ref()
            .map_or("awaiting_merge", |r| r.phase.as_str())
            .into(),
        cleanup_plan_required: false,
    };
    if let Some(r) = &r {
        state.cleanup_plan_required = valid && r.outcome.is_some() && r.phase == "merged";
        state.cleanup_pending = r.outcome.is_some() || r.phase != "prepared";
        if refreshable_preparation(r) {
            state.unknown = !valid;
            if valid {
                if let Some(oid) = &source {
                    if let Err(error) = clean_source(ctx, oid) {
                        state.blocker = Some(error);
                    }
                } else {
                    state.blocker = Some("worktree_branch_not_found".into());
                }
            }
            return Ok(state);
        }
        match cleanup_gate(ctx, r, valid) {
            Ok(()) => {
                state.done = r.phase == "done"
                    && worktree_root_metadata(&ctx.target)?.is_none()
                    && (!r.delete_branch.unwrap_or(false) || source.is_none());
                state.cleanup_ready = !state.done;
            }
            Err(error) => state.blocker = Some(error),
        }
    } else if valid {
        if let Some(oid) = &source {
            if let Err(error) = clean_source(ctx, oid) {
                state.blocker = Some(error);
            } else if state.outcome.is_some() {
                state.cleanup_ready = true;
            }
        }
    } else if state.outcome.is_some() {
        state.cleanup_pending = true;
        if worktree_root_metadata(&ctx.target)?.is_none() {
            state.cleanup_ready = true;
            state.unknown = false;
        } else {
            state.blocker = Some("finish_legacy_residual_manual_review".into());
        }
    }
    Ok(state)
}

fn new_receipt(ctx: &Context, oid: String) -> Receipt {
    Receipt {
        version: 2,
        request: ctx.request.clone(),
        repo: path_to_git_arg(&ctx.common),
        source_oid: oid,
        outcome: None,
        base_oid: None,
        phase: "prepared".into(),
        blocker: None,
        stash_reference: None,
        ownership: None,
        delete_branch: None,
        acknowledged: false,
        artifacts: None,
        checkout_identity: None,
    }
}

fn merge(ctx: &Context, force: bool) -> Result<FinishState, String> {
    merge_with_save(ctx, force, |r| ctx.journal.save(r))
}

// Injectable persistence boundary keeps observer-error recovery testable without
// changing the merge engine or permitting it to run past a failed intent write.
fn merge_with_save<F>(ctx: &Context, force: bool, mut save: F) -> Result<FinishState, String>
where
    F: FnMut(&Receipt) -> Result<(), String>,
{
    let existing = load(ctx)?;
    if let Some(r) = &existing {
        if !refreshable_preparation(r) {
            return inspect(ctx);
        }
    }
    if !checkout_valid(ctx)? {
        return Err("finish_checkout_invalid".into());
    }
    let oid = tip(ctx)?.ok_or("worktree_branch_not_found")?;
    clean_source(ctx, &oid)?;
    // No merge/stash/cleanup intent exists for a refreshable preparation. Rebind
    // its source and ownership only after validating the current clean checkout.
    let mut r = new_receipt(ctx, oid);
    r.checkout_identity = Some(receipt::root_identity(&ctx.target)?);
    // Merge authority is independent of destructive checkout ownership.
    save(&r)?;
    // A normal conflict result is refreshable only after proving abort restored
    // the original clean base checkout. The engine's best-effort abort alone
    // is not evidence, and switching the project branch is also a mutation.
    let normal_base = if !force {
        Some((
            run_git_checked(&ctx.project, ["rev-parse", "HEAD"])?
                .trim()
                .to_string(),
            run_git_checked(&ctx.project, ["symbolic-ref", "--short", "HEAD"])?
                .trim()
                .to_string(),
            run_git_checked(
                &ctx.project,
                [
                    "rev-parse",
                    &format!("refs/heads/{}", ctx.request.base_branch),
                ],
            )?
            .trim()
            .to_string(),
        ))
    } else {
        None
    };
    let result = merge_worktree_observed(
        &ctx.request.project_path,
        &ctx.request.branch,
        &ctx.request.base_branch,
        force,
        |phase, stash| {
            r.phase = phase.into();
            if let Some(stash) = stash {
                r.stash_reference = Some(stash.into());
            }
            if phase == "stash_intent" || phase == "stash_pending" {
                r.blocker = Some("finish_stash_restore_pending".into());
            }
            if phase == "merged" {
                r.outcome = Some("merged".into());
                r.base_oid = Some(
                    run_git_checked(
                        &ctx.project,
                        [
                            "rev-parse",
                            &format!("refs/heads/{}", ctx.request.base_branch),
                        ],
                    )?
                    .trim()
                    .into(),
                );
            }
            save(&r)
        },
    );
    match result {
        Ok(result) => {
            r.outcome = if result.merged {
                Some("merged".into())
            } else if result.skipped && result.skip_reason.as_deref() == Some("no_diff") {
                Some("no_diff".into())
            } else {
                None
            };
            r.stash_reference = result.stash_reference.clone().or(r.stash_reference);
            r.blocker = if result.stash_created && !result.stash_restored {
                Some("finish_stash_restore_pending".into())
            } else {
                None
            };
            let aborted_normal = if r.outcome.is_none()
                && r.phase == "merge_intent"
                && r.stash_reference.is_none()
                && !result.stash_created
                && !force
            {
                normal_abort_restored(
                    ctx,
                    normal_base
                        .as_ref()
                        .ok_or("finish_abort_evidence_missing")?,
                )?
            } else {
                false
            };
            r.phase = if r.outcome.is_some() {
                "merged"
            } else if aborted_normal {
                "prepared"
            } else {
                r.blocker = Some("finish_merge_abort_unconfirmed".into());
                &r.phase
            }
            .into();
            if r.outcome.is_some() {
                r.base_oid = Some(
                    run_git_checked(
                        &ctx.project,
                        [
                            "rev-parse",
                            &format!("refs/heads/{}", ctx.request.base_branch),
                        ],
                    )?
                    .trim()
                    .into(),
                );
            }
            save(&r)?;
            let mut state = inspect(ctx)?;
            state.merge_result = Some(result);
            Ok(state)
        }
        Err(error) => {
            // Never let ancestry erase an interrupted force stash or uncertain mutation.
            r.blocker = if r.phase == "prepared" {
                None
            } else {
                Some(error.clone())
            };
            save(&r)?;
            Err(error)
        }
    }
}

fn normal_abort_restored(ctx: &Context, before: &(String, String, String)) -> Result<bool, String> {
    let head = run_git_checked(&ctx.project, ["rev-parse", "HEAD"])?;
    let branch = run_git_checked(&ctx.project, ["symbolic-ref", "--short", "HEAD"])?;
    let base = run_git_checked(
        &ctx.project,
        [
            "rev-parse",
            &format!("refs/heads/{}", ctx.request.base_branch),
        ],
    )?;
    let merge_head = run_git_checked(
        &ctx.project,
        [
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "MERGE_HEAD",
        ],
    )?;
    Ok(before.1 == ctx.request.base_branch
        && head.trim() == before.0
        && branch.trim() == before.1
        && base.trim() == before.2
        && worktree_root_metadata(&local_path_from_input(merge_head.trim()))?.is_none()
        && run_git_checked(
            &ctx.project,
            ["status", "--porcelain", "--untracked-files=all"],
        )?
        .trim()
        .is_empty())
}

fn cleanup(ctx: &Context, delete_branch: bool) -> Result<FinishState, String> {
    cleanup_with_remover(ctx, delete_branch, |ctx| {
        run_git_worktree_remove_with_retry(&ctx.project, &path_to_git_arg(&ctx.target)).map(|_| ())
    })
}

// 删除意图和归属先落盘，再注销/清理；数据库尚未确认时保留完成收据。
fn cleanup_with_remover<F>(
    ctx: &Context,
    delete_branch: bool,
    mut remove: F,
) -> Result<FinishState, String>
where
    F: FnMut(&Context) -> Result<(), String>,
{
    cleanup_guarded(ctx, delete_branch, &mut remove, || Ok(()))
}
fn cleanup_guarded<F, G>(
    ctx: &Context,
    delete_branch: bool,
    mut remove: F,
    mut guard: G,
) -> Result<FinishState, String>
where
    F: FnMut(&Context) -> Result<(), String>,
    G: FnMut() -> Result<(), String>,
{
    guard()?;
    let valid = checkout_valid(ctx)?;
    let mut r = match load(ctx)? {
        Some(r) => r,
        None => {
            let oid = tip(ctx)?.ok_or("finish_unknown")?;
            let outcome = historical_outcome(ctx, &oid)?.ok_or("finish_merge_not_confirmed")?;
            let mut r = new_receipt(ctx, oid);
            r.outcome = Some(outcome);
            r.base_oid = Some(
                run_git_checked(
                    &ctx.project,
                    [
                        "rev-parse",
                        &format!("refs/heads/{}", ctx.request.base_branch),
                    ],
                )?
                .trim()
                .into(),
            );
            if valid {
                clean_source(ctx, &r.source_oid)?;
                let classification = artifact_classify::classify(ctx)?;
                if !classification.preserved.is_empty() {
                    return Err(format!(
                        "finish_unknown_content_preserved: {}",
                        classification.preserved[0].path
                    ));
                }
                if !classification.candidates.is_empty() {
                    return Err("finish_cleanup_confirmation_required".into());
                }
                r.ownership = Some(receipt::snapshot(&ctx.target)?);
            } else if worktree_root_metadata(&ctx.target)?.is_some() {
                return Err("finish_legacy_residual_manual_review".into());
            }
            r
        }
    };
    // Legacy callers retain ordinary cleanup, but never gain implicit cache authorization.
    if valid && r.phase == "merged" {
        cleanup_gate(ctx, &r, valid)?;
        let classification = artifact_classify::classify(ctx)?;
        if !classification.preserved.is_empty() {
            return Err(format!(
                "finish_unknown_content_preserved: {}",
                classification.preserved[0].path
            ));
        }
        if !classification.candidates.is_empty() {
            return Err("finish_cleanup_confirmation_required".into());
        }
        r.ownership = Some(receipt::snapshot(&ctx.target)?);
    }
    cleanup_gate(ctx, &r, valid)?;
    if let Some(previous) = r.delete_branch {
        if previous != delete_branch {
            return Err("finish_cleanup_request_changed".into());
        }
    }
    force_delete::ensure_scoped_prune(ctx)?;
    r.delete_branch = Some(delete_branch);
    r.phase = "cleanup_intent".into();
    // Critical intent and ownership must be durable BEFORE any Git/FS removal.
    ctx.journal.save(&r)?;
    if let Some(m) = &r.artifacts {
        if worktree_root_metadata(&ctx.target)?.is_some() {
            // Complete ordinary + artifact ownership and cleanup intent were published first.
            artifact_manifest::remove_guarded(ctx, m, &mut guard)?;
            receipt::verify_subset(
                &ctx.target,
                r.ownership
                    .as_ref()
                    .ok_or("finish_legacy_residual_manual_review")?,
            )?;
        }
    }
    guard()?;
    if valid {
        let result = remove(ctx);
        // Git failure may have partially removed and unregistered the checkout. Preserve journal.
        if let Err(error) = result {
            return Err(error);
        }
    }
    if worktree_root_metadata(&ctx.target)?.is_some() {
        if worktree_registration(&ctx.project, &ctx.target, &ctx.request.branch)?
            == WorktreeRegistration::Mismatched
        {
            return Err("worktree_branch_mismatch".into());
        }
        receipt::verify_subset(
            &ctx.target,
            r.ownership
                .as_ref()
                .ok_or("finish_legacy_residual_manual_review")?,
        )?;
        guard()?;
        force_delete::ensure_scoped_prune(ctx)?;
        // Missing .git is allowed only as a subset of our own pre-removal snapshot.
        if !valid
            && worktree_registration(&ctx.project, &ctx.target, &ctx.request.branch)?
                == WorktreeRegistration::Matched
        {
            cleanup_registered_stale_worktree_path(&ctx.project, &ctx.target)?;
        } else {
            cleanup_residual_worktree_dir_after_remove(&ctx.project, &ctx.target)?;
        }
    }
    ensure_worktree_root_absent(&ctx.target)?;
    force_delete::ensure_scoped_prune(ctx)?;
    run_git_checked(&ctx.project, ["worktree", "prune"])?;
    if worktree_path_registered(&ctx.project, &ctx.target)? {
        return Err("worktree_remove_incomplete".into());
    }
    r.phase = "branch_intent".into();
    ctx.journal.save(&r)?;
    if delete_branch {
        if let Some(oid) = tip(ctx)? {
            if oid != r.source_oid {
                return Err("finish_source_changed".into());
            }
            let entries = parse_worktree_list_entries(&run_git_checked(
                &ctx.project,
                ["worktree", "list", "--porcelain"],
            )?);
            if entries
                .iter()
                .any(|entry| entry.branch.as_deref() == Some(&ctx.request.branch))
            {
                return Err("finish_branch_in_use".into());
            }
            // compare-and-delete prevents deleting an externally advanced branch.
            run_git_checked(
                &ctx.project,
                [
                    "update-ref",
                    "-d",
                    &format!("refs/heads/{}", ctx.request.branch),
                    &r.source_oid,
                ],
            )?;
        }
    }
    r.phase = "done".into();
    ctx.journal.save(&r)?;
    cleanup_empty_worktree_parent(&ctx.target);
    inspect(ctx)
}

// 仅允许 Git/文件系统完成后的数据库收尾确认，保留幂等 tombstone。
fn ack(ctx: &Context) -> Result<FinishState, String> {
    let state = inspect(ctx)?;
    if !state.done {
        return Err("finish_not_done".into());
    }
    let mut r = load(ctx)?.ok_or("finish_receipt_missing")?;
    // Caller must invoke only after SQL success. Retain an acknowledged tombstone for idempotence.
    r.acknowledged = true;
    ctx.journal.save(&r)?;
    Ok(state)
}

// 四个 finish IPC 共用进程内合并锁；后端不关闭前端会话。
#[tauri::command]
pub async fn git_worktree_finish_inspect(req: FinishRequest) -> Result<FinishState, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        inspect(&context(req)?)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
#[tauri::command]
pub async fn git_worktree_finish_merge(
    req: FinishRequest,
    force: bool,
) -> Result<FinishState, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        merge(&context(req)?, force)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
#[tauri::command]
pub async fn git_worktree_finish_cleanup(
    req: FinishRequest,
    delete_branch: bool,
    daemon_bridge: tauri::State<'_, crate::daemon::client::DaemonBridge>,
) -> Result<FinishState, String> {
    let bridge = daemon_bridge.get();
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        let ctx = context(req)?;
        if worktree_root_metadata(&ctx.target)?.is_none() {
            return cleanup(&ctx, delete_branch);
        }
        let client = bridge.ok_or("finish_admission_daemon_unavailable")?;
        cleanup_plan::legacy_cleanup(&ctx, delete_branch, &client)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}
#[tauri::command]
pub async fn git_worktree_finish_ack(req: FinishRequest) -> Result<FinishState, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = acquire_worktree_merge_lock()?;
        ack(&context(req)?)
    })
    .await
    .map_err(|e| format!("task_failed: {e}"))?
}

#[cfg(test)]
#[path = "finish_tests.rs"]
mod tests;
