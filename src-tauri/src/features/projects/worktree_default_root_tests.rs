use super::super::tests::{create_test_worktree, run_test_git};
use super::*;

#[test]
fn default_root_main_and_linked_share_stable_bucket() {
    let (temp, repo, linked) = create_test_worktree();
    let data = temp.path().join("active-data");
    let root = root_in_global_dir(&repo, &data).unwrap();
    assert_eq!(root, root_in_global_dir(&linked, &data).unwrap());
    assert_eq!(root, root_in_global_dir(&repo, &data).unwrap());
    assert_eq!(root.parent().unwrap(), data.clone());
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("repo-"));
    assert!(!data.exists());
    let other_data = temp.path().join("other-active-data");
    assert_eq!(
        root.file_name(),
        root_in_global_dir(&repo, &other_data).unwrap().file_name()
    );
}

#[test]
fn default_root_same_named_repositories_have_distinct_buckets() {
    let (temp_a, repo_a, _) = create_test_worktree();
    let (_temp_b, repo_b, _) = create_test_worktree();
    let data = temp_a.path().join("data");
    let a = root_in_global_dir(&repo_a, &data).unwrap();
    let b = root_in_global_dir(&repo_b, &data).unwrap();
    assert_ne!(a, b);
    assert!(a
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("repo-"));
    assert!(b
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("repo-"));
}

#[test]
fn default_root_rejects_data_inside_any_managed_checkout_before_creation() {
    let (temp, repo, linked) = create_test_worktree();
    for project in [&repo, &linked] {
        for data in [
            repo.clone(),
            repo.join("data"),
            linked.join("data"),
            repo.join(".git/data"),
        ] {
            assert_eq!(
                root_in_global_dir(project, &data).unwrap_err(),
                "worktree_default_root_inside_repository"
            );
        }
    }
    assert!(!repo.join("data").exists());
    assert!(!linked.join("data").exists());
    // Component comparison must not reject a sibling with the same string prefix.
    assert!(root_in_global_dir(&repo, &temp.path().join("repo-data")).is_ok());
}

#[test]
fn default_root_readable_names_are_windows_safe_and_bounded() {
    for input in [
        "CON",
        "NUL",
        "COM1",
        "LPT9",
        "bad<>:\"/\\|?*\n",
        "...",
        "项目",
        &"x".repeat(200),
    ] {
        let bucket = format!("{}-{}", readable_name(input), "a".repeat(64));
        assert!(!bucket
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch)));
        assert!(!bucket.ends_with(['.', ' ']));
        assert!(bucket.len() <= 225); // 40 UTF-8 characters plus '-' and SHA-256.
        assert!(!RESERVED_WINDOWS_NAMES
            .iter()
            .any(|name| bucket.eq_ignore_ascii_case(name)));
    }
    assert_eq!(readable_name("..."), "repository");
    assert_eq!(readable_name("项目"), "项目");
}

#[test]
fn default_root_bucket_cannot_redirect_into_checkout() {
    let (temp, repo, _) = create_test_worktree();
    let data = temp.path().join("data");
    let root = root_in_global_dir(&repo, &data).unwrap();
    fs::create_dir_all(root.parent().unwrap()).unwrap();
    #[cfg(windows)]
    {
        let output = Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &path_to_git_arg(&root),
                &path_to_git_arg(&repo),
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&repo, &root).unwrap();
    assert_eq!(
        root_in_global_dir(&repo, &data).unwrap_err(),
        "worktree_default_root_inside_repository"
    );
    // 全局根及尚未创建的子路径也不能经已有链接前缀进入 checkout。
    assert_eq!(
        root_in_global_dir(&repo, &root).unwrap_err(),
        "worktree_default_root_inside_repository"
    );
    assert_eq!(
        root_in_global_dir(&repo, &root.join("new-global")).unwrap_err(),
        "worktree_default_root_inside_repository"
    );
    // Unlink junction/symlink, never traverse the real checkout during fixture cleanup.
    #[cfg(windows)]
    fs::remove_dir(&root).unwrap();
    #[cfg(unix)]
    fs::remove_file(&root).unwrap();
    assert!(repo.join("base.txt").exists());
}

#[test]
fn default_root_creation_and_legacy_custom_paths_remain_independent() {
    let (temp, repo, _) = create_test_worktree();
    let legacy = temp.path().join("repo-worktrees");
    let old = super::super::create::create(GitWorktreeCreateRequest {
        project_path: path_to_git_arg(&repo),
        task_name: "old-task".into(),
        worktree_root: Some(path_to_git_arg(&legacy)),
    })
    .unwrap();
    let data = temp.path().join("data");
    let bucket = root_in_global_dir(&repo, &data).unwrap();
    let new = super::super::create::create(GitWorktreeCreateRequest {
        project_path: path_to_git_arg(&repo),
        task_name: "new-task".into(),
        worktree_root: Some(path_to_git_arg(&bucket)),
    })
    .unwrap();
    assert_eq!(
        local_path_from_input(&new.path).canonicalize().unwrap(),
        bucket.canonicalize().unwrap().join("new-task")
    );
    assert!(local_path_from_input(&old.path).exists());
    assert!(run_test_git(&repo, ["worktree", "list", "--porcelain"]).contains("old-task"));
    run_test_git(&repo, ["worktree", "remove", "--force", &old.path]);
    cleanup_empty_worktree_parent(&local_path_from_input(&old.path));
    assert!(!legacy.exists());
    assert!(local_path_from_input(&new.path).exists());
    run_test_git(&repo, ["worktree", "remove", "--force", &new.path]);
    cleanup_empty_worktree_parent(&local_path_from_input(&new.path));
    assert!(!bucket.exists());
    assert!(data.clone().exists());
}

#[test]
// 缺失/空配置使用临时 home，路径计算无目录写入，home 错误不吞掉。
fn default_root_settings_empty_values_use_home() {
    let temp = tempfile::tempdir().unwrap();
    let settings = temp.path().join("fixture-store");
    let home = temp.path().join("home");
    assert_eq!(
        configured_root(&settings, || Ok(home.clone())).unwrap(),
        home.join("Worktrees")
    );
    for json in [
        "{}",
        r#"{"worktreeDefaultRoot":""}"#,
        r#"{"worktreeDefaultRoot":"  "}"#,
    ] {
        fs::write(&settings, json).unwrap();
        assert_eq!(
            configured_root(&settings, || Ok(home.clone())).unwrap(),
            home.join("Worktrees")
        );
    }
    assert!(!home.exists());
    assert_eq!(
        configured_root(&settings, || Err("home_dir_unavailable".into())).unwrap_err(),
        "home_dir_unavailable"
    );
}

#[test]
// 自定义全局根不依赖 home；每次读取新落盘值，桶不重复追加 worktrees。
fn default_root_settings_custom_is_fresh_and_home_independent() {
    let (temp, repo, linked) = create_test_worktree();
    let settings = temp.path().join("fixture-store");
    for name in ["global-a", "global-b"] {
        let global = temp.path().join(name);
        fs::write(
            &settings,
            serde_json::json!({"worktreeDefaultRoot": format!("  {}  ", path_to_git_arg(&global))})
                .to_string(),
        )
        .unwrap();
        let base =
            configured_root(&settings, || panic!("custom global must not need home")).unwrap();
        assert_eq!(base, global);
        let bucket = root_in_global_dir(&repo, &base).unwrap();
        assert_eq!(bucket.parent().unwrap(), global);
        assert_eq!(bucket, root_in_global_dir(&linked, &base).unwrap());
        assert!(!base.exists());
    }
}

#[test]
// JSON、字段类型和读取错误必须显式失败，不执行 home fallback。
fn default_root_settings_bad_configuration_never_falls_back() {
    let temp = tempfile::tempdir().unwrap();
    let settings = temp.path().join("fixture-store");
    for (json, code) in [
        ("", "worktree_default_root_read_failed"),
        ("{bad", "worktree_default_root_read_failed"),
        ("[]", "worktree_default_root_read_failed"),
        (
            r#"{"worktreeDefaultRoot":null}"#,
            "worktree_default_root_invalid",
        ),
        (
            r#"{"worktreeDefaultRoot":42}"#,
            "worktree_default_root_invalid",
        ),
        (
            r#"{"worktreeDefaultRoot":{}}"#,
            "worktree_default_root_invalid",
        ),
        (
            r#"{"worktreeDefaultRoot":"relative"}"#,
            "worktree_default_root_invalid",
        ),
    ] {
        fs::write(&settings, json).unwrap();
        assert!(configured_root(&settings, || panic!("must not fall back"))
            .unwrap_err()
            .starts_with(code));
    }
    fs::remove_file(&settings).unwrap();
    fs::create_dir(&settings).unwrap();
    assert!(configured_root(&settings, || panic!("must not fall back"))
        .unwrap_err()
        .starts_with("worktree_default_root_read_failed"));
}

#[test]
// 非空项目根跳过全局读取；空项目根保留默认分支错误。
fn default_root_project_override_does_not_read_broken_global() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("project-root");
    assert_eq!(
        super::super::select_worktree_root(
            Some(&format!(" {} ", path_to_git_arg(&root))),
            || panic!("must skip global")
        )
        .unwrap(),
        root
    );
    for input in [None, Some(""), Some("  ")] {
        assert_eq!(
            super::super::select_worktree_root(input, || Err(
                "worktree_default_root_read_failed".into()
            ))
            .unwrap_err(),
            "worktree_default_root_read_failed"
        );
    }
}

#[test]
// 只读校验拒绝远程、相对、文件及文件前缀，允许未创建目录并去掉扩展前缀。
fn default_root_validation_is_read_only_and_rejects_unsafe_paths() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("file");
    fs::write(&file, "preserve").unwrap();
    for input in [
        "relative",
        "../up",
        r"\\server\share",
        r"\\wsl$\Ubuntu\home",
        r"\\wsl.localhost\Ubuntu\home",
        r"\\?\UNC\server\share",
        "ssh://host/path",
        "git@host:path",
        "bad\npath",
    ] {
        assert_eq!(
            validate(input).unwrap_err(),
            "worktree_default_root_invalid",
            "{input}"
        );
    }
    for path in [
        file.clone(),
        file.join("child"),
        temp.path().join("../escape"),
    ] {
        assert_eq!(
            validate(&path_to_git_arg(&path)).unwrap_err(),
            "worktree_default_root_invalid"
        );
    }
    let fresh = temp.path().join("new/deep");
    assert_eq!(
        validate(&format!("  {}  ", path_to_git_arg(&fresh))).unwrap(),
        path_to_git_arg(&fresh)
    );
    assert!(!fresh.exists());
    assert_eq!(validate("  ").unwrap(), "");
    assert_eq!(fs::read_to_string(&file).unwrap(), "preserve");
    #[cfg(windows)]
    {
        assert_eq!(
            validate(&format!(r"\\?\{}", path_to_git_arg(&fresh))).unwrap(),
            path_to_git_arg(&fresh)
        );
        for name in ["CON", "NUL.txt", "bad:name", "bad*name", "tail."] {
            assert_eq!(
                validate(&path_to_git_arg(&temp.path().join(name))).unwrap_err(),
                "worktree_default_root_invalid"
            );
        }
    }
}
