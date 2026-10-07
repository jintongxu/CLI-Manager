use super::*;
use std::process::Command;

fn git(path: &Path, args: &[&str]) -> String {
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
fn fixture() -> (tempfile::TempDir, Context) {
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

fn unregister(ctx: &Context) {
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
    unregister(&ctx);
    fs::write(ctx.target.join("task"), "modified").unwrap();
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_residual_changed");
    fs::write(ctx.target.join("task"), "task\n").unwrap();
    fs::create_dir(ctx.target.join(".git")).unwrap();
    assert_eq!(cleanup(&ctx, true).unwrap_err(), "finish_residual_changed");
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
