use super::*;
use std::process::Command;
fn git(path: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().into()
}
fn fixture() -> (tempfile::TempDir, FinishRequest) {
    let temp = tempfile::tempdir().unwrap();
    let main = temp.path().join("repo");
    let target = temp.path().join("task");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "--initial-branch=main"]);
    git(&main, &["config", "user.email", "test@example.com"]);
    git(&main, &["config", "user.name", "Tests"]);
    fs::write(main.join("base"), "base").unwrap();
    git(&main, &["add", "."]);
    git(&main, &["commit", "-m", "base"]);
    git(
        &main,
        &["worktree", "add", "-b", "wt/task", target.to_str().unwrap()],
    );
    (
        temp,
        FinishRequest {
            worktree_id: "force-test".into(),
            project_path: main.to_str().unwrap().into(),
            worktree_path: target.to_str().unwrap().into(),
            branch: "wt/task".into(),
            base_branch: "main".into(),
        },
    )
}
fn execute(req: &FinishRequest, auth: &ForceDeleteInspection) -> Result<ForceDeleteResult, String> {
    execute_with_remover(req, &auth.token, &auth.confirmed_path, unlink_tree)
}
fn unregister(req: &FinishRequest) {
    let ctx = context(req.clone()).unwrap();
    for entry in fs::read_dir(ctx.common.join("worktrees")).unwrap() {
        fs::remove_dir_all(entry.unwrap().path()).unwrap();
    }
    fs::remove_file(ctx.target.join(".git")).unwrap();
    git(&ctx.project, &["worktree", "prune"]);
}
#[test]
fn force_delete_gate_exact_path_and_single_use() {
    let (_temp, req) = fixture();
    assert_eq!(
        execute_with_remover(&req, "invalid", &req.worktree_path, unlink_tree).unwrap_err(),
        "force_delete_confirmation_required"
    );
    let auth = inspect_force(&req).unwrap();
    assert_eq!(auth.confirmed_path, req.worktree_path);
    assert_eq!(
        execute_with_remover(&req, &auth.token, "wrong", unlink_tree).unwrap_err(),
        "force_delete_confirmation_mismatch"
    );
    assert!(execute(&req, &auth).is_err());
    assert!(Path::new(&req.worktree_path).exists());
    let auth = inspect_force(&req).unwrap();
    let mut wrong = req.clone();
    wrong.worktree_id = "different".into();
    assert!(execute(&wrong, &auth).is_err());
    assert!(execute(&req, &auth).is_err());
}
#[test]
fn force_delete_dirty_unmerged_deletes_branch_and_no_receipt() {
    let (_temp, req) = fixture();
    let target = Path::new(&req.worktree_path);
    fs::write(target.join("base"), "dirty").unwrap();
    fs::write(target.join("new"), "unmerged").unwrap();
    git(target, &["add", "new"]);
    git(target, &["commit", "-m", "unmerged"]);
    let project = Path::new(&req.project_path);
    let oid = git(project, &["rev-parse", "wt/task"]);
    let head = git(project, &["rev-parse", "HEAD"]);
    let auth = inspect_force(&req).unwrap();
    assert!(execute(&req, &auth).unwrap().done);
    assert!(!target.exists());
    assert_eq!(auth.branch_oid.as_deref(), Some(oid.as_str()));
    assert!(branch_state(&context(req.clone()).unwrap(), false)
        .unwrap()
        .is_none());
    assert_eq!(git(project, &["rev-parse", "HEAD"]), head);
    assert!(context(req.clone())
        .unwrap()
        .journal
        .load()
        .unwrap()
        .is_none());
}
#[test]
fn force_delete_nonempty_unknown_residual_and_missing_sql_retry() {
    let (_temp, req) = fixture();
    unregister(&req);
    let target = Path::new(&req.worktree_path);
    fs::write(target.join("unknown"), "must confirm").unwrap();
    let auth = inspect_force(&req).unwrap();
    assert!(target.join("unknown").exists());
    assert!(execute(&req, &auth).unwrap().done);
    assert!(branch_state(&context(req.clone()).unwrap(), false)
        .unwrap()
        .is_none());
    // SQL failed: re-inspection is missing-path finalization, not a merge claim.
    let auth = inspect_force(&req).unwrap();
    assert!(auth.path_missing);
    assert!(execute(&req, &auth).unwrap().done);
}
#[test]
fn force_delete_protected_main_linked_project_ancestors_admin_and_traversal() {
    let (_temp, req) = fixture();
    let project = Path::new(&req.project_path);
    let linked = project.with_extension("linked");
    git(
        project,
        &[
            "worktree",
            "add",
            "-b",
            "integration",
            linked.to_str().unwrap(),
        ],
    );
    let mut linked_req = req.clone();
    linked_req.project_path = linked.to_str().unwrap().into();
    for target in [
        project.to_path_buf(),
        project.parent().unwrap().to_path_buf(),
        project.join(".git"),
        project.join(".git/objects"),
        linked.clone(),
        Path::new(&req.worktree_path).join("../task"),
    ] {
        let mut bad = linked_req.clone();
        bad.worktree_path = target.to_str().unwrap().into();
        assert!(inspect_force(&bad).is_err(), "{}", bad.worktree_path);
    }
    assert!(inspect_force(&linked_req).is_ok());
    assert!(project.join("base").exists());
}
#[test]
fn force_delete_branch_path_mismatch_and_other_registered_child() {
    let (_temp, req) = fixture();
    let mut bad = req.clone();
    bad.branch = "wt/other".into();
    assert!(inspect_force(&bad).is_err());
    let auth = inspect_force(&req).unwrap();
    let nested = Path::new(&req.worktree_path).join("nested");
    git(
        Path::new(&req.project_path),
        &[
            "worktree",
            "add",
            "-b",
            "wt/nested",
            nested.to_str().unwrap(),
        ],
    );
    assert!(execute(&req, &auth).is_err());
    assert!(nested.join("base").exists());
}
#[test]
fn force_delete_replaced_root_and_changed_registration_rejected() {
    let (_temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    let target = Path::new(&req.worktree_path);
    let old = target.with_extension("original");
    fs::rename(target, &old).unwrap();
    fs::create_dir(target).unwrap();
    fs::write(target.join("keep"), "replacement").unwrap();
    assert!(execute(&req, &auth).is_err());
    assert!(target.join("keep").exists());
    fs::remove_dir_all(target).unwrap();
    fs::rename(&old, target).unwrap();
    let auth = inspect_force(&req).unwrap();
    git(
        Path::new(&req.project_path),
        &["worktree", "lock", &req.worktree_path],
    );
    assert_eq!(
        execute(&req, &auth).unwrap_err(),
        "force_delete_identity_changed"
    );
}
#[test]
fn force_delete_failure_consumes_token_and_requires_reconfirmation() {
    let (_temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    let error = execute_with_remover(&req, &auth.token, &auth.confirmed_path, |_| {
        Err(io::Error::other("injected deletion failure"))
    })
    .unwrap_err();
    assert!(error.contains("injected deletion failure"));
    assert!(execute(&req, &auth).is_err());
    let auth = inspect_force(&req).unwrap();
    let error = execute_with_remover(&req, &auth.token, &auth.confirmed_path, |_| {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            "inner entry missing",
        ))
    })
    .unwrap_err();
    assert_eq!(error, "worktree_remove_incomplete");
    assert!(Path::new(&req.worktree_path).exists());
    let auth = inspect_force(&req).unwrap();
    assert!(execute(&req, &auth).unwrap().done);
}
#[test]
fn force_delete_retryable_failure_retries_only_same_confirmed_operation() {
    let (_temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    let mut calls = 0;
    execute_with_remover(&req, &auth.token, &auth.confirmed_path, |path| {
        calls += 1;
        if calls == 1 {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "temporary lock",
            ))
        } else {
            unlink_tree(path)
        }
    })
    .unwrap();
    assert_eq!(calls, 2);
}
#[cfg(unix)]
#[test]
fn force_delete_internal_symlinks_unlinked_external_unchanged_and_ancestor_denied() {
    use std::os::unix::fs::symlink;
    let (temp, req) = fixture();
    let external = temp.path().join("outside");
    fs::create_dir(&external).unwrap();
    fs::write(external.join("keep"), "keep").unwrap();
    symlink(&external, Path::new(&req.worktree_path).join("link")).unwrap();
    let alias = temp.path().join("alias");
    symlink(Path::new(&req.worktree_path), &alias).unwrap();
    let mut bad = req.clone();
    bad.worktree_path = alias.join("child").to_str().unwrap().into();
    assert!(inspect_force(&bad).is_err());
    let auth = inspect_force(&req).unwrap();
    execute(&req, &auth).unwrap();
    assert_eq!(fs::read_to_string(external.join("keep")).unwrap(), "keep");
}
#[cfg(windows)]
#[test]
fn force_delete_internal_junction_unlinked_external_unchanged_and_ancestor_denied() {
    let (temp, req) = fixture();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), "keep").unwrap();
    let junction = Path::new(&req.worktree_path).join("junction");
    let out = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            junction.to_str().unwrap(),
            outside.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    let mut bad = req.clone();
    bad.worktree_path = junction.join("child").to_str().unwrap().into();
    assert!(inspect_force(&bad).is_err());
    let auth = inspect_force(&req).unwrap();
    execute(&req, &auth).unwrap();
    assert_eq!(fs::read_to_string(outside.join("keep")).unwrap(), "keep");
}

#[test]
fn force_delete_validate_repeat_readonly_retains_original_authorization() {
    let (_temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    let issued = authorizations()
        .lock()
        .unwrap()
        .get(&auth.token)
        .unwrap()
        .issued;
    let before = binding(&req).unwrap().1;
    for _ in 0..2 {
        let checked = validate_force(&req, &auth.token, &auth.confirmed_path).unwrap();
        assert_eq!(checked.token, auth.token);
        assert_eq!(checked.confirmed_path, req.worktree_path);
        assert!(!checked.path_missing);
        assert!(checked.delete_branch);
        assert_eq!(checked.branch_oid, auth.branch_oid);
        assert!(binding(&req).unwrap().1 == before);
        assert_eq!(
            authorizations()
                .lock()
                .unwrap()
                .get(&auth.token)
                .unwrap()
                .issued,
            issued
        );
        assert!(context(req.clone())
            .unwrap()
            .journal
            .load()
            .unwrap()
            .is_none());
        assert!(Path::new(&req.worktree_path).join("base").exists());
    }
    assert!(execute(&req, &auth).unwrap().done);
}

#[test]
fn force_delete_validate_wrong_path_request_and_original_expiry_rejected() {
    let (_temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    assert_eq!(
        validate_force(&req, &auth.token, "wrong").unwrap_err(),
        "force_delete_confirmation_mismatch"
    );
    assert!(execute(&req, &auth).is_err());
    let auth = inspect_force(&req).unwrap();
    let mut wrong = req.clone();
    wrong.worktree_id = "other".into();
    assert_eq!(
        validate_force(&wrong, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_confirmation_mismatch"
    );
    assert!(execute(&req, &auth).is_err());
    let auth = inspect_force(&req).unwrap();
    validate_force(&req, &auth.token, &auth.confirmed_path).unwrap();
    authorizations()
        .lock()
        .unwrap()
        .get_mut(&auth.token)
        .unwrap()
        .issued = std::time::Instant::now() - Duration::from_secs(601);
    assert_eq!(
        validate_force(&req, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_confirmation_expired"
    );
    assert!(execute(&req, &auth).is_err());
    assert!(Path::new(&req.worktree_path).join("base").exists());
}

#[test]
fn force_delete_validate_original_root_replacement_and_registration_rejected() {
    let (_temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    let target = Path::new(&req.worktree_path);
    let old = target.with_extension("original");
    fs::rename(target, &old).unwrap();
    fs::create_dir(target).unwrap();
    fs::write(target.join("keep"), "replacement").unwrap();
    assert_eq!(
        validate_force(&req, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_identity_changed"
    );
    assert!(execute(&req, &auth).is_err());
    assert!(target.join("keep").exists());
    fs::remove_dir_all(target).unwrap();
    fs::rename(old, target).unwrap();
    let auth = inspect_force(&req).unwrap();
    git(
        Path::new(&req.project_path),
        &["worktree", "lock", &req.worktree_path],
    );
    assert_eq!(
        validate_force(&req, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_identity_changed"
    );
    assert!(target.join("base").exists());
}

#[test]
fn force_delete_unrelated_missing_registration_blocks_before_delete() {
    let (temp, req) = fixture();
    let auth = inspect_force(&req).unwrap();
    let other = temp.path().join("other");
    let project = Path::new(&req.project_path);
    git(
        project,
        &["worktree", "add", "-b", "wt/other", other.to_str().unwrap()],
    );
    fs::remove_dir_all(&other).unwrap();
    let registrations = git(project, &["worktree", "list", "--porcelain"]);
    assert_eq!(
        inspect_force(&req).unwrap_err(),
        "force_delete_unrelated_prune"
    );
    assert_eq!(
        validate_force(&req, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_unrelated_prune"
    );
    assert_eq!(
        git(project, &["worktree", "list", "--porcelain"]),
        registrations
    );
    assert!(Path::new(&req.worktree_path).join("base").exists());
    assert!(execute(&req, &auth).is_err());
    git(project, &["rev-parse", "wt/other"]);
}

#[test]
fn force_delete_prune_rechecked_after_removal_preserves_other_registration() {
    let (temp, req) = fixture();
    let other = temp.path().join("other");
    let project = Path::new(&req.project_path);
    git(
        project,
        &["worktree", "add", "-b", "wt/other", other.to_str().unwrap()],
    );
    let auth = inspect_force(&req).unwrap();
    let err = execute_with_remover(&req, &auth.token, &auth.confirmed_path, |path| {
        unlink_tree(path)?;
        fs::remove_dir_all(&other)
    })
    .unwrap_err();
    assert_eq!(err, "force_delete_unrelated_prune");
    assert!(worktree_path_registered(project, &other).unwrap());
    assert!(worktree_path_registered(project, Path::new(&req.worktree_path)).unwrap());
    git(project, &["rev-parse", "wt/task"]);
    git(project, &["rev-parse", "wt/other"]);
}

#[test]
fn force_delete_missing_path_branch_and_all_missing_complete() {
    let (_temp, req) = fixture();
    fs::remove_dir_all(&req.worktree_path).unwrap();
    let auth = inspect_force(&req).unwrap();
    assert!(auth.path_missing && auth.delete_branch && auth.branch_oid.is_some());
    let done = execute(&req, &auth).unwrap();
    assert!(done.done && done.branch_deleted);
    let auth = inspect_force(&req).unwrap();
    assert!(auth.path_missing && auth.branch_oid.is_none());
    assert!(execute(&req, &auth).unwrap().branch_deleted);
}

#[test]
fn force_delete_missing_ref_recreated_and_tip_advanced_reject_before_removal() {
    let (_temp, req) = fixture();
    unregister(&req);
    let project = Path::new(&req.project_path);
    git(project, &["branch", "-D", "wt/task"]);
    let auth = inspect_force(&req).unwrap();
    assert!(auth.branch_oid.is_none());
    git(project, &["branch", "wt/task"]);
    assert_eq!(
        validate_force(&req, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_identity_changed"
    );
    assert!(execute(&req, &auth).is_err());
    assert!(Path::new(&req.worktree_path).join("base").exists());
    let auth = inspect_force(&req).unwrap();
    git(project, &["commit", "--allow-empty", "-m", "advance"]);
    git(project, &["branch", "-f", "wt/task", "HEAD"]);
    assert_eq!(
        execute(&req, &auth).unwrap_err(),
        "force_delete_identity_changed"
    );
    assert!(Path::new(&req.worktree_path).exists());
    let auth = inspect_force(&req).unwrap();
    git(project, &["commit", "--allow-empty", "-m", "advance-again"]);
    git(project, &["branch", "-f", "wt/task", "HEAD"]);
    assert_eq!(
        validate_force(&req, &auth.token, &auth.confirmed_path).unwrap_err(),
        "force_delete_identity_changed"
    );
}

#[test]
fn force_delete_branch_used_by_main_or_other_and_base_nonwt_rejected() {
    let (temp, req) = fixture();
    let mut bad = req.clone();
    bad.base_branch = req.branch.clone();
    assert!(inspect_force(&bad).is_err());
    bad = req.clone();
    bad.branch = "main".into();
    assert!(inspect_force(&bad).is_err());
    bad.branch = "wt/../invalid".into();
    assert!(inspect_force(&bad).is_err());
    unregister(&req);
    let project = Path::new(&req.project_path);
    let auth = inspect_force(&req).unwrap();
    git(project, &["checkout", "wt/task"]);
    assert_eq!(
        inspect_force(&req).unwrap_err(),
        "force_delete_branch_in_use"
    );
    assert!(validate_force(&req, &auth.token, &auth.confirmed_path).is_err());
    git(project, &["checkout", "main"]);
    let auth = inspect_force(&req).unwrap();
    let other = temp.path().join("other");
    git(
        project,
        &["worktree", "add", other.to_str().unwrap(), "wt/task"],
    );
    assert_eq!(
        inspect_force(&req).unwrap_err(),
        "force_delete_branch_in_use"
    );
    assert!(execute(&req, &auth).is_err());
    assert!(other.join("base").exists());
    assert!(Path::new(&req.worktree_path).exists());
}

#[test]
fn force_delete_post_removal_tip_change_fenced_and_fresh_missing_retry() {
    let (_temp, req) = fixture();
    let project = Path::new(&req.project_path);
    let auth = inspect_force(&req).unwrap();
    let err = execute_with_remover(&req, &auth.token, &auth.confirmed_path, |path| {
        unlink_tree(path)?;
        git(
            project,
            &["commit", "--allow-empty", "-m", "external-advance"],
        );
        git(project, &["update-ref", "refs/heads/wt/task", "HEAD"]);
        Ok(())
    })
    .unwrap_err();
    assert_eq!(err, "force_delete_branch_changed");
    assert!(!Path::new(&req.worktree_path).exists());
    assert!(branch_state(&context(req.clone()).unwrap(), false)
        .unwrap()
        .is_some());
    assert!(execute(&req, &auth).is_err());
    let fresh = inspect_force(&req).unwrap();
    assert!(fresh.path_missing);
    assert!(execute(&req, &fresh).unwrap().branch_deleted);
    assert!(context(req.clone())
        .unwrap()
        .journal
        .load()
        .unwrap()
        .is_none());
}

#[test]
fn force_delete_branch_lock_failure_consumed_and_missing_path_retry() {
    let (_temp, req) = fixture();
    let ctx = context(req.clone()).unwrap();
    let auth = inspect_force(&req).unwrap();
    let lock = ctx.common.join("refs/heads/wt/task.lock");
    fs::write(&lock, "injected external ref lock").unwrap();
    let err = execute(&req, &auth).unwrap_err();
    assert!(err.contains("force_delete_branch_delete_failed"), "{err}");
    assert!(!ctx.target.exists());
    assert!(!worktree_path_registered(&ctx.project, &ctx.target).unwrap());
    assert!(branch_state(&ctx, false).unwrap().is_some());
    assert!(ctx.journal.load().unwrap().is_none());
    assert!(execute(&req, &auth).is_err());
    fs::remove_file(lock).unwrap();
    let fresh = inspect_force(&req).unwrap();
    assert!(fresh.path_missing);
    assert!(execute(&req, &fresh).unwrap().branch_deleted);
}

#[test]
fn force_delete_post_removal_recreation_and_branch_use_fenced() {
    for use_main in [false, true] {
        let (_temp, req) = fixture();
        unregister(&req);
        let project = Path::new(&req.project_path);
        if !use_main {
            git(project, &["branch", "-D", "wt/task"]);
        }
        let auth = inspect_force(&req).unwrap();
        let err = execute_with_remover(&req, &auth.token, &auth.confirmed_path, |path| {
            unlink_tree(path)?;
            if use_main {
                git(project, &["checkout", "wt/task"]);
            } else {
                git(project, &["branch", "wt/task"]);
            }
            Ok(())
        })
        .unwrap_err();
        assert_eq!(
            err,
            if use_main {
                "force_delete_branch_in_use"
            } else {
                "force_delete_branch_changed"
            }
        );
        assert!(open_main_repo(&req.project_path)
            .unwrap()
            .find_reference("refs/heads/wt/task")
            .is_ok());
        assert!(context(req.clone())
            .unwrap()
            .journal
            .load()
            .unwrap()
            .is_none());
    }
}

#[test]
fn force_delete_registered_missing_branch_still_cleans_directory() {
    let (_temp, req) = fixture();
    let project = Path::new(&req.project_path);
    git(project, &["update-ref", "-d", "refs/heads/wt/task"]);
    fs::write(
        Path::new(&req.worktree_path).join("unknown"),
        "lost checkout tip",
    )
    .unwrap();
    let auth = inspect_force(&req).unwrap();
    assert!(auth.branch_oid.is_none());
    assert!(execute(&req, &auth).unwrap().branch_deleted);
    assert!(!Path::new(&req.worktree_path).exists());
}
