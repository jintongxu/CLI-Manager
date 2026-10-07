use super::{commit_staged, commit_staged_with_cleanup};
use git2::{IndexEntry, Oid, Repository, RepositoryState, Signature};
use std::{fs, path::Path};
use tempfile::TempDir;

// 全部副作用限定在临时仓库，本地身份覆盖全局配置以保证测试可重复。
fn fixture() -> (TempDir, Repository) {
    let dir = tempfile::tempdir().unwrap();
    let repo = Repository::init(dir.path()).unwrap();
    {
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Commit tests").unwrap();
        config
            .set_str("user.email", "commit-tests@example.invalid")
            .unwrap();
    }
    (dir, repo)
}

// 暂存指定内容但不提交，便于断言失败时索引完全保留。
fn stage(repo: &Repository, text: &str) {
    fs::write(repo.workdir().unwrap().join("file.txt"), text).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("file.txt")).unwrap();
    index.write().unwrap();
}

// 创建独立的真实 commit 对象，可选更新 HEAD，不依赖系统 Git/全局身份。
fn object_commit(repo: &Repository, message: &str, update_head: bool, parents: &[Oid]) -> Oid {
    let mut index = repo.index().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let sig = Signature::now("Fixture", "fixture@example.invalid").unwrap();
    let commits: Vec<_> = parents
        .iter()
        .map(|oid| repo.find_commit(*oid).unwrap())
        .collect();
    let refs: Vec<_> = commits.iter().collect();
    repo.commit(
        update_head.then_some("HEAD"),
        &sig,
        &sig,
        message,
        &tree,
        &refs,
    )
    .unwrap()
}

// 用每仓库 gitdir 写入合并证据，同时适用于 linked worktree 的独立状态目录。
fn merge_state(repo: &Repository, parents: &[Oid]) {
    let heads: String = parents.iter().map(|oid| format!("{oid}\n")).collect();
    fs::write(repo.path().join("MERGE_HEAD"), heads).unwrap();
    fs::write(repo.path().join("MERGE_MSG"), "fixture merge\n").unwrap();
    fs::write(repo.path().join("MERGE_MODE"), "no-ff").unwrap();
}

fn head(repo: &Repository) -> Oid {
    repo.head().unwrap().peel_to_commit().unwrap().id()
}

fn parent_ids(repo: &Repository) -> Vec<Oid> {
    repo.find_commit(head(repo)).unwrap().parent_ids().collect()
}

// 失败必须保留 HEAD、磁盘索引和所有合并证据，不能伪装成已完成合并。
fn preserved(repo: &Repository, before: Oid, index: &[u8], heads: &[u8]) {
    assert_eq!(head(repo), before);
    assert_eq!(fs::read(repo.path().join("index")).unwrap(), index);
    assert_eq!(fs::read(repo.path().join("MERGE_HEAD")).unwrap(), heads);
    assert_eq!(
        fs::read_to_string(repo.path().join("MERGE_MSG")).unwrap(),
        "fixture merge\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("MERGE_MODE")).unwrap(),
        "no-ff"
    );
    assert_eq!(repo.state(), RepositoryState::Merge);
}

#[test]
fn unborn_and_normal_commits_keep_short_id_and_parent_contract() {
    let (_dir, mut repo) = fixture();
    assert_eq!(
        commit_staged(&mut repo, "empty").unwrap_err(),
        "nothing_staged"
    );
    stage(&repo, "base");
    let short = commit_staged(&mut repo, "initial").unwrap();
    assert_eq!(short, head(&repo).to_string()[..7]);
    assert!(parent_ids(&repo).is_empty());
    let base = head(&repo);
    assert_eq!(
        commit_staged(&mut repo, "empty").unwrap_err(),
        "nothing_staged"
    );
    stage(&repo, "next");
    commit_staged(&mut repo, "normal").unwrap();
    assert_eq!(parent_ids(&repo), vec![base]);
    assert_eq!(repo.state(), RepositoryState::Clean);
}

// 内容变化和相同树都必须记录第二父，成功后删除合并状态文件。
#[test]
fn merge_different_and_same_tree_keep_both_parents_and_cleanup() {
    for changed in [false, true] {
        let (_dir, mut repo) = fixture();
        stage(&repo, "base");
        let base = object_commit(&repo, "base", true, &[]);
        let other = object_commit(&repo, "other", false, &[base]);
        merge_state(&repo, &[other]);
        if changed {
            stage(&repo, "merged content");
        }
        commit_staged(&mut repo, "merge").unwrap();
        assert_eq!(parent_ids(&repo), vec![base, other]);
        assert_eq!(repo.graph_descendant_of(head(&repo), other).unwrap(), true);
        assert_eq!(repo.state(), RepositoryState::Clean);
        for name in ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE"] {
            assert!(!repo.path().join(name).exists());
        }
    }
}

#[test]
fn multiple_merge_heads_deduplicate_in_order_including_head() {
    let (_dir, mut repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let one = object_commit(&repo, "one", false, &[base]);
    let two = object_commit(&repo, "two", false, &[base]);
    merge_state(&repo, &[one, base, one, two, two]);
    commit_staged(&mut repo, "octopus").unwrap();
    assert_eq!(parent_ids(&repo), vec![base, one, two]);
}

#[test]
fn unresolved_index_keeps_head_index_and_merge_evidence() {
    let (_dir, mut repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let other = object_commit(&repo, "other", false, &[base]);
    merge_state(&repo, &[other]);
    let mut index = repo.index().unwrap();
    let entry = index.get_path(Path::new("file.txt"), 0).unwrap();
    index.remove_path(Path::new("file.txt")).unwrap();
    // libgit2 IndexEntry flags 的高位 stage=1/2/3，构造真实未解决索引。
    for stage in 1..=3 {
        let conflict = IndexEntry {
            ctime: entry.ctime,
            mtime: entry.mtime,
            dev: entry.dev,
            ino: entry.ino,
            mode: entry.mode,
            uid: entry.uid,
            gid: entry.gid,
            file_size: entry.file_size,
            id: entry.id,
            flags: (entry.flags & 0x0fff) | (stage << 12),
            flags_extended: entry.flags_extended,
            path: entry.path.clone(),
        };
        index.add(&conflict).unwrap();
    }
    index.write().unwrap();
    assert!(repo.index().unwrap().has_conflicts());
    let bytes = fs::read(repo.path().join("index")).unwrap();
    let heads = fs::read(repo.path().join("MERGE_HEAD")).unwrap();
    assert!(commit_staged(&mut repo, "merge")
        .unwrap_err()
        .starts_with("write_tree_failed:"));
    preserved(&repo, base, &bytes, &heads);
}

#[test]
fn missing_identity_keeps_merge_state_and_legacy_error() {
    let (_dir, mut repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let other = object_commit(&repo, "other", false, &[base]);
    merge_state(&repo, &[other]);
    // 空本地值阻断全局身份回退，无需修改进程环境或真实用户配置。
    repo.config().unwrap().set_str("user.name", "").unwrap();
    repo.config().unwrap().set_str("user.email", "").unwrap();
    let bytes = fs::read(repo.path().join("index")).unwrap();
    let heads = fs::read(repo.path().join("MERGE_HEAD")).unwrap();
    assert_eq!(
        commit_staged(&mut repo, "merge").unwrap_err(),
        "no_git_identity"
    );
    preserved(&repo, base, &bytes, &heads);
}

#[test]
fn commit_creation_failure_keeps_merge_state() {
    let (_dir, mut repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let other = object_commit(&repo, "other", false, &[base]);
    merge_state(&repo, &[other]);
    let bytes = fs::read(repo.path().join("index")).unwrap();
    let heads = fs::read(repo.path().join("MERGE_HEAD")).unwrap();
    // 锁住真实 HEAD 更新目标，确保进入 libgit2 commit 后失败，而非模拟创建结果。
    let reference = repo.head().unwrap().name().unwrap().to_string();
    let lock_path = repo.path().join(format!("{reference}.lock"));
    fs::write(&lock_path, "locked by test").unwrap();
    let error =
        commit_staged_with_cleanup(&mut repo, "merge", |_| panic!("must not cleanup")).unwrap_err();
    assert!(error.starts_with("commit_failed:"), "{error}");
    preserved(&repo, base, &bytes, &heads);
}

#[test]
fn cleanup_failure_reports_created_commit_and_no_blind_retry() {
    let (_dir, mut repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let other = object_commit(&repo, "other", false, &[base]);
    merge_state(&repo, &[other]);
    let error = commit_staged_with_cleanup(&mut repo, "merge", |_| {
        Err(git2::Error::from_str("injected cleanup failure"))
    })
    .unwrap_err();
    assert_ne!(head(&repo), base);
    assert_eq!(parent_ids(&repo), vec![base, other]);
    assert!(
        error.contains(&format!("commit_created: {}", head(&repo))),
        "{error}"
    );
    assert!(
        error.contains("state_error: injected cleanup failure"),
        "{error}"
    );
    assert!(error.contains("do_not_retry_commit"));
    assert!(repo.path().join("MERGE_HEAD").exists());
}

// 非 commit 的 MERGE_HEAD 不得静默省略，避免生成假成功单父提交。
#[test]
fn invalid_merge_parent_keeps_merge_evidence() {
    let (_dir, mut repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let blob = repo.blob(b"not a commit").unwrap();
    merge_state(&repo, &[blob]);
    let bytes = fs::read(repo.path().join("index")).unwrap();
    let heads = fs::read(repo.path().join("MERGE_HEAD")).unwrap();
    assert!(commit_staged(&mut repo, "merge")
        .unwrap_err()
        .starts_with("merge_parent_failed:"));
    preserved(&repo, base, &bytes, &heads);
}

// IPC 边界保留信息 trim、空信息/路径错误和七位成功值，不改注册或参数。
#[tokio::test]
async fn command_boundary_preserves_validation_and_success() {
    let (dir, repo) = fixture();
    let path = dir.path().to_string_lossy().to_string();
    assert_eq!(
        super::super::git_commit(path.clone(), "  ".into())
            .await
            .unwrap_err(),
        "empty_message"
    );
    let missing = dir.path().join("missing").to_string_lossy().to_string();
    assert_eq!(
        super::super::git_commit(missing, "message".into())
            .await
            .unwrap_err(),
        "path_not_found"
    );
    stage(&repo, "base");
    let short = super::super::git_commit(path, "  trimmed  ".into())
        .await
        .unwrap();
    assert_eq!(short, head(&repo).to_string()[..7]);
    assert_eq!(
        repo.find_commit(head(&repo)).unwrap().message(),
        Some("trimmed")
    );
}

// linked worktree 的 .git 是文件，MERGE_HEAD 必须取独立 gitdir 而非主仓库目录。
#[test]
fn linked_worktree_keeps_parents_and_cleans_only_its_state() {
    let (dir, repo) = fixture();
    stage(&repo, "base");
    let base = object_commit(&repo, "base", true, &[]);
    let other = object_commit(&repo, "other", false, &[base]);
    let path = dir.path().join("linked");
    let worktree = repo.worktree("linked", &path, None).unwrap();
    let mut linked = Repository::open_from_worktree(&worktree).unwrap();
    assert!(path.join(".git").is_file());
    merge_state(&linked, &[other]);
    commit_staged(&mut linked, "merge").unwrap();
    assert_eq!(parent_ids(&linked), vec![base, other]);
    assert_eq!(linked.state(), RepositoryState::Clean);
    assert!(!linked.path().join("MERGE_HEAD").exists());
    assert_eq!(head(&repo), base);
}
