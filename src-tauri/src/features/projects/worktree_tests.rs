use super::{
    check_dependency_need, classify_worktree_registration, cleanup_empty_worktree_parent,
    cleanup_residual_worktree_dir_after_remove, cleanup_stale_unregistered_worktree,
    default_worktree_root, git_create_error_snippet, is_retryable_worktree_remove_error,
    is_stale_worktree_remove_error, merge_worktree_internal, parse_worktree_list_entries,
    path_to_git_arg, remove_registered_stale_worktree_dir, remove_worktree_path_with_retry,
    resolve_worktree_target_path, seed_trellis_developer_identity,
    validate_plain_branch_name,
    validate_task_name, validate_worktree_branch, WorktreeRegistration,
    FORCE_MERGE_STASH_MESSAGE_PREFIX,
};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

fn run_test_git<I, S>(cwd: &Path, args: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn commit_test_change(repo: &Path, message: &str) {
    run_test_git(repo, ["add", "--all"]);
    run_test_git(repo, ["commit", "--message", message]);
}

fn create_test_worktree() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    run_test_git(&repo, ["init", "--initial-branch", "main"]);
    run_test_git(&repo, ["config", "user.email", "test@example.com"]);
    run_test_git(&repo, ["config", "user.name", "CLI Manager Tests"]);
    run_test_git(&repo, ["config", "core.autocrlf", "false"]);
    fs::write(repo.join("base.txt"), "base\n").unwrap();
    commit_test_change(&repo, "base");

    let worktree = temp.path().join("worktree");
    let worktree_arg = worktree.to_string_lossy().to_string();
    run_test_git(
        &repo,
        vec![
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            "wt/task".to_string(),
            worktree_arg,
            "main".to_string(),
        ],
    );
    fs::write(worktree.join("task.txt"), "task\n").unwrap();
    commit_test_change(&worktree, "task");
    (temp, repo, worktree)
}

#[test]
// 验证任务名的空值、长度、字符和 Windows 保留名称限制。
fn validates_task_names() {
    assert_eq!(
        validate_task_name("task-0705_1200").unwrap(),
        "task-0705_1200"
    );
    assert_eq!(validate_task_name("").unwrap_err(), "task_name_empty");
    assert_eq!(validate_task_name("-bad").unwrap_err(), "task_name_invalid");
    assert_eq!(
        validate_task_name("修复登录流程").unwrap_err(),
        "task_name_invalid"
    );
    assert_eq!(
        validate_task_name("bad/name").unwrap_err(),
        "task_name_invalid"
    );
    assert_eq!(
        validate_task_name("bad name").unwrap_err(),
        "task_name_invalid"
    );
    assert_eq!(validate_task_name("con").unwrap_err(), "task_name_reserved");
    assert_eq!(
        validate_task_name(&"a".repeat(65)).unwrap_err(),
        "task_name_too_long"
    );
}

#[test]
// 验证工作树分支必须具有 wt/ 前缀和合法任务后缀。
fn validates_worktree_branch_prefix() {
    assert!(validate_worktree_branch("wt/task-1").is_ok());
    assert_eq!(
        validate_worktree_branch("feature/task-1").unwrap_err(),
        "branch_not_worktree"
    );
    assert_eq!(
        validate_worktree_branch("wt/bad/name").unwrap_err(),
        "task_name_invalid"
    );
}

#[test]
// 验证大量检出进度不会挤掉末尾的 Git 致命错误。
fn keeps_final_git_error_after_checkout_progress() {
    let output = format!(
        "Preparing worktree\r{}fatal: unable to checkout files",
        "Checking out files: 30%\r".repeat(30)
    );
    let snippet = git_create_error_snippet(&output);
    assert!(snippet.contains("fatal: unable to checkout files"));
}

#[test]
// 验证常见权限与文件占用错误可重试，而无关错误不可重试。
fn detects_retryable_worktree_remove_errors() {
    assert!(is_retryable_worktree_remove_error(
        "git_failed: error: failed to delete 'task-1': Permission denied"
    ));
    assert!(is_retryable_worktree_remove_error(
        "fatal: unable to unlink old-file: Device or resource busy"
    ));
    assert!(is_retryable_worktree_remove_error(
        "The process cannot access the file because it is being used by another process"
    ));
    assert!(is_retryable_worktree_remove_error(
        "remove_stale_worktree_dir_failed: 另一个程序正在使用此文件，进程无法访问。 (os error 32)"
    ));
    // 中文 Windows 的 os error 5 显示为“拒绝访问。”，英文环境显示 Access is denied。
    assert!(is_retryable_worktree_remove_error(
        "remove_stale_worktree_dir_failed: 拒绝访问。 (os error 5)"
    ));
    assert!(is_retryable_worktree_remove_error(
        "remove_stale_worktree_dir_failed: Access is denied. (os error 5)"
    ));
    assert!(!is_retryable_worktree_remove_error(
        "git_failed: branch not found"
    ));
}

#[test]
// 验证失效工作树登记错误与普通权限错误的区别。
fn detects_stale_worktree_remove_errors() {
    assert!(is_stale_worktree_remove_error(
        "git_failed: fatal: 'F:\\repo\\worktrees\\task-1' is not a working tree"
    ));
    assert!(is_stale_worktree_remove_error(
            "git_failed: fatal: validation failed, cannot remove working tree: 'C:/repo/wt/.git' does not exist"
        ));
    assert!(is_stale_worktree_remove_error(
        "prunable gitdir file points to non-existent location"
    ));
    assert!(!is_stale_worktree_remove_error(
        "git_failed: error: failed to delete 'task-1': Permission denied"
    ));
}

#[test]
// 验证默认工作树根目录位于项目同级并带固定后缀。
fn computes_default_worktree_root_next_to_project() {
    let project_path = Path::new("/repo/demo-app");
    let root = default_worktree_root(project_path).unwrap();
    assert_eq!(root, PathBuf::from("/repo/demo-app-worktrees"));
}

#[test]
// 验证自定义工作树根目录被创建且目标位于规范化根目录下。
fn resolves_target_path_under_custom_root() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let root = temp.path().join("custom-root");
    fs::create_dir_all(&project).unwrap();
    let target =
        resolve_worktree_target_path(&project, "task-1", Some(root.to_str().unwrap())).unwrap();
    assert_eq!(target, root.canonicalize().unwrap().join("task-1"));
}

#[test]
// 验证 Git 路径参数移除两种 Windows 扩展路径前缀。
fn git_path_args_do_not_keep_windows_extended_prefix() {
    assert_eq!(
        path_to_git_arg(Path::new("\\\\?\\D:\\repo\\worktrees\\task-1")),
        "D:\\repo\\worktrees\\task-1"
    );
    assert_eq!(
        path_to_git_arg(Path::new("//?/D:/repo/worktrees/task-1")),
        "D:/repo/worktrees/task-1"
    );
}

#[test]
// 验证基础分支名允许普通层级名称并拒绝危险片段。
fn validates_base_branch_names() {
    assert!(validate_plain_branch_name("main").is_ok());
    assert!(validate_plain_branch_name("release/1.0").is_ok());
    assert_eq!(
        validate_plain_branch_name("-bad").unwrap_err(),
        "base_branch_invalid"
    );
    assert_eq!(
        validate_plain_branch_name("bad branch").unwrap_err(),
        "base_branch_invalid"
    );
    assert_eq!(
        validate_plain_branch_name("bad..branch").unwrap_err(),
        "base_branch_invalid"
    );
}

#[test]
// 验证 porcelain 工作树列表解析路径和分支。
fn parses_porcelain_worktree_entries() {
    let output = "worktree C:/repo/main\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo/wt/task\nHEAD def\nbranch refs/heads/wt/task\n";
    let entries = parse_worktree_list_entries(output);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].path, PathBuf::from("C:/repo/wt/task"));
    assert_eq!(entries[1].branch.as_deref(), Some("wt/task"));
}

#[test]
// 验证路径与分支联合匹配、单项错配及双项缺失的分类。
fn classifies_worktree_registration() {
    let entries = parse_worktree_list_entries(
            "worktree C:/repo/main\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo/wt/task\nHEAD def\nbranch refs/heads/wt/task\n",
        );
    assert_eq!(
        classify_worktree_registration(&entries, Path::new("C:/repo/wt/task"), "wt/task"),
        WorktreeRegistration::Matched
    );
    assert_eq!(
        classify_worktree_registration(&entries, Path::new("C:/repo/wt/task"), "wt/other"),
        WorktreeRegistration::Mismatched
    );
    assert_eq!(
        classify_worktree_registration(&entries, Path::new("C:/repo/wt/other"), "wt/task"),
        WorktreeRegistration::Mismatched
    );
    assert_eq!(
        classify_worktree_registration(&entries, Path::new("C:/repo/wt/missing"), "wt/missing"),
        WorktreeRegistration::Missing
    );
}

#[test]
// 验证工作树父目录清理只删除空目录并保留兄弟工作树。
fn cleanup_empty_worktree_parent_removes_only_empty_root() {
    let temp = tempfile::tempdir().unwrap();

    // 空根目录：删掉最后一个 worktree 后，根目录应被清理
    let root = temp.path().join("proj-worktrees");
    let wt = root.join("task-1");
    fs::create_dir_all(&wt).unwrap();
    fs::remove_dir(&wt).unwrap(); // 模拟 git 已移除该 worktree 目录
    cleanup_empty_worktree_parent(&wt);
    assert!(!root.exists());

    // 非空根目录（还有其它 worktree）：保持不动
    let root2 = temp.path().join("proj2-worktrees");
    let wt_a = root2.join("task-a");
    let wt_b = root2.join("task-b");
    fs::create_dir_all(&wt_a).unwrap();
    fs::create_dir_all(&wt_b).unwrap();
    fs::remove_dir(&wt_a).unwrap();
    cleanup_empty_worktree_parent(&wt_a);
    assert!(root2.exists());
    assert!(wt_b.exists());
}

#[test]
// 验证主仓库的 Trellis 身份被复制到已有工作树配置目录。
fn seeds_trellis_developer_identity_into_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let main_repo = temp.path().join("main");
    let worktree = temp.path().join("wt");

    // 主仓库有 .trellis/.developer，worktree 也已存在 .trellis 目录
    fs::create_dir_all(main_repo.join(".trellis")).unwrap();
    fs::write(main_repo.join(".trellis").join(".developer"), "name=hxx").unwrap();
    fs::create_dir_all(worktree.join(".trellis")).unwrap();

    seed_trellis_developer_identity(&main_repo, &worktree);

    let dest = worktree.join(".trellis").join(".developer");
    assert!(dest.is_file());
    assert_eq!(fs::read_to_string(&dest).unwrap(), "name=hxx");
}

#[test]
// 验证主仓库缺少 Trellis 身份时不创建目标身份文件。
fn seed_trellis_developer_identity_is_noop_when_source_missing() {
    let temp = tempfile::tempdir().unwrap();
    let main_repo = temp.path().join("main");
    let worktree = temp.path().join("wt");
    fs::create_dir_all(main_repo.join(".trellis")).unwrap();
    fs::create_dir_all(worktree.join(".trellis")).unwrap();

    // 主仓库自己都没初始化身份：不应创建目标文件
    seed_trellis_developer_identity(&main_repo, &worktree);
    assert!(!worktree.join(".trellis").join(".developer").exists());
}

#[test]
// 验证同步 Trellis 身份不会覆盖工作树已有身份。
fn seed_trellis_developer_identity_does_not_overwrite_existing() {
    let temp = tempfile::tempdir().unwrap();
    let main_repo = temp.path().join("main");
    let worktree = temp.path().join("wt");
    fs::create_dir_all(main_repo.join(".trellis")).unwrap();
    fs::write(main_repo.join(".trellis").join(".developer"), "name=main").unwrap();
    fs::create_dir_all(worktree.join(".trellis")).unwrap();
    fs::write(
        worktree.join(".trellis").join(".developer"),
        "name=existing",
    )
    .unwrap();

    // worktree 已有身份：保持不动
    seed_trellis_developer_identity(&main_repo, &worktree);
    assert_eq!(
        fs::read_to_string(worktree.join(".trellis").join(".developer")).unwrap(),
        "name=existing"
    );
}

#[test]
// 验证未登记工作树只能清理空目录并保留非空目录。
fn cleanup_stale_unregistered_worktree_removes_empty_dir_only() {
    let temp = tempfile::tempdir().unwrap();
    let empty = temp.path().join("empty");
    fs::create_dir(&empty).unwrap();
    let output =
        cleanup_stale_unregistered_worktree(temp.path(), &empty, "wt/task", false).unwrap();
    assert_eq!(output, "removed_stale_empty_worktree_dir");
    assert!(!empty.exists());

    let non_empty = temp.path().join("non-empty");
    fs::create_dir(&non_empty).unwrap();
    fs::write(non_empty.join("keep.txt"), "data").unwrap();
    assert_eq!(
        cleanup_stale_unregistered_worktree(temp.path(), &non_empty, "wt/task", false).unwrap_err(),
        "worktree_not_registered"
    );
    assert!(non_empty.exists());
}

#[test]
// 验证已登记失效工作树的清理函数可以删除非空临时目录。
fn registered_stale_worktree_cleanup_can_remove_non_empty_dir() {
    let temp = tempfile::tempdir().unwrap();
    let stale = temp.path().join("stale");
    fs::create_dir(&stale).unwrap();
    fs::write(stale.join("leftover.txt"), "data").unwrap();

    let output = remove_registered_stale_worktree_dir(&stale).unwrap();
    assert_eq!(output, "removed_stale_registered_worktree_dir");
    assert!(!stale.exists());
}

#[test]
// 验证 remove 成功但 Git 登记注销后残留目录时，兜底清理删除残留并返回标记。
fn residual_cleanup_removes_unregistered_leftover_dir() {
    let (_temp, repo, worktree) = create_test_worktree();
    fs::create_dir_all(worktree.join("node_modules")).unwrap();
    fs::write(worktree.join("node_modules").join("leftover.txt"), "data").unwrap();
    // 模拟悬空 junction 下 git remove exit 0 但静默残留：删掉 worktree 管理目录
    // 使登记注销，而目录仍存在。
    let admin = repo.join(".git").join("worktrees");
    for entry in fs::read_dir(&admin).unwrap() {
        let entry = entry.unwrap();
        fs::remove_dir_all(entry.path()).unwrap();
    }
    run_test_git(&repo, ["worktree", "prune"]);
    let output = cleanup_residual_worktree_dir_after_remove(&repo, &worktree).unwrap();
    assert!(output.contains("removed_residual_worktree_dir"));
    assert!(fs::symlink_metadata(&worktree).is_err());
}

#[test]
// 验证残留目录仍在 Git 登记中时不做文件删除，直接报错避免误删。
fn residual_cleanup_refuses_registered_path() {
    let (_temp, repo, worktree) = create_test_worktree();
    let error = cleanup_residual_worktree_dir_after_remove(&repo, &worktree).unwrap_err();
    assert_eq!(error, "worktree_remove_incomplete");
    assert!(worktree.exists());
}

#[test]
// 验证目录删除遇到模拟文件锁时重试，并在第三次成功。
fn stale_worktree_path_remove_retries_windows_file_lock_errors() {
    let temp = tempfile::tempdir().unwrap();
    let stale = temp.path().join("stale");
    fs::create_dir(&stale).unwrap();
    fs::write(stale.join("leftover.txt"), "data").unwrap();

    let mut attempts = 0;
    remove_worktree_path_with_retry(&stale, |path| {
        attempts += 1;
        if attempts < 3 {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "os error 32",
            ))
        } else {
            fs::remove_dir_all(path)
        }
    })
    .unwrap();

    assert_eq!(attempts, 3);
    assert!(!stale.exists());
}

#[test]
// 验证缺少 Node 与 Rust 依赖目录时返回对应安装建议。
fn detects_dependency_install_matrix() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join("package.json"), "{}").unwrap();
    let npm = check_dependency_need(temp.path());
    assert!(npm.needs_install);
    assert_eq!(npm.command.as_deref(), Some("npm install"));

    fs::create_dir(temp.path().join("node_modules")).unwrap();
    let none = check_dependency_need(temp.path());
    assert!(!none.needs_install);

    let cargo_dir = tempfile::tempdir().unwrap();
    fs::write(cargo_dir.path().join("Cargo.toml"), "[package]\nname='x'\n").unwrap();
    let cargo = check_dependency_need(cargo_dir.path());
    assert!(cargo.needs_install);
    assert_eq!(cargo.command.as_deref(), Some("cargo fetch"));
}

#[test]
// 验证普通合并在主工作区有改动时不创建 stash 也不改变分支。
fn normal_merge_keeps_dirty_main_worktree_blocked() {
    let (_temp, repo, _worktree) = create_test_worktree();
    fs::write(repo.join("main-only.txt"), "keep\n").unwrap();
    let error =
        merge_worktree_internal(repo.to_str().unwrap(), "wt/task", "main", false).unwrap_err();

    assert_eq!(error, "dirty_main_worktree");
    assert!(run_test_git(&repo, ["status", "--porcelain"]).contains("?? main-only.txt"));
    assert!(run_test_git(&repo, ["stash", "list"]).is_empty());
    assert_eq!(run_test_git(&repo, ["branch", "--show-current"]), "main");
}

#[test]
// 验证无内容差异时强制合并也不创建 stash 或修改主工作区。
fn force_merge_skips_no_diff_without_stashing() {
    let (_temp, repo, worktree) = create_test_worktree();
    run_test_git(&worktree, ["reset", "--hard", "main"]);
    fs::write(repo.join("main-only.txt"), "keep\n").unwrap();

    let result = merge_worktree_internal(repo.to_str().unwrap(), "wt/task", "main", true).unwrap();

    assert!(result.skipped);
    assert_eq!(result.skip_reason.as_deref(), Some("no_diff"));
    assert!(!result.stash_created);
    assert!(run_test_git(&repo, ["status", "--porcelain"]).contains("?? main-only.txt"));
    assert!(run_test_git(&repo, ["stash", "list"]).is_empty());
}

#[test]
// 验证强制合并保存并恢复 staged、unstaged、untracked 改动且保留本次 stash。
fn force_merge_restores_all_main_changes_and_keeps_existing_stash() {
    let (_temp, repo, _worktree) = create_test_worktree();
    fs::write(repo.join("prior-untracked.txt"), "prior\n").unwrap();
    run_test_git(
        &repo,
        [
            "stash",
            "push",
            "--include-untracked",
            "--message",
            "prior stash",
        ],
    );
    let prior_reference = run_test_git(&repo, ["rev-parse", "--verify", "refs/stash"]);

    fs::write(repo.join("staged.txt"), "staged\n").unwrap();
    run_test_git(&repo, ["add", "staged.txt"]);
    fs::write(repo.join("unstaged.txt"), "unstaged\n").unwrap();
    fs::write(repo.join("untracked.txt"), "untracked\n").unwrap();

    let result = merge_worktree_internal(repo.to_str().unwrap(), "wt/task", "main", true).unwrap();

    assert!(result.merged);
    assert!(result.stash_created);
    assert!(result.stash_restored);
    let stash_reference = result.stash_reference.as_deref().unwrap();
    assert_ne!(stash_reference, prior_reference);
    assert!(repo.join("task.txt").exists());
    assert!(repo.join("staged.txt").exists());
    assert!(repo.join("unstaged.txt").exists());
    assert!(repo.join("untracked.txt").exists());
    let status = run_test_git(&repo, ["status", "--porcelain"]);
    assert!(status.lines().any(|line| line.starts_with("A  staged.txt")));
    assert!(status.lines().any(|line| line == "?? unstaged.txt"));
    assert!(status.lines().any(|line| line == "?? untracked.txt"));
    let stash_list = run_test_git(&repo, ["stash", "list"]);
    assert!(stash_list.contains("prior stash"));
    assert!(stash_list.contains(FORCE_MERGE_STASH_MESSAGE_PREFIX));
}

#[test]
// 验证主工作区当前不在基础分支时仍先切换、合并并恢复改动。
fn force_merge_switches_to_base_branch_before_merging() {
    let (_temp, repo, _worktree) = create_test_worktree();
    run_test_git(&repo, ["checkout", "-b", "side"]);
    fs::write(repo.join("side-only.txt"), "side change\n").unwrap();

    let result = merge_worktree_internal(repo.to_str().unwrap(), "wt/task", "main", true).unwrap();

    assert!(result.merged);
    assert!(result.stash_restored);
    assert_eq!(run_test_git(&repo, ["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read_to_string(repo.join("side-only.txt")).unwrap(),
        "side change\n"
    );
}

#[test]
// 验证 merge 冲突会 abort，并在主分支恢复原有改动而保留工作树。
fn force_merge_aborts_conflict_and_restores_main_changes() {
    let (_temp, repo, worktree) = create_test_worktree();
    fs::write(worktree.join("base.txt"), "worktree version\n").unwrap();
    commit_test_change(&worktree, "conflicting worktree change");
    fs::write(repo.join("base.txt"), "main version\n").unwrap();
    commit_test_change(&repo, "conflicting main change");
    fs::write(repo.join("keep.txt"), "keep after abort\n").unwrap();

    let result = merge_worktree_internal(repo.to_str().unwrap(), "wt/task", "main", true).unwrap();

    assert!(!result.merged);
    assert!(result.conflict_files.iter().any(|file| file == "base.txt"));
    assert!(result.stash_created);
    assert!(result.stash_restored);
    assert_eq!(run_test_git(&repo, ["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read_to_string(repo.join("base.txt")).unwrap(),
        "main version\n"
    );
    assert_eq!(
        fs::read_to_string(repo.join("keep.txt")).unwrap(),
        "keep after abort\n"
    );
    assert!(run_test_git(&repo, ["status", "--porcelain"]).contains("?? keep.txt"));
}

#[test]
// 验证 merge 成功但 stash 恢复冲突时不清理工作树并返回冲突文件和 stash 身份。
fn force_merge_reports_stash_restore_conflict_without_cleanup() {
    let (_temp, repo, worktree) = create_test_worktree();
    fs::write(worktree.join("base.txt"), "worktree version\n").unwrap();
    commit_test_change(&worktree, "restore conflict worktree change");
    fs::write(repo.join("base.txt"), "main local version\n").unwrap();

    let result = merge_worktree_internal(repo.to_str().unwrap(), "wt/task", "main", true).unwrap();

    assert!(result.merged);
    assert!(result.stash_created);
    assert!(!result.stash_restored);
    assert!(result
        .stash_restore_conflict_files
        .iter()
        .any(|file| file == "base.txt"));
    assert!(result.stash_reference.is_some());
    assert!(run_test_git(&repo, ["stash", "list"]).contains(FORCE_MERGE_STASH_MESSAGE_PREFIX));
    assert!(run_test_git(&repo, ["status", "--porcelain"]).contains("base.txt"));
    assert!(run_test_git(&repo, ["branch", "--show-current"]) == "main");
}
