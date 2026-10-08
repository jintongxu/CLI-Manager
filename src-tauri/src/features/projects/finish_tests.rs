use super::*;
use std::process::Command;

pub(super) fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().into()
}
pub(super) fn fixture() -> (tempfile::TempDir, Context) {
    let temp = tempfile::tempdir().unwrap();
    let main = temp.path().join("repo");
    let wt = temp.path().join("task");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "--initial-branch=main"]);
    git(&main, &["config", "user.email", "test@example.com"]);
    git(&main, &["config", "user.name", "Tests"]);
    git(&main, &["config", "core.autocrlf", "false"]);
    fs::write(main.join("base"), "base\n").unwrap();
    git(&main, &["add", "."]);
    git(&main, &["commit", "-m", "base"]);
    git(
        &main,
        &["worktree", "add", "-b", "wt/task", wt.to_str().unwrap()],
    );
    fs::write(wt.join("task"), "task\n").unwrap();
    git(&wt, &["add", "."]);
    git(&wt, &["commit", "-m", "task"]);
    let ctx = context(FinishRequest {
        worktree_id: "test-id".into(),
        project_path: main.to_str().unwrap().into(),
        worktree_path: wt.to_str().unwrap().into(),
        branch: "wt/task".into(),
        base_branch: "main".into(),
    })
    .unwrap();
    (temp, ctx)
}

#[test]
fn finish_normal_and_ack_keeps_receipt() {
    let (_temp, ctx) = fixture();
    assert!(inspect(&ctx).unwrap().checkout_valid);
    let merged = merge(&ctx, false).unwrap();
    assert!(merged.merged && merged.cleanup_ready);
    assert!(cleanup(&ctx, true).unwrap().done);
    assert!(inspect(&ctx).unwrap().done);
    assert!(ack(&ctx).unwrap().done);
    assert!(load(&ctx).unwrap().unwrap().acknowledged);
    assert!(cleanup(&ctx, true).unwrap().done);
}

pub(super) fn unregister(ctx: &Context) {
    for entry in fs::read_dir(ctx.common.join("worktrees")).unwrap() {
        fs::remove_dir_all(entry.unwrap().path()).unwrap();
    }
    fs::remove_file(ctx.target.join(".git")).unwrap();
    git(&ctx.project, &["worktree", "prune"]);
}

#[test]
fn finish_unregistered_residual_restart_and_deleted_branch() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let mut r = load(&ctx).unwrap().unwrap();
    r.ownership = Some(receipt::snapshot(&ctx.target).unwrap());
    r.phase = "cleanup_intent".into();
    r.delete_branch = Some(true);
    ctx.journal.save(&r).unwrap();
    // Simulate Git unregistering after partial deletion while OS leaves owned content.
    unregister(&ctx);
    fs::remove_file(ctx.target.join("base")).unwrap();
    git(&ctx.project, &["branch", "-D", "wt/task"]);
    let restarted = context(ctx.request.clone()).unwrap();
    let state = inspect(&restarted).unwrap();
    assert!(!state.checkout_valid && state.cleanup_ready && state.merged);
    assert!(cleanup(&restarted, true).unwrap().done);
}

#[test]
fn finish_unknown_legacy_residual_never_adopted() {
    let (_temp, ctx) = fixture();
    git(&ctx.project, &["merge", "--no-ff", "--no-edit", "wt/task"]);
    unregister(&ctx);
    let state = inspect(&ctx).unwrap();
    assert!(state.merged && !state.cleanup_ready);
    assert_eq!(
        cleanup(&ctx, true).unwrap_err(),
        "finish_legacy_residual_manual_review"
    );
    assert!(ctx.target.join("task").exists());
    git(&ctx.project, &["branch", "-D", "wt/task"]);
    assert!(inspect(&ctx).unwrap().unknown);
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_unknown");
}

#[test]
fn finish_dirty_new_tip_and_ignored_content_block_cleanup() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.target.join("new"), "new").unwrap();
    assert_eq!(merge(&ctx, false).unwrap_err(), "finish_dirty_checkout");
    fs::remove_file(ctx.target.join("new")).unwrap();
    merge(&ctx, false).unwrap();
    fs::write(ctx.target.join("task"), "modified").unwrap();
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_dirty_checkout");
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "new tip"]);
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_source_changed");
}

#[test]
fn finish_residual_modified_new_git_and_replaced_root_block_cleanup() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let mut r = load(&ctx).unwrap().unwrap();
    r.ownership = Some(receipt::snapshot(&ctx.target).unwrap());
    r.phase = "cleanup_intent".into();
    r.delete_branch = Some(true);
    ctx.journal.save(&r).unwrap();
    unregister(&ctx);
    fs::write(ctx.target.join("task"), "modified").unwrap();
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_residual_changed");
    fs::write(ctx.target.join("task"), "task\n").unwrap();
    fs::create_dir(ctx.target.join(".git")).unwrap();
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_nested_git");
    fs::remove_dir(ctx.target.join(".git")).unwrap();
    let displaced = ctx.target.with_extension("old");
    fs::rename(&ctx.target, &displaced).unwrap();
    fs::create_dir(&ctx.target).unwrap();
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_root_replaced");
    assert!(displaced.join("task").exists());
}

#[test]
fn finish_mismatch_identity_and_protected_paths() {
    let (_temp, ctx) = fixture();
    let mut req = ctx.request.clone();
    req.worktree_path = ctx.project.to_str().unwrap().into();
    assert_eq!(context(req).err().unwrap(), "finish_protected_path");
    let mut req = ctx.request.clone();
    req.worktree_path = ctx.common.to_str().unwrap().into();
    assert_eq!(context(req).err().unwrap(), "finish_protected_path");
    let mut req = ctx.request.clone();
    req.worktree_path = ctx.target.with_extension("other").to_str().unwrap().into();
    let other = context(req).unwrap();
    assert_eq!(inspect(&other).unwrap_err(), "worktree_branch_mismatch");
    merge(&ctx, false).unwrap();
    let mut req = ctx.request.clone();
    req.base_branch = "other".into();
    let other = context(req).unwrap();
    assert_eq!(
        load(&other).unwrap_err(),
        "finish_receipt_identity_mismatch"
    );
}

#[test]
fn finish_stash_restore_blocker_survives_restart_and_ancestry() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.target.join("base"), "task version\n").unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "task base"]);
    fs::write(ctx.project.join("base"), "local main version\n").unwrap();
    let result = merge(&ctx, true).unwrap();
    assert!(result.merged);
    assert_eq!(
        result.blocker.as_deref(),
        Some("finish_stash_restore_pending")
    );
    let restarted = context(ctx.request.clone()).unwrap();
    assert!(inspect(&restarted).unwrap().stash_reference.is_some());
    assert_eq!(
        cleanup(&restarted, true).unwrap_err(),
        "finish_stash_restore_pending"
    );
    assert!(ctx.target.exists());
}

#[test]
fn finish_no_diff_is_distinct() {
    let (_temp, ctx) = fixture();
    git(&ctx.target, &["reset", "--hard", "main"]);
    let state = merge(&ctx, false).unwrap();
    assert!(!state.merged);
    assert_eq!(state.outcome.as_deref(), Some("no_diff"));
    assert!(state.cleanup_ready);
    assert!(cleanup(&ctx, false).unwrap().done);
    assert!(tip(&ctx).unwrap().is_some());
}

#[test]
fn finish_persistence_failure_stops_before_git_remove() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let dir = ctx.common.join("cli-manager-finish").join("test-id");
    // Invalid committed journal entry simulates storage/read failure at intent boundary.
    fs::write(dir.join("99999999.json"), "corrupt").unwrap();
    assert!(cleanup(&ctx, true)
        .unwrap_err()
        .contains("finish_receipt_corrupt"));
    assert!(ctx.target.exists());
    assert!(checkout_valid(&ctx).unwrap());
}

#[test]
fn finish_internal_not_found_and_false_success_are_not_absence() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("root");
    fs::create_dir(&path).unwrap();
    assert_eq!(
        remove_worktree_path_with_retry(&path, |_| Err(io::Error::new(
            io::ErrorKind::NotFound,
            "child missing"
        )))
        .unwrap_err(),
        "worktree_remove_incomplete"
    );
    assert_eq!(
        remove_worktree_path_with_retry(&path, |_| Ok(())).unwrap_err(),
        "worktree_remove_incomplete"
    );
    fs::remove_dir(&path).unwrap();
    remove_worktree_path_with_retry(&path, |_| {
        Err(io::Error::new(io::ErrorKind::NotFound, "root missing"))
    })
    .unwrap();
}

#[cfg(unix)]
#[test]
fn finish_symlinks_rejected_without_traversal() {
    use std::os::unix::fs::symlink;
    let (_temp, ctx) = fixture();
    let outside = ctx.project.join("base");
    symlink(&outside, ctx.target.join("link")).unwrap();
    assert_eq!(
        receipt::snapshot(&ctx.target).unwrap_err(),
        "finish_unsafe_link"
    );
    let link = ctx.target.with_extension("link");
    symlink(&ctx.target, &link).unwrap();
    let mut req = ctx.request.clone();
    req.worktree_path = link.to_str().unwrap().into();
    assert_eq!(context(req).err().unwrap(), "finish_unsafe_link");
    assert_eq!(fs::read_to_string(outside).unwrap(), "base\n");
}

#[path = "finish_fault_tests.rs"]
mod faults;

// The ordinary create path starts at base HEAD. No Finish action or receipt is
// needed for ancestry evidence; dirty content must not become recovery progress.
fn startup_same_base_fixture() -> (tempfile::TempDir, Context) {
    let temp = tempfile::tempdir().unwrap();
    let main = temp.path().join("repo");
    let wt = temp.path().join("task");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "--initial-branch=main"]);
    git(&main, &["config", "user.email", "test@example.com"]);
    git(&main, &["config", "user.name", "Tests"]);
    git(&main, &["config", "core.autocrlf", "false"]);
    fs::write(main.join("base"), "base
").unwrap();
    git(&main, &["add", "."]);
    git(&main, &["commit", "-m", "base"]);
    git(&main, &["worktree", "add", "-b", "wt/task", wt.to_str().unwrap()]);
    let ctx = context(FinishRequest {
        worktree_id: "startup-status".into(),
        project_path: main.to_str().unwrap().into(),
        worktree_path: wt.to_str().unwrap().into(),
        branch: "wt/task".into(),
        base_branch: "main".into(),
    }).unwrap();
    (temp, ctx)
}

#[test]
fn startup_status_same_base_clean_tracked_untracked_without_receipt() {
    for dirty in [None, Some("base"), Some("untracked")] {
        let (_temp, ctx) = startup_same_base_fixture();
        assert_eq!(git(&ctx.target, &["rev-parse", "HEAD"]), git(&ctx.project, &["rev-parse", "main"]));
        if let Some(file) = dirty {
            fs::write(ctx.target.join(file), "unfinished work
").unwrap();
        }
        let before = git(&ctx.target, &["status", "--porcelain"]);
        let registration = git(&ctx.project, &["worktree", "list", "--porcelain"]);
        for _ in 0..2 {
            let restarted = context(ctx.request.clone()).unwrap();
            let state = inspect(&restarted).unwrap();
            assert!(state.checkout_valid && state.merged);
            assert_eq!(state.outcome.as_deref(), Some("merged"));
            assert!(!state.cleanup_pending && !state.done && !state.unknown);
            assert_eq!(state.cleanup_ready, dirty.is_none());
            assert_eq!(state.blocker.as_deref(), dirty.map(|_| "finish_dirty_checkout"));
            assert!(load(&restarted).unwrap().is_none());
            assert!(!ctx.common.join("cli-manager-finish").exists());
        }
        assert_eq!(git(&ctx.target, &["status", "--porcelain"]), before);
        assert_eq!(git(&ctx.project, &["worktree", "list", "--porcelain"]), registration);
        assert_eq!(fs::read_to_string(ctx.target.join(dirty.unwrap_or("base"))).unwrap(),
            if dirty.is_some() { "unfinished work
" } else { "base
" });
    }
}

#[test]
fn startup_status_novel_tip_historical_merge_and_prepared_dirty() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.target.join("untracked"), "unfinished
").unwrap();
    let novel = inspect(&ctx).unwrap();
    assert!(novel.checkout_valid && !novel.merged && !novel.cleanup_pending);
    assert_eq!(novel.blocker.as_deref(), Some("finish_dirty_checkout"));
    assert!(load(&ctx).unwrap().is_none());
    // A historical merge is ordinary Git, not a Finish receipt.
    git(&ctx.project, &["merge", "--no-ff", "--no-edit", "wt/task"]);
    let historical = inspect(&ctx).unwrap();
    assert!(historical.checkout_valid && historical.merged && !historical.cleanup_pending);
    assert_eq!(historical.blocker.as_deref(), Some("finish_dirty_checkout"));
    assert!(!historical.cleanup_ready && !historical.done);
    assert!(load(&ctx).unwrap().is_none());
    let prepared = new_receipt(&ctx, tip(&ctx).unwrap().unwrap());
    ctx.journal.save(&prepared).unwrap();
    let state = inspect(&context(ctx.request.clone()).unwrap()).unwrap();
    assert!(state.checkout_valid && !state.cleanup_pending && !state.done);
    assert_eq!(state.blocker.as_deref(), Some("finish_dirty_checkout"));
    assert_eq!(load(&ctx).unwrap().unwrap().phase, "prepared");
    assert_eq!(fs::read_to_string(ctx.target.join("untracked")).unwrap(), "unfinished
");
}

#[test]
fn startup_status_missing_registration_path_and_branch_without_receipt() {
    let (_temp, ctx) = fixture(); // Novel tip: no historical completion evidence.
    unregister(&ctx);
    let residual = inspect(&ctx).unwrap();
    assert!(!residual.checkout_valid && residual.unknown && !residual.cleanup_pending);
    fs::remove_dir_all(&ctx.target).unwrap(); // Temporary fixture only.
    let absent = inspect(&ctx).unwrap();
    assert!(!absent.checkout_valid && absent.unknown && !absent.done);
    git(&ctx.project, &["branch", "-D", "wt/task"]);
    let no_branch = inspect(&ctx).unwrap();
    assert!(!no_branch.checkout_valid && no_branch.unknown && !no_branch.cleanup_pending);
    assert!(no_branch.source_oid.is_none() && no_branch.outcome.is_none());
    assert!(load(&ctx).unwrap().is_none());
}
