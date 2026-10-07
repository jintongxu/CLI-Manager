use super::*;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(repo)
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

fn fixture() -> (tempfile::TempDir, PathBuf, GitWorktreeCreateRequest) {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "--initial-branch", "main"]);
    git(&repo, &["config", "user.name", "Creation Tests"]);
    git(&repo, &["config", "user.email", "test@example.com"]);
    git(&repo, &["commit", "--allow-empty", "-m", "initial"]);
    let req = GitWorktreeCreateRequest {
        project_path: path_to_git_arg(&repo),
        task_name: "task-preview".into(),
        worktree_root: Some(path_to_git_arg(&temp.path().join("shared"))),
    };
    (temp, repo, req)
}

#[test]
fn preview_and_linked_checkout_supported() {
    let (_temp, repo, req) = fixture();
    let result = create(req.clone()).unwrap();
    assert_eq!(result.name, req.task_name);
    assert_eq!(result.branch, "wt/task-preview");
    let linked = create(GitWorktreeCreateRequest {
        project_path: result.path,
        task_name: "linked-child".into(),
        ..req
    })
    .unwrap();
    assert_eq!(linked.base_branch, "wt/task-preview");
    assert!(branch_exists(&repo, &linked.branch).unwrap());
}

#[test]
fn directory_branch_and_missing_registered_checkout_reallocate_without_deletion() {
    for kind in ["directory", "branch", "registration"] {
        let (_temp, repo, req) = fixture();
        let root = local_path_from_input(req.worktree_root.as_ref().unwrap());
        let target = root.join(&req.task_name);
        fs::create_dir_all(&root).unwrap();
        if kind == "directory" {
            fs::create_dir(&target).unwrap();
            fs::write(target.join("owner.txt"), "foreign").unwrap();
        } else if kind == "branch" {
            git(&repo, &["branch", "wt/task-preview"]);
        } else {
            git(
                &repo,
                &[
                    "worktree",
                    "add",
                    "-b",
                    "wt/task-preview",
                    &path_to_git_arg(&target),
                ],
            );
            fs::remove_dir_all(&target).unwrap();
            git(&repo, &["worktree", "lock", &path_to_git_arg(&target)]);
            // A registered missing checkout with no ref still reserves its path.
            git(&repo, &["update-ref", "-d", "refs/heads/wt/task-preview"]);
        }
        let result = create(req).unwrap();
        assert_ne!(result.name, "task-preview");
        if kind == "directory" {
            assert_eq!(
                fs::read_to_string(target.join("owner.txt")).unwrap(),
                "foreign"
            );
        } else if kind == "branch" {
            assert!(branch_exists(&repo, "wt/task-preview").unwrap());
        }
        if kind == "registration" {
            assert!(!branch_exists(&repo, "wt/task-preview").unwrap());
            assert!(worktree_path_registered(&repo, &target).unwrap());
        }
    }
}

#[test]
fn reverse_interleaving_external_creator_keeps_its_objects() {
    for foreign in ["branch", "path", "worktree"] {
        let (_temp, repo, req) = fixture();
        let mut calls = 0;
        let result = create_observed(
            req,
            |project, target, branch| {
                calls += 1;
                if calls == 1 {
                    match foreign {
                        "branch" => {
                            git(project, &["branch", branch]);
                        }
                        "path" => {
                            fs::create_dir(target).unwrap();
                            fs::write(target.join("owner.txt"), "external").unwrap();
                        }
                        _ => {
                            git(
                                project,
                                &["worktree", "add", "-b", branch, &path_to_git_arg(target)],
                            );
                        }
                    }
                }
                Ok(None)
            },
            replacement_name,
        )
        .unwrap();
        assert_eq!(calls, 2);
        assert_ne!(result.name, "task-preview");
        if foreign != "path" {
            assert!(branch_exists(&repo, "wt/task-preview").unwrap());
        }
        if foreign == "worktree" {
            let target = local_path_from_input(&result.path)
                .parent()
                .unwrap()
                .join("task-preview");
            assert!(worktree_path_registered(&repo, &target).unwrap());
        }
    }
}

#[test]
fn checkout_failure_preserves_final_tail_and_never_deletes_new_or_external_branch() {
    let (_temp, repo, req) = fixture();
    let mut calls = 0;
    let error = create_observed(
        req,
        |project, _, branch| {
            calls += 1;
            git(project, &["branch", branch]);
            Ok(Some(GitCommandOutput {
                success: false,
                stdout: "progress\r".repeat(100),
                stderr: "fatal: Permission denied during checkout".into(),
            }))
        },
        replacement_name,
    )
    .unwrap_err();
    assert_eq!(calls, 1);
    assert!(error.ends_with("fatal: Permission denied during checkout"));
    assert!(branch_exists(&repo, "wt/task-preview").unwrap());
}

#[test]
fn only_five_candidates_and_noncollision_failure_not_retried() {
    let (_temp, repo, req) = fixture();
    git(&repo, &["branch", "wt/task-preview"]);
    let mut replacements = 0;
    let error = create_observed(
        req,
        |_, _, _| panic!("occupied must not add"),
        |_| {
            replacements += 1;
            "task-preview".into()
        },
    )
    .unwrap_err();
    assert_eq!(replacements, 4);
    assert!(error.contains("candidates_exhausted"));
    assert!(!occupancy_failure(
        "fatal: could not create leading directories: Permission denied",
        &repo,
        "wt/task-preview"
    ));
}

#[test]
fn shared_root_across_repositories_and_sequential_same_candidate_safe() {
    let (temp, repo, req) = fixture();
    let first = create(req.clone()).unwrap();
    let second = create(req.clone()).unwrap();
    assert_ne!(first.name, second.name);
    let other = temp.path().join("other");
    fs::create_dir(&other).unwrap();
    git(&other, &["init", "--initial-branch", "main"]);
    git(&other, &["config", "user.name", "Tests"]);
    git(&other, &["config", "user.email", "test@example.com"]);
    git(&other, &["commit", "--allow-empty", "-m", "initial"]);
    let third = create(GitWorktreeCreateRequest {
        project_path: path_to_git_arg(&other),
        ..req
    })
    .unwrap();
    assert_ne!(third.path, first.path);
    assert!(worktree_path_registered(&repo, &local_path_from_input(&first.path)).unwrap());
}

#[test]
fn invalid_names_and_remote_paths_rejected() {
    let (_temp, _repo, req) = fixture();
    for task in ["中文", "../escape", "CON"] {
        assert!(create(GitWorktreeCreateRequest {
            task_name: task.into(),
            ..req.clone()
        })
        .is_err());
    }
    for project in [
        "\\\\wsl$\\Ubuntu\\repo",
        "\\\\server\\repo",
        "ssh://host/repo",
    ] {
        assert!(create(GitWorktreeCreateRequest {
            project_path: project.into(),
            ..req.clone()
        })
        .is_err());
    }
}

#[test]
fn concurrent_creators_allocate_distinct_checkouts() {
    let (_temp, repo, req) = fixture();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let req = req.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut first = true;
                create_observed(
                    req,
                    |_, _, _| {
                        if first {
                            first = false;
                            barrier.wait();
                        }
                        Ok(None)
                    },
                    replacement_name,
                )
            })
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|h| h.join().unwrap().unwrap())
        .collect();
    assert_ne!(results[0].name, results[1].name);
    for result in results {
        assert!(branch_exists(&repo, &result.branch).unwrap());
        assert!(worktree_path_registered(&repo, &local_path_from_input(&result.path)).unwrap());
    }
}

#[test]
fn root_io_error_and_spawn_failure_stop_without_candidate_retry() {
    let (temp, _repo, mut req) = fixture();
    let file = temp.path().join("not-directory");
    fs::write(&file, "keep").unwrap();
    req.worktree_root = Some(path_to_git_arg(&file));
    let error = create_observed(
        req.clone(),
        |_, _, _| panic!("root error before add"),
        |_| panic!("no retry"),
    )
    .unwrap_err();
    assert!(error.starts_with("create_worktree_root_failed"));
    req.worktree_root = Some(path_to_git_arg(&temp.path().join("valid")));
    let error = create_observed(
        req,
        |_, _, _| Err("spawn_failed: injected permission".into()),
        |_| panic!("no retry"),
    )
    .unwrap_err();
    assert_eq!(error, "spawn_failed: injected permission");
    assert_eq!(fs::read_to_string(file).unwrap(), "keep");
}

#[test]
fn namespace_descendant_reallocates_and_fixed_prefix_stops_without_deleting() {
    for packed in [false, true] {
        let (_temp, repo, req) = fixture();
        git(&repo, &["branch", "wt/task-preview/child"]);
        if packed {
            git(&repo, &["pack-refs", "--all"]);
        }
        let result = create(req).unwrap();
        assert_ne!(result.name, "task-preview");
        assert!(branch_exists(&repo, "wt/task-preview/child").unwrap());
    }
    let (_temp, repo, req) = fixture();
    git(&repo, &["branch", "wt"]);
    let error =
        create_observed(req, |_, _, _| panic!("no add"), |_| panic!("no retry")).unwrap_err();
    assert_eq!(error, "worktree_branch_namespace_blocked: refs/heads/wt");
    assert!(branch_exists(&repo, "wt").unwrap());
}

#[test]
fn raced_namespace_conflicts_are_candidate_bound() {
    let (_temp, repo, req) = fixture();
    let mut calls = 0;
    let result = create_observed(
        req,
        |project, _, branch| {
            calls += 1;
            if calls == 1 {
                git(project, &["branch", &format!("{branch}/child")]);
            }
            Ok(None)
        },
        replacement_name,
    )
    .unwrap();
    assert_eq!(calls, 2);
    assert_ne!(result.name, "task-preview");
    assert!(branch_exists(&repo, "wt/task-preview/child").unwrap());
}

#[test]
fn mixed_or_unrelated_occupancy_diagnostics_never_retry_permission_or_hook_failure() {
    for tail in [
        "fatal: Permission denied during checkout",
        "error: hook failed",
        "hook failed",
    ] {
        let (_temp, repo, req) = fixture();
        let mut calls = 0;
        let error = create_observed(
            req,
            |project, _, branch| {
                calls += 1;
                git(project, &["branch", branch]);
                Ok(Some(GitCommandOutput {
                    success: false,
                    stdout: String::new(),
                    stderr: format!(
                        "fatal: a branch named '{branch}' already exists
{tail}"
                    ),
                }))
            },
            |_| panic!("fatal is not a collision"),
        )
        .unwrap_err();
        assert_eq!(calls, 1);
        assert!(error.ends_with(tail));
        assert!(branch_exists(&repo, "wt/task-preview").unwrap());
    }
    let target = Path::new("candidate");
    assert!(!occupancy_failure(
        "fatal: a branch named 'wt/other' already exists",
        target,
        "wt/task-preview"
    ));
    assert!(!occupancy_failure(
        "fatal: 'other' already exists",
        target,
        "wt/task-preview"
    ));
}
