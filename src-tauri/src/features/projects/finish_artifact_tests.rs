fn installed_npm(root: &Path) {
    fs::create_dir_all(root.join("dep")).unwrap();
    fs::write(
        root.join("dep/package.json"),
        r#"{"name":"dep","version":"1.0.0"}"#,
    )
    .unwrap();
}
use super::*;
use crate::commands::git_worktree::finish::tests::{fixture, git, unregister};
fn node(ctx: &Context) {
    fs::write(
        ctx.target.join("package.json"),
        r#"{"name":"test","dependencies":{"dep":"1.0.0"}}"#,
    )
    .unwrap();
    fs::write(ctx.target.join(".gitignore"), "node_modules/\n").unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "node"]);
    fs::create_dir(ctx.target.join("node_modules")).unwrap();
    fs::write(
        ctx.target.join("node_modules/.package-lock.json"),
        r#"{"lockfileVersion":3,"packages":{"node_modules/dep":{"version":"1.0.0"}}}"#,
    )
    .unwrap();
    installed_npm(&ctx.target.join("node_modules"));
    fs::write(
        ctx.target.join("node_modules/data"),
        "cache or manually placed data",
    )
    .unwrap();
}
#[test]
fn artifact_merge_independent_of_sparse_large_unknown_and_cache() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    let file = fs::File::create(ctx.target.join("node_modules/large")).unwrap();
    #[cfg(windows)]
    {
        assert!(std::process::Command::new("fsutil")
            .args([
                "sparse",
                "setflag",
                ctx.target.join("node_modules/large").to_str().unwrap()
            ])
            .status()
            .unwrap()
            .success());
    }
    file.set_len(7 * 1024 * 1024 * 1024).unwrap();
    let state = merge(&ctx, false).unwrap();
    assert!(state.merged && state.cleanup_plan_required);
    assert!(load(&ctx).unwrap().unwrap().ownership.is_none());
    assert_eq!(
        cleanup(&ctx, true).unwrap_err(),
        "finish_cleanup_confirmation_required"
    );
    let p = plan(&ctx, true).unwrap();
    assert_eq!(p.candidates.len(), 1);
    let limits = artifact_manifest::Budgets {
        bytes: 1024,
        ..Default::default()
    };
    assert!(
        artifact_manifest::prepare(&ctx, &[p.candidates[0].path.clone()], limits)
            .unwrap_err()
            .contains("content_bytes")
    );
    assert!(ctx.target.join("node_modules/large").exists());
}
#[test]
fn artifact_confirmed_cleanup_and_unknown_preserved() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    fs::write(ctx.common.join("info/exclude"), "unknown.log\n").unwrap();
    fs::write(ctx.target.join("unknown.log"), "user data").unwrap();
    let p = plan(&ctx, true).unwrap();
    assert_eq!(p.preserved.len(), 1);
    assert!(execute(&ctx, true, &p.token)
        .unwrap_err()
        .contains("preserved"));
    assert!(ctx.target.join("node_modules/data").exists());
    fs::remove_file(ctx.target.join("unknown.log")).unwrap();
    let p = plan(&ctx, true).unwrap();
    assert!(validate(&ctx, true, &p.token).is_ok());
    assert!(execute(&ctx, true, &p.token).unwrap().done);
    assert_eq!(load(&ctx).unwrap().unwrap().version, 2);
}
#[test]
fn artifact_plan_changed_request_root_ignore_tracking_source_and_no_replacement() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    let p = plan(&ctx, true).unwrap();
    assert_eq!(
        validate(&ctx, false, &p.token).err().unwrap(),
        "finish_plan_request_changed"
    );
    fs::write(ctx.common.join("info/exclude"), "other\n").unwrap();
    assert_eq!(
        validate(&ctx, true, &p.token).err().unwrap(),
        "finish_plan_changed"
    );
    assert!(ctx.target.join("node_modules/data").exists());
}
#[test]
fn artifact_partial_registered_and_unregistered_recovery_never_adopts_new_content() {
    for registered in [true, false] {
        let (_temp, ctx) = fixture();
        node(&ctx);
        merge(&ctx, false).unwrap();
        let p = plan(&ctx, true).unwrap();
        let a = validate(&ctx, true, &p.token).unwrap();
        let mut r = load(&ctx).unwrap().unwrap();
        r.artifacts = Some(
            artifact_manifest::prepare(&ctx, &[p.candidates[0].path.clone()], Default::default())
                .unwrap(),
        );
        r.ownership = a.ordinary;
        r.version = 2;
        r.phase = "cleanup_intent".into();
        r.delete_branch = Some(true);
        ctx.journal.save(&r).unwrap();
        fs::remove_file(ctx.target.join("node_modules/data")).unwrap();
        if !registered {
            unregister(&ctx);
            fs::remove_file(ctx.target.join("base")).unwrap();
        }
        fs::write(ctx.target.join("node_modules/new"), "do not adopt").unwrap();
        assert!(cleanup(&ctx, true)
            .unwrap_err()
            .contains("finish_artifact_changed"));
        fs::remove_file(ctx.target.join("node_modules/new")).unwrap();
        assert!(cleanup(&ctx, true).unwrap().done);
    }
}
#[test]
fn artifact_nested_git_corrupt_manifest_and_intent_write_failure_stop_before_delete() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    fs::create_dir(ctx.target.join("node_modules/nested")).unwrap();
    fs::write(
        ctx.target.join("node_modules/nested/.git"),
        "gitdir: somewhere",
    )
    .unwrap();
    assert!(plan(&ctx, true).unwrap_err().contains("nested_git"));
    fs::remove_file(ctx.target.join("node_modules/nested/.git")).unwrap();
    let p = plan(&ctx, true).unwrap();
    receipt::fail_next_save();
    assert!(execute(&ctx, true, &p.token)
        .unwrap_err()
        .contains("write_failed"));
    assert!(ctx.target.join("node_modules/data").exists());
    let m = artifact_manifest::prepare(&ctx, &[p.candidates[0].path.clone()], Default::default())
        .unwrap();
    fs::write(
        ctx.common
            .join("cli-manager-finish/test-id")
            .join(&m.directory)
            .join("0.jsonl"),
        "corrupt",
    )
    .unwrap();
    assert!(artifact_manifest::remove(&ctx, &m)
        .unwrap_err()
        .contains("manifest_corrupt"));
    assert!(ctx.target.join("node_modules/data").exists());
}
#[test]
fn artifact_injected_entry_manifest_and_time_budgets() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    let root = path_to_git_arg(&ctx.target.join("node_modules"));
    for limits in [
        artifact_manifest::Budgets {
            entries: 1,
            ..Default::default()
        },
        artifact_manifest::Budgets {
            manifest: 1,
            ..Default::default()
        },
        artifact_manifest::Budgets {
            time: Duration::ZERO,
            ..Default::default()
        },
    ] {
        assert!(artifact_manifest::prepare(&ctx, &[root.clone()], limits)
            .unwrap_err()
            .contains("finish_artifact_budget"));
    }
}
#[cfg(unix)]
#[test]
fn artifact_internal_link_unlinks_not_target_and_root_link_denied() {
    use std::os::unix::fs::symlink;
    let (_temp, ctx) = fixture();
    node(&ctx);
    let outside = ctx.project.join("base");
    symlink(&outside, ctx.target.join("node_modules/link")).unwrap();
    merge(&ctx, false).unwrap();
    let p = plan(&ctx, true).unwrap();
    assert!(execute(&ctx, true, &p.token).unwrap().done);
    assert_eq!(fs::read_to_string(outside).unwrap(), "base\n");
}
#[test]
fn artifact_cargo_nested_default_workspace_and_custom_config() {
    let (_temp, ctx) = fixture();
    fs::create_dir(ctx.target.join("rust")).unwrap();
    fs::write(
        ctx.target.join("rust/Cargo.toml"),
        "[workspace]\nmembers=['dep']\n",
    )
    .unwrap();
    fs::create_dir_all(ctx.target.join("rust/dep/src")).unwrap();
    fs::write(
        ctx.target.join("rust/dep/Cargo.toml"),
        "[package]\nname='dep'\nversion='1.0.0'\n",
    )
    .unwrap();
    fs::write(ctx.target.join("rust/dep/src/lib.rs"), "").unwrap();
    fs::write(ctx.target.join(".gitignore"), "target/\n").unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "cargo"]);
    fs::create_dir(ctx.target.join("rust/target")).unwrap();
    fs::write(
        ctx.target.join("rust/target/CACHEDIR.TAG"),
        "Signature: 8a477f597d28d172789f06886806bc55\n",
    )
    .unwrap();
    cargo_output(&ctx.target.join("rust/target"));
    assert_eq!(
        artifact_classify::classify(&ctx).unwrap().candidates.len(),
        1
    );
    fs::create_dir(ctx.target.join(".cargo")).unwrap();
    fs::write(
        ctx.target.join(".cargo/config.toml"),
        "[build]\ntarget-dir='shared'\n",
    )
    .unwrap();
    assert!(artifact_classify::classify(&ctx)
        .unwrap()
        .candidates
        .is_empty());
}
#[test]
fn artifact_node_workspace_and_tracked_cache_shaped_not_authorized() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    fs::write(
        ctx.target.join("package.json"),
        r#"{"workspaces":["packages/*"],"dependencies":{"dep":"1.0.0"}}"#,
    )
    .unwrap();
    fs::create_dir_all(ctx.target.join("packages/a/node_modules")).unwrap();
    fs::write(
        ctx.target.join("packages/a/package.json"),
        r#"{"name":"a","dependencies":{"dep":"1.0.0"}}"#,
    )
    .unwrap();
    fs::write(
        ctx.target.join("packages/a/node_modules/.modules.yaml"),
        "layoutVersion: 5\npackageManager: pnpm@10\n",
    )
    .unwrap();
    let modules = ctx.target.join("packages/a/node_modules");
    installed_npm(&modules);
    fs::write(
        modules.join(".package-lock.json"),
        r#"{"lockfileVersion":3,"packages":{"node_modules/dep":{"version":"1.0.0"}}}"#,
    )
    .unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "workspace"]);
    assert_eq!(
        artifact_classify::classify(&ctx).unwrap().candidates.len(),
        2
    );
    fs::write(ctx.target.join("node_modules/tracked"), "source").unwrap();
    git(&ctx.target, &["add", "-f", "node_modules/tracked"]);
    git(&ctx.target, &["commit", "-m", "tracked"]);
    assert_eq!(
        artifact_classify::classify(&ctx).unwrap().candidates.len(),
        1
    );
}
#[cfg(windows)]
#[test]
fn artifact_windows_internal_junction_preserves_target_root_junction_denied() {
    use std::process::Command;
    let (_temp, ctx) = fixture();
    node(&ctx);
    let outside = ctx.project.with_extension("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), "keep").unwrap();
    let link = ctx.target.join("node_modules/link");
    assert!(Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            link.to_str().unwrap(),
            outside.to_str().unwrap()
        ])
        .output()
        .unwrap()
        .status
        .success());
    merge(&ctx, false).unwrap();
    let p = plan(&ctx, true).unwrap();
    assert!(execute(&ctx, true, &p.token).unwrap().done);
    assert_eq!(fs::read_to_string(outside.join("keep")).unwrap(), "keep");
}
#[test]
fn artifact_v1_intent_without_ownership_never_upgrades() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    let mut r = load(&ctx).unwrap().unwrap();
    r.version = 1;
    r.phase = "cleanup_intent".into();
    r.delete_branch = Some(true);
    ctx.journal.save(&r).unwrap();
    assert_eq!(
        plan(&ctx, true).unwrap_err(),
        "finish_legacy_residual_manual_review"
    );
    assert!(ctx.target.join("node_modules/data").exists());
}
#[test]
fn artifact_plan_candidate_root_replaced_and_manifest_content_changed_block() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    let p = plan(&ctx, true).unwrap();
    let root = ctx.target.join("node_modules");
    let old = ctx.target.join("old");
    fs::rename(&root, &old).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(
        root.join(".package-lock.json"),
        r#"{"lockfileVersion":3,"packages":{"node_modules/dep":{"version":"1.0.0"}}}"#,
    )
    .unwrap();
    fs::write(root.join("data"), "cache or manually placed data").unwrap();
    assert!(validate(&ctx, true, &p.token).is_err());
    fs::remove_dir_all(&root).unwrap();
    fs::rename(&old, &root).unwrap();
    let m = artifact_manifest::prepare(&ctx, &[p.candidates[0].path.clone()], Default::default())
        .unwrap();
    fs::write(root.join("data"), "modified content").unwrap();
    assert!(artifact_manifest::remove(&ctx, &m)
        .unwrap_err()
        .contains("finish_artifact_changed"));
    assert!(root.join("data").exists());
}
#[test]
fn artifact_v1_merged_new_preparation_can_classify_but_old_intent_cannot() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    let mut r = load(&ctx).unwrap().unwrap();
    r.version = 1;
    r.ownership = Some(receipt::snapshot(&ctx.target).unwrap());
    ctx.journal.save(&r).unwrap();
    let p = plan(&ctx, true).unwrap();
    assert!(execute(&ctx, true, &p.token).unwrap().done);
}
#[cfg(windows)]
#[test]
fn artifact_windows_root_junction_denied_and_locked_content_not_deleted() {
    use std::os::windows::fs::OpenOptionsExt;
    use std::process::Command;
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    let m = artifact_manifest::prepare(
        &ctx,
        &[path_to_git_arg(&ctx.target.join("node_modules"))],
        Default::default(),
    )
    .unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(ctx.target.join("node_modules/data"))
        .unwrap();
    assert!(artifact_manifest::remove(&ctx, &m).is_err());
    assert!(ctx.target.join("node_modules/data").exists());
    drop(locked);
    fs::remove_dir_all(ctx.target.join("node_modules")).unwrap();
    let outside = ctx.project.with_extension("cache");
    fs::create_dir(&outside).unwrap();
    fs::write(
        outside.join(".package-lock.json"),
        r#"{"lockfileVersion":3,"packages":{"node_modules/dep":{"version":"1.0.0"}}}"#,
    )
    .unwrap();
    assert!(Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            ctx.target.join("node_modules").to_str().unwrap(),
            outside.to_str().unwrap()
        ])
        .output()
        .unwrap()
        .status
        .success());
    assert_eq!(plan(&ctx, true).unwrap_err(), "finish_artifact_root_link");
    assert!(outside.join(".package-lock.json").exists());
}
#[test]
fn artifact_guard_loss_after_intent_before_first_delete_retains_recoverable_evidence() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    merge(&ctx, false).unwrap();
    let p = plan(&ctx, true).unwrap();
    let mut checks = 0;
    let error = execute_guarded(&ctx, true, &p.token, || {
        checks += 1;
        if checks >= 3 {
            Err("lost cleanup fence".into())
        } else {
            Ok(())
        }
    })
    .unwrap_err();
    assert_eq!(error, "lost cleanup fence");
    assert!(ctx.target.join("node_modules/data").exists());
    assert_eq!(load(&ctx).unwrap().unwrap().phase, "cleanup_intent");
    assert!(cleanup(&ctx, true).unwrap().done);
}
#[test]
fn artifact_ordinary_snapshot_counts_content_once_and_entry_limits_still_apply() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join("file"), [1u8; 200]).unwrap();
    assert!(receipt::snapshot_with_limits(temp.path(), &[], 200, 1).is_ok());
    assert_eq!(
        receipt::snapshot_with_limits(temp.path(), &[], 199, 1).unwrap_err(),
        "finish_snapshot_limit"
    );
    assert_eq!(
        receipt::snapshot_with_limits(temp.path(), &[], 200, 0).unwrap_err(),
        "finish_snapshot_limit"
    );
}
#[test]
fn artifact_large_unknown_ignored_log_merges_but_never_authorizes_delete() {
    let (_temp, ctx) = fixture();
    fs::write(ctx.common.join("info/exclude"), "unknown.log\n").unwrap();
    let path = ctx.target.join("unknown.log");
    let file = fs::File::create(&path).unwrap();
    #[cfg(windows)]
    assert!(std::process::Command::new("fsutil")
        .args(["sparse", "setflag", path.to_str().unwrap()])
        .status()
        .unwrap()
        .success());
    file.set_len(7 * 1024 * 1024 * 1024).unwrap();
    drop(file);
    let state = merge(&ctx, false).unwrap();
    assert!(state.merged);
    let p = plan(&ctx, true).unwrap();
    assert!(p.candidates.is_empty());
    assert_eq!(p.preserved[0].path, path_to_git_arg(&path));
    assert!(execute(&ctx, true, &p.token)
        .unwrap_err()
        .contains("finish_unknown_content_preserved"));
    assert!(path.exists());
}

fn cargo_output(target: &Path) {
    fs::create_dir_all(target.join("debug/deps")).unwrap();
    fs::create_dir_all(target.join("debug/.fingerprint/dep-abc")).unwrap();
    fs::write(target.join("debug/deps/libdep-abc.rlib"), "build output").unwrap();
    fs::write(target.join(".rustc_info.json"), r#"{"rustc_fingerprint":123,"outputs":{"123":{"success":true,"status":"exit status: 0","stdout":"rustc 1.90.0","stderr":""}}}"#).unwrap();
    fs::write(
        target.join("debug/.fingerprint/dep-abc/lib-dep.json"),
        r#"{"rustc":123,"deps":[],"target":456}"#,
    )
    .unwrap();
}
#[test]
fn artifact_registered_ordinary_partial_recovery_and_counterexamples() {
    for registered in [true, false] {
        let (_temp, ctx) = fixture();
        merge(&ctx, false).unwrap();
        let mut r = load(&ctx).unwrap().unwrap();
        r.ownership = Some(receipt::snapshot(&ctx.target).unwrap());
        r.phase = "cleanup_intent".into();
        r.delete_branch = Some(true);
        ctx.journal.save(&r).unwrap();
        fs::remove_file(ctx.target.join("base")).unwrap();
        if !registered {
            unregister(&ctx);
        }
        assert!(inspect(&ctx).unwrap().cleanup_ready);
        fs::write(ctx.target.join("new"), "new").unwrap();
        assert!(plan(&ctx, true).is_err());
        fs::remove_file(ctx.target.join("new")).unwrap();
        fs::write(ctx.target.join("task"), "changed").unwrap();
        assert!(cleanup(&ctx, true).is_err());
        fs::write(
            ctx.target.join("task"),
            "task
",
        )
        .unwrap();
        if registered {
            git(&ctx.target, &["commit", "--allow-empty", "-m", "advanced"]);
            assert!(plan(&ctx, true).unwrap_err().contains("source_changed"));
            git(&ctx.target, &["reset", "--soft", &r.source_oid]);
        }
        let p = plan(&ctx, true).unwrap();
        assert!(execute(&ctx, true, &p.token).unwrap().done);
    }
}
#[test]
fn artifact_historical_registered_plan_execute_without_receipt() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    git(&ctx.project, &["merge", "--no-ff", "--no-edit", "wt/task"]);
    assert!(load(&ctx).unwrap().is_none());
    let p = plan(&ctx, true).unwrap();
    assert!(execute(&ctx, true, &p.token).unwrap().done);
}
#[test]
fn artifact_cancel_invalidates_request_token_reclaims_capacity_and_repeats() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let p = plan(&ctx, true).unwrap();
    let original = plans().lock().unwrap().get(&p.token).unwrap().clone();
    let mut wrong = context(ctx.request.clone()).unwrap();
    wrong.request.worktree_id = "wrong".into();
    assert!(cancel(&wrong, &p.token).is_err());
    assert!(validate(&ctx, true, &p.token).is_ok());
    cancel(&ctx, &p.token).unwrap();
    cancel(&ctx, &p.token).unwrap();
    assert_eq!(
        validate(&ctx, true, &p.token).err().unwrap(),
        "finish_plan_unknown"
    );
    // Fill real bounded map without seventy redundant Git preflight scans.
    let mut tokens = vec![];
    {
        let mut cache = plans().lock().unwrap();
        cache.clear();
        for _ in 0..64 {
            let token = uuid::Uuid::new_v4().to_string();
            cache.insert(token.clone(), original.clone());
            tokens.push(token);
        }
    }
    assert_eq!(plan(&ctx, true).unwrap_err(), "finish_plan_limit");
    cancel(&ctx, &tokens[0]).unwrap();
    let next = plan(&ctx, true).unwrap();
    cancel(&ctx, &next.token).unwrap();
    for token in tokens {
        cancel(&ctx, &token).unwrap();
    }
}
#[test]
fn artifact_native_same_content_file_and_directory_replacement_rejected() {
    for directory in [true, false] {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        fs::create_dir_all(root.join("dir")).unwrap();
        fs::write(root.join("dir/file"), "same").unwrap();
        let owned = receipt::snapshot(&root).unwrap();
        let path = root.join(if directory { "dir" } else { "dir/file" });
        fs::rename(&path, tmp.path().join("old")).unwrap();
        if directory {
            fs::create_dir(&path).unwrap();
            fs::write(path.join("file"), "same").unwrap();
        } else {
            fs::write(&path, "same").unwrap();
        }
        assert!(receipt::verify_subset(&root, &owned).is_err());
    }
    let (_temp, ctx) = fixture();
    node(&ctx);
    let root = ctx.target.join("node_modules");
    let m =
        artifact_manifest::prepare(&ctx, &[path_to_git_arg(&root)], Default::default()).unwrap();
    fs::rename(root.join("data"), ctx.project.join("old-data")).unwrap();
    fs::write(root.join("data"), "cache or manually placed data").unwrap();
    assert!(artifact_manifest::verify(&ctx, &m)
        .unwrap_err()
        .contains("changed"));
}
#[test]
fn artifact_forged_markers_without_installation_structure_preserved() {
    for (marker, value) in [
        (
            ".package-lock.json",
            r#"{"lockfileVersion":3,"packages":{}}"#,
        ),
        (
            ".modules.yaml",
            "layoutVersion: 5
packageManager: pnpm@10
",
        ),
        (
            ".yarn-state.yml",
            "__metadata:
version: 1
",
        ),
    ] {
        let (_temp, ctx) = fixture();
        node(&ctx);
        fs::remove_dir_all(ctx.target.join("node_modules")).unwrap();
        fs::create_dir(ctx.target.join("node_modules")).unwrap();
        fs::write(ctx.target.join("node_modules").join(marker), value).unwrap();
        let c = artifact_classify::classify(&ctx).unwrap();
        assert!(c.candidates.is_empty());
        assert!(!c.preserved.is_empty());
    }
    let (_temp, ctx) = fixture();
    fs::write(
        ctx.target.join("Cargo.toml"),
        "[package]
name='test'
version='1.0.0'
",
    )
    .unwrap();
    fs::write(
        ctx.target.join(".gitignore"),
        "target/
",
    )
    .unwrap();
    git(&ctx.target, &["add", "."]);
    git(&ctx.target, &["commit", "-m", "cargo"]);
    fs::create_dir(ctx.target.join("target")).unwrap();
    fs::write(
        ctx.target.join("target/CACHEDIR.TAG"),
        "Signature: 8a477f597d28d172789f06886806bc55
",
    )
    .unwrap();
    assert!(artifact_classify::classify(&ctx)
        .unwrap()
        .candidates
        .is_empty());
}

#[test]
fn artifact_real_pnpm_and_yarn_records_correspond_to_installation() {
    for pnpm in [true, false] {
        let (_temp, ctx) = fixture();
        node(&ctx);
        let root = ctx.target.join("node_modules");
        fs::remove_file(root.join(".package-lock.json")).unwrap();
        if pnpm {
            fs::create_dir_all(root.join(".pnpm/dep@1.0.0/node_modules/dep")).unwrap();
            fs::write(
                root.join(".pnpm/dep@1.0.0/node_modules/dep/package.json"),
                r#"{"name":"dep","version":"1.0.0"}"#,
            )
            .unwrap();
            fs::write(
                root.join(".pnpm/lock.yaml"),
                "lockfileVersion: '9.0'
packages:
  dep@1.0.0:
    resolution: {integrity: sha512-example}
",
            )
            .unwrap();
            fs::write(
                root.join(".modules.yaml"),
                "layoutVersion: 5
packageManager: pnpm@10.0.0
virtualStoreDir: .pnpm
",
            )
            .unwrap();
            fs::remove_dir_all(root.join("dep")).unwrap();
            #[cfg(windows)]
            {
                assert!(std::process::Command::new("cmd")
                    .args([
                        "/C",
                        "mklink",
                        "/J",
                        root.join("dep").to_str().unwrap(),
                        root.join(".pnpm/dep@1.0.0/node_modules/dep")
                            .to_str()
                            .unwrap()
                    ])
                    .output()
                    .unwrap()
                    .status
                    .success());
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(".pnpm/dep@1.0.0/node_modules/dep", root.join("dep"))
                .unwrap();
        } else {
            fs::write(
                root.join(".yarn-state.yml"),
                "__metadata:
  version: 1

\"dep@npm:1.0.0\":
  locations:
    - \"node_modules/dep\"
",
            )
            .unwrap();
        }
        assert_eq!(
            artifact_classify::classify(&ctx).unwrap().candidates.len(),
            1
        );
        if pnpm {
            fs::write(
                root.join(".pnpm/lock.yaml"),
                "lockfileVersion: '9.0'
packages: {}
",
            )
            .unwrap();
        } else {
            fs::write(
                root.join(".yarn-state.yml"),
                "__metadata:
  version: 1
\"other@npm:1.0.0\":
  locations:
    - \"node_modules/other\"
",
            )
            .unwrap();
        }
        assert!(artifact_classify::classify(&ctx)
            .unwrap()
            .candidates
            .is_empty());
    }
}

#[test]
fn artifact_legacy_content_only_intent_cannot_upgrade_native_evidence() {
    let (_temp, ctx) = fixture();
    merge(&ctx, false).unwrap();
    let mut r = load(&ctx).unwrap().unwrap();
    let owned = receipt::snapshot(&ctx.target).unwrap();
    let mut old = serde_json::to_value(owned).unwrap();
    for (_, value) in old.get_mut("entries").unwrap().as_object_mut().unwrap() {
        let value_str = value.as_str().unwrap();
        *value = serde_json::Value::String(if value_str.starts_with("dir:") {
            "dir".into()
        } else {
            format!("file:{}", value_str.rsplit(':').next().unwrap())
        });
    }
    r.ownership = Some(serde_json::from_value(old).unwrap());
    r.version = 1;
    r.phase = "cleanup_intent".into();
    r.delete_branch = Some(true);
    ctx.journal.save(&r).unwrap();
    assert_eq!(
        plan(&ctx, true).unwrap_err(),
        "finish_legacy_residual_manual_review"
    );
    assert!(ctx.target.join("task").exists());
}
#[cfg(windows)]
#[test]
fn artifact_native_same_target_junction_replacement_rejected() {
    let (_temp, ctx) = fixture();
    node(&ctx);
    let root = ctx.target.join("node_modules");
    let link = root.join("link");
    let outside = ctx.project.join("keep-dir");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), "keep").unwrap();
    let create = || {
        assert!(std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                link.to_str().unwrap(),
                outside.to_str().unwrap()
            ])
            .output()
            .unwrap()
            .status
            .success())
    };
    create();
    let m =
        artifact_manifest::prepare(&ctx, &[path_to_git_arg(&root)], Default::default()).unwrap();
    fs::rename(&link, ctx.project.join("old-link")).unwrap();
    create();
    assert!(artifact_manifest::verify(&ctx, &m)
        .unwrap_err()
        .contains("changed"));
    assert_eq!(fs::read_to_string(outside.join("keep")).unwrap(), "keep");
}

#[test]
fn artifact_postverification_ordinary_interleaving_never_adopts_fresh_content() {
    for modified in [true, false] {
        let (_temp, ctx) = fixture();
        node(&ctx);
        merge(&ctx, false).unwrap();
        // task is already tracked, so an ignore rule does not turn it into
        // unknown content; this exercises modification of existing ordinary
        // evidence separately from a newly created unknown ignored file.
        fs::write(ctx.common.join("info/exclude"), "late.log\ntask\n").unwrap();
        let p = plan(&ctx, true).unwrap();
        let path = ctx.target.join(if modified { "task" } else { "late.log" });
        let changed = path.clone();
        BEFORE_OWNERSHIP.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                fs::write(changed, "late user content").unwrap();
            }))
        });
        assert!(execute(&ctx, true, &p.token).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "late user content");
        assert_eq!(load(&ctx).unwrap().unwrap().phase, "merged");
        assert!(load(&ctx).unwrap().unwrap().ownership.is_none());
        assert!(ctx.target.join("node_modules/data").exists());
    }
}
#[test]
fn artifact_parent_replacement_after_verify_blocks_before_child_unlink() {
    for outside_root in [false, true] {
        let (_temp, ctx) = fixture();
        let parent = ctx.target.join("parent");
        let root = if outside_root {
            parent.join("node_modules")
        } else {
            ctx.target.join("node_modules")
        };
        let replaced = if outside_root { parent } else { root.join("parent") };
        let child = if outside_root { root.join("child") } else { replaced.join("child") };
        fs::create_dir_all(child.parent().unwrap()).unwrap();
        fs::write(&child, "same").unwrap();
        let identity = receipt::entry_identity(&child).unwrap();
        let m = artifact_manifest::prepare(
            &ctx, &[path_to_git_arg(&root)], Default::default(),
        ).unwrap();
        let mut checks = 0;
        let result = artifact_manifest::remove_guarded(&ctx, &m, || {
            checks += 1;
            if checks == 2 {
                let old = ctx.project.join("old-parent");
                fs::rename(&replaced, &old).unwrap();
                fs::create_dir(&replaced).unwrap();
                // Move the original subtree, preserving every child identity/hash.
                // Only the replaced parent's native identity can reject the unlink.
                let retained = if outside_root { "node_modules" } else { "child" };
                fs::rename(old.join(retained), replaced.join(retained)).unwrap();
                assert_eq!(receipt::entry_identity(&child).unwrap(), identity);
            }
            Ok(())
        });
        assert!(result.unwrap_err().contains("changed"));
        assert_eq!(fs::read_to_string(&child).unwrap(), "same");
    }
}
