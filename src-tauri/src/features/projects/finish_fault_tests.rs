//! Failure boundaries and conservative recovery; all mutations confined to temporary fixtures.
use super::super::*;
use super::{fixture, git, unregister};

#[test]
fn finish_remove_failure_journal_survives_and_retries() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let error = cleanup_with_remover(&ctx, true, |ctx| {
        unregister(ctx);
        fs::remove_file(ctx.target.join("base")).unwrap();
        Err("simulated OS deletion failure".into())
    })
    .unwrap_err();
    assert_eq!(error, "simulated OS deletion failure");
    assert_eq!(load(&ctx).unwrap().unwrap().phase, "cleanup_intent");
    let restarted = context(ctx.request.clone()).unwrap();
    assert!(inspect(&restarted).unwrap().cleanup_ready);
    assert!(cleanup(&restarted, true).unwrap().done);
}

#[test]
fn finish_intent_write_failure_prevents_removal() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    receipt::fail_next_save();
    let error = cleanup_with_remover(&ctx, true, |_| {
        panic!("must not remove after persistence error")
    })
    .unwrap_err();
    assert!(error.starts_with("finish_receipt_write_failed"));
    assert!(checkout_valid(&ctx).unwrap());
    assert!(cleanup(&ctx, true).unwrap().done);
}

#[test]
fn finish_normal_merge_intent_recovers_but_stash_intent_cannot() {
    let (_temp, ctx) = fixture();
    let mut r = new_receipt(&ctx, tip(&ctx).unwrap().unwrap());
    r.ownership = Some(receipt::snapshot(&ctx.target).unwrap());
    r.phase = "merge_intent".into();
    ctx.journal.save(&r).unwrap();
    git(&ctx.project, &["merge", "--no-ff", "--no-edit", "wt/task"]);
    assert!(inspect(&ctx).unwrap().merged);
    r.phase = "stash_pending".into();
    r.blocker = Some("finish_stash_restore_pending".into());
    ctx.journal.save(&r).unwrap();
    assert!(!inspect(&ctx).unwrap().cleanup_ready);
    assert_eq!(
        cleanup(&ctx, true).unwrap_err(),
        "finish_stash_restore_pending"
    );
}

#[test]
fn finish_dirty_main_retry_and_changed_ignored_artifact() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.project.join("local"), "keep").unwrap();
    assert_eq!(merge(&ctx, false).unwrap_err(), "dirty_main_worktree");
    assert!(inspect(&ctx).unwrap().blocker.is_none());
    fs::remove_file(ctx.project.join("local")).unwrap();
    merge(&ctx, false).unwrap();
    // Use the repository exclude file, not a tracked checkout mutation.
    fs::write(ctx.common.join("info/exclude"), "artifact\n").unwrap();
    fs::write(ctx.target.join("artifact"), "new ignored content").unwrap();
    assert!(cleanup(&ctx, true)
        .unwrap_err()
        .starts_with("finish_unknown_content_preserved:"));
    assert!(ctx.target.join("artifact").exists());
}

#[test]
fn finish_safe_missing_legacy_path_and_base_rewind() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let base_before = git(&ctx.project, &["rev-parse", "HEAD^1"]);
    git(&ctx.project, &["reset", "--hard", &base_before]);
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_base_changed");
    assert!(ctx.target.exists());
}

#[test]
fn finish_metadata_error_is_not_absence() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("file");
    fs::write(&file, "data").unwrap();
    // NotADirectory is an I/O failure, not a missing root.
    assert!(worktree_root_metadata(&file.join("child"))
        .unwrap_err()
        .starts_with("worktree_metadata_failed"));
}

#[cfg(windows)]
#[test]
fn finish_windows_junctions_are_not_traversed() {
    let (_temp, ctx) = fixture();
    let outside = ctx.project.with_extension("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), "keep").unwrap();
    let link = ctx.target.join("junction");
    let output = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            link.to_str().unwrap(),
            outside.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        receipt::snapshot(&ctx.target).unwrap_err(),
        "finish_unsafe_link"
    );
    let mut req = ctx.request.clone();
    req.worktree_path = link.to_str().unwrap().into();
    assert_eq!(context(req).err().unwrap(), "finish_unsafe_link");
    fs::remove_dir(&link).unwrap();
    assert_eq!(fs::read_to_string(outside.join("keep")).unwrap(), "keep");
}

#[cfg(windows)]
use std::process::Command;

#[test]
fn finish_missing_path_without_receipt_can_finalize_only_with_branch_evidence() {
    let (_temp, ctx) = fixture();
    git(&ctx.project, &["merge", "--no-ff", "--no-edit", "wt/task"]);
    git(
        &ctx.project,
        &["worktree", "remove", ctx.target.to_str().unwrap()],
    );
    assert!(inspect(&ctx).unwrap().cleanup_ready);
    assert!(cleanup(&ctx, true).unwrap().done);
}

#[test]
fn finish_unmerged_branch_and_registered_stale_without_receipt_are_not_removed() {
    let (_temp, ctx) = fixture();
    assert_eq!(
        cleanup(&ctx, true).unwrap_err(),
        "finish_merge_not_confirmed"
    );
    fs::remove_file(ctx.target.join(".git")).unwrap();
    assert!(!inspect(&ctx).unwrap().checkout_valid);
    assert!(cleanup(&ctx, true).is_err());
    assert!(ctx.target.join("task").exists());
}

#[test]
fn finish_discard_protects_main_ancestor_and_admin() {
    let (_temp, ctx) = fixture();
    for path in [&ctx.project, ctx.project.parent().unwrap(), &ctx.common] {
        assert_eq!(
            validate_removal_target(&ctx.project, path).unwrap_err(),
            "finish_protected_path"
        );
    }
    validate_removal_target(&ctx.project, &ctx.target).unwrap();
}

#[test]
fn finish_accepts_valid_linked_project_checkout() {
    let (_temp, ctx) = fixture();
    let linked = ctx.project.with_extension("linked");
    git(
        &ctx.project,
        &[
            "worktree",
            "add",
            "-b",
            "integration",
            &path_to_git_arg(&linked),
            "main",
        ],
    );
    let mut req = ctx.request.clone();
    req.project_path = linked.to_str().unwrap().into();
    req.base_branch = "integration".into();
    let bound = context(req).unwrap();
    assert_eq!(bound.common, ctx.common);
    assert!(inspect(&bound).unwrap().checkout_valid);
    let merged = merge(&bound, false).unwrap();
    assert!(merged.merged && merged.cleanup_ready);
    assert!(cleanup(&bound, true).unwrap().done);
    assert!(linked.join("task").exists());
    assert!(!ctx.project.join("task").exists());
}

#[test]
fn finish_prepared_dirty_main_retry_rebinds_new_source_and_ownership() {
    for force in [false, true] {
        let (_temp, ctx) = fixture();
        fs::write(ctx.project.join("local"), "keep").unwrap();
        assert_eq!(merge(&ctx, false).unwrap_err(), "dirty_main_worktree");
        assert!(refreshable_preparation(&load(&ctx).unwrap().unwrap()));
        fs::write(ctx.target.join("later"), "later task content").unwrap();
        let dirty = inspect(&ctx).unwrap();
        assert_eq!(dirty.blocker.as_deref(), Some("finish_dirty_checkout"));
        git(&ctx.target, &["add", "."]);
        git(&ctx.target, &["commit", "-m", "later task commit"]);
        assert!(inspect(&ctx).unwrap().blocker.is_none());
        if !force {
            fs::remove_file(ctx.project.join("local")).unwrap();
        }
        let state = merge(&ctx, force).unwrap();
        assert!(state.merged && state.cleanup_ready);
        assert_eq!(
            load(&ctx).unwrap().unwrap().source_oid,
            tip(&ctx).unwrap().unwrap()
        );
        assert!(cleanup(&ctx, true).unwrap().done);
        assert_eq!(
            fs::read_to_string(ctx.project.join("later")).unwrap(),
            "later task content"
        );
        if force {
            assert_eq!(
                fs::read_to_string(ctx.project.join("local")).unwrap(),
                "keep"
            );
        }
    }
}

#[test]
fn finish_preparation_refresh_never_erases_mutation_evidence() {
    let (_temp, ctx) = fixture();
    let original = new_receipt(&ctx, tip(&ctx).unwrap().unwrap());
    assert!(refreshable_preparation(&original));
    for field in [
        "stash", "base", "delete", "blocker", "outcome", "phase", "ack",
    ] {
        let mut r = original.clone();
        match field {
            "stash" => r.stash_reference = Some("retained-stash".into()),
            "base" => r.base_oid = Some("merge-evidence".into()),
            "delete" => r.delete_branch = Some(false),
            "blocker" => r.blocker = Some("finish_stash_restore_pending".into()),
            "outcome" => r.outcome = Some("merged".into()),
            "phase" => r.phase = "merge_intent".into(),
            "ack" => r.acknowledged = true,
            _ => unreachable!(),
        }
        assert!(!refreshable_preparation(&r), "{field}");
    }
}

#[test]
fn finish_normal_conflict_abort_then_resolution_commit_retries() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.project.join("base"), "main version\n").unwrap();
    git(&ctx.project, &["add", "."]);
    git(&ctx.project, &["commit", "-m", "main diverges"]);
    fs::write(ctx.target.join("base"), "task version\n").unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "task diverges"]);
    let state = merge(&ctx, false).unwrap();
    assert!(!state.merged && !state.cleanup_ready && !state.cleanup_pending);
    assert!(!state.merge_result.unwrap().conflict_files.is_empty());
    let before = load(&ctx).unwrap().unwrap();
    assert!(refreshable_preparation(&before));
    assert!(git(&ctx.project, &["status", "--porcelain"]).is_empty());
    fs::write(ctx.target.join("base"), "main version\n").unwrap();
    assert_eq!(
        inspect(&ctx).unwrap().blocker.as_deref(),
        Some("finish_dirty_checkout")
    );
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "resolve on task branch"]);
    let review = inspect(&ctx).unwrap();
    assert!(review.blocker.is_none() && !review.cleanup_ready && !review.merged);
    assert_eq!(load(&ctx).unwrap().unwrap().source_oid, before.source_oid);
    assert_eq!(
        cleanup(&ctx, true).unwrap_err(),
        "finish_merge_not_confirmed"
    );
    let state = merge(&ctx, false).unwrap();
    assert!(state.merged && state.cleanup_ready);
    assert_ne!(load(&ctx).unwrap().unwrap().source_oid, before.source_oid);
    assert!(cleanup(&ctx, true).unwrap().done);
}

#[test]
fn finish_normal_conflict_with_checkout_mutation_cannot_refresh() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.project.join("base"), "main version\n").unwrap();
    git(&ctx.project, &["add", "."]);
    git(&ctx.project, &["commit", "-m", "main diverges"]);
    fs::write(ctx.target.join("base"), "task version\n").unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "task diverges"]);
    git(&ctx.project, &["checkout", "-b", "other"]);
    let state = merge(&ctx, false).unwrap();
    assert_eq!(
        state.blocker.as_deref(),
        Some("finish_merge_abort_unconfirmed")
    );
    let receipt = load(&ctx).unwrap().unwrap();
    assert_eq!(receipt.phase, "merge_intent");
    assert!(!refreshable_preparation(&receipt));
    assert_eq!(git(&ctx.project, &["branch", "--show-current"]), "main");
}

#[test]
fn finish_merged_observer_write_failure_retains_mutation_and_blocks_new_tip_cleanup() {
    let (_temp, ctx) = fixture();
    let error = merge_with_save(&ctx, false, |r| {
        if r.phase == "merged" && r.blocker.is_none() {
            Err("simulated merged observer failure".into())
        } else {
            ctx.journal.save(r)
        }
    })
    .unwrap_err();
    assert_eq!(error, "simulated merged observer failure");
    let r = load(&ctx).unwrap().unwrap();
    assert_eq!(r.phase, "merged");
    assert_eq!(r.outcome.as_deref(), Some("merged"));
    assert_eq!(r.blocker.as_deref(), Some(error.as_str()));
    assert!(!refreshable_preparation(&r));
    fs::write(ctx.target.join("later"), "unmerged content").unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "later"]);
    assert!(!merge(&ctx, false).unwrap().cleanup_ready);
    assert_eq!(load(&ctx).unwrap().unwrap().source_oid, r.source_oid);
    assert_eq!(cleanup(&ctx, true).unwrap_err(), error);
    assert!(ctx.target.join("later").exists());
    assert!(tip(&ctx).unwrap().is_some());
}

#[test]
fn finish_stash_observer_write_failure_never_becomes_prepared() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.project.join("local"), "keep").unwrap();
    let error = merge_with_save(&ctx, true, |r| {
        if r.phase == "stash_pending" && r.stash_reference.is_some() {
            Err("simulated stash observer failure".into())
        } else {
            ctx.journal.save(r)
        }
    })
    .unwrap_err();
    assert_eq!(error, "simulated stash observer failure");
    let r = load(&ctx).unwrap().unwrap();
    // Even when writing the error record fails again, durable stash_intent is
    // conservative and the real stash has not been silently discarded.
    assert_eq!(r.phase, "stash_intent");
    assert!(!refreshable_preparation(&r));
    assert!(!git(&ctx.project, &["stash", "list"]).is_empty());
    assert!(!inspect(&ctx).unwrap().cleanup_ready);
    assert!(cleanup(&ctx, true).is_err());
    assert!(ctx.target.exists());
}
