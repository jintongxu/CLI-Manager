use git2::{Commit, ErrorCode, Oid, Repository};
use std::collections::HashSet;

// 只处理索引整库提交；成功后才清理合并状态，不改变路径限定提交的 CLI 语义。
pub(super) fn commit_staged(repo: &mut Repository, message: &str) -> Result<String, String> {
    commit_staged_with_cleanup(repo, message, |repo| repo.cleanup_state())
}

// 清理边界可注入以验证「提交已创建但清理失败」，生产路径始终使用 libgit2。
fn commit_staged_with_cleanup(
    repo: &mut Repository,
    message: &str,
    cleanup: impl FnOnce(&Repository) -> Result<(), git2::Error>,
) -> Result<String, String> {
    let mut index = repo.index().map_err(|e| format!("index_failed: {e}"))?;
    if index.has_conflicts() {
        return Err("write_tree_failed: unresolved_index_conflicts".to_string());
    }
    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("write_tree_failed: {e}"))?;

    let mut merge_oids = Vec::new();
    // 没有 MERGE_HEAD 是普通提交；其它读取/格式错误必须中止，不能降级丢父关系。
    match repo.mergehead_foreach(|oid| {
        merge_oids.push(*oid);
        true
    }) {
        Ok(()) => {}
        Err(e) if e.code() == ErrorCode::NotFound => {}
        Err(e) => return Err(format!("merge_heads_failed: {e}")),
    }
    let head_commit = match repo.head() {
        Ok(head) => Some(
            head.peel_to_commit()
                .map_err(|e| format!("head_commit_failed: {e}"))?,
        ),
        Err(e) if matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => None,
        Err(e) => return Err(format!("head_commit_failed: {e}")),
    };
    let merging = !merge_oids.is_empty();
    let parents = resolve_parents(repo, head_commit, &merge_oids)?;

    // 合并允许树不变：内容已整合仍必须记录父关系；普通/未出生分支保留空提交错误。
    if !merging {
        match parents.first() {
            Some(head) => {
                if head
                    .tree()
                    .map_err(|e| format!("head_tree_failed: {e}"))?
                    .id()
                    == tree_oid
                {
                    return Err("nothing_staged".to_string());
                }
            }
            None if index.is_empty() => return Err("nothing_staged".to_string()),
            None => {}
        }
    }

    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("find_tree_failed: {e}"))?;
    let sig = repo
        .signature()
        .map_err(|_| "no_git_identity".to_string())?;
    let parent_refs: Vec<&Commit<'_>> = parents.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
        .map_err(|e| format!("commit_failed: {e}"))?;

    // 提交失败绝不清理；清理失败带完整已创建 OID，明确禁止当作未提交盲目重试。
    if merging {
        cleanup(repo)
            .map_err(|e| format!("commit_created: {oid}; state_error: {e}; do_not_retry_commit"))?;
    }
    Ok(oid.to_string().chars().take(7).collect())
}

// HEAD 固定为第一父；全部 MERGE_HEAD 必须解析为真实 commit，按原顺序去重。
fn resolve_parents<'repo>(
    repo: &'repo Repository,
    head: Option<Commit<'repo>>,
    merge_oids: &[Oid],
) -> Result<Vec<Commit<'repo>>, String> {
    let mut seen = HashSet::new();
    let mut parents = Vec::new();
    if let Some(head) = head {
        seen.insert(head.id());
        parents.push(head);
    }
    for oid in merge_oids {
        if seen.insert(*oid) {
            parents.push(
                repo.find_commit(*oid)
                    .map_err(|e| format!("merge_parent_failed: {e}"))?,
            );
        }
    }
    Ok(parents)
}

#[cfg(test)]
#[path = "commit_tests.rs"]
mod tests;
