//! Creation owns allocation, not deletion. A failed add cannot prove branch ownership.
use super::*;

const MAX_CANDIDATES: usize = 5;

fn replacement_name(requested: &str) -> String {
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    format!(
        "{}-{}",
        &requested[..requested.len().min(51)],
        &suffix[..12]
    )
}

fn occupied(project: &Path, target: &Path, branch: &str) -> Result<bool, String> {
    // git2 distinguishes an absent ref from permission / repository errors.
    let repo = open_main_repo(&path_to_git_arg(project))?;
    // A fixed prefix ref blocks every allocation; a candidate descendant only
    // blocks this candidate. Inspect refs, never remove the blocking objects.
    let reference = format!("refs/heads/{branch}");
    let refs = repo
        .references()
        .map_err(|error| format!("worktree_branch_check_failed: {error}"))?;
    let mut candidate_occupied = false;
    for entry in refs {
        let entry = entry.map_err(|error| format!("worktree_branch_check_failed: {error}"))?;
        let Some(name) = entry.name() else { continue };
        if name == "refs/heads/wt" {
            return Err("worktree_branch_namespace_blocked: refs/heads/wt".into());
        }
        if name == reference || name.starts_with(&format!("{reference}/")) {
            candidate_occupied = true;
        }
    }
    if candidate_occupied || worktree_root_metadata(target)?.is_some() {
        return Ok(true);
    }
    Ok(worktree_registration(project, target, branch)? != WorktreeRegistration::Missing)
}

// Only Git's explicit occupancy failures plus current occupancy permit retry.
// Checkout/permissions errors may leave our own branch behind; that is NOT a collision.
fn occupancy_failure(detail: &str, target: &Path, branch: &str) -> bool {
    let path = path_to_git_arg(target);
    // Git for Windows prints forward slashes even when its input uses backslashes.
    #[cfg(windows)]
    let path = path.replace(char::from(92), "/");
    let reference = format!("refs/heads/{branch}");
    let normalized = detail.replace('\r', "\n");
    #[cfg(windows)]
    let normalized = normalized.replace(char::from(92), "/");
    let mut diagnostics = 0;
    for line in normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let collision = line == format!("fatal: a branch named '{branch}' already exists")
            || line == format!("fatal: '{path}' already exists")
            || line == format!("fatal: cannot lock ref '{reference}': reference already exists")
            || line.starts_with(&format!(
                "fatal: '{path}' is a missing but already registered worktree"
            ))
            || (line.starts_with(&format!("fatal: '{branch}' is already checked out at '"))
                && line.ends_with('\''))
            || (line.starts_with(&format!(
                "fatal: cannot lock ref '{reference}': '{reference}/"
            )) && line.ends_with(&format!("' exists; cannot create '{reference}'")));
        if collision {
            diagnostics += 1;
        } else if !line.starts_with("Preparing worktree (") && !line.starts_with("Updating files:")
        {
            // Unknown output (including hook errors) or ANY non-occupancy fatal
            // makes the whole failed add ambiguous, even if a branch now exists.
            return false;
        }
    }
    diagnostics > 0
}

pub(super) fn create(req: GitWorktreeCreateRequest) -> Result<GitWorktreeCreateResult, String> {
    create_observed(req, |_, _, _| Ok(None), replacement_name)
}

// Fault/ordering seam: runs after the availability check, immediately before add.
fn create_observed<F, N>(
    req: GitWorktreeCreateRequest,
    mut before_add: F,
    mut next_name: N,
) -> Result<GitWorktreeCreateResult, String>
where
    F: FnMut(&Path, &Path, &str) -> Result<Option<GitCommandOutput>, String>,
    N: FnMut(&str) -> String,
{
    let requested = validate_task_name(&req.task_name)?;
    let repo = open_main_repo(&req.project_path)?;
    let base_branch = current_branch_name(&repo)?;
    let project = local_path_from_input(&req.project_path)
        .canonicalize()
        .map_err(|error| format!("canonicalize_project_path_failed: {error}"))?;
    match repo.find_reference("refs/heads/wt") {
        Ok(_) => return Err("worktree_branch_namespace_blocked: refs/heads/wt".into()),
        Err(error) if error.code() == git2::ErrorCode::NotFound => {}
        Err(error) => return Err(format!("worktree_branch_check_failed: {error}")),
    }
    let mut name = requested.clone();
    let mut last_collision = "worktree_name_occupied".to_string();
    for attempt in 0..MAX_CANDIDATES {
        if attempt > 0 {
            name = validate_task_name(&next_name(&requested))?;
        }
        let target =
            match resolve_worktree_target_path(&project, &name, req.worktree_root.as_deref()) {
                Ok(target) => target,
                Err(error) if error == "worktree_path_exists" => {
                    last_collision = error;
                    continue;
                }
                Err(error) => return Err(error),
            };
        let branch = format!("{WORKTREE_BRANCH_PREFIX}{name}");
        validate_worktree_branch(&branch)?;
        if occupied(&project, &target, &branch)? {
            continue;
        }
        let target_arg = path_to_git_arg(&target);
        let output = match before_add(&project, &target, &branch)? {
            Some(output) => output,
            None => run_git_raw(
                &project,
                ["worktree", "add", "-b", &branch, &target_arg, "HEAD"],
            )?,
        };
        if !output.success {
            let detail = output.combined();
            let error = format!("git_failed: {}", git_create_error_snippet(&detail));
            if occupancy_failure(&detail, &target, &branch) && occupied(&project, &target, &branch)?
            {
                last_collision = error;
                continue;
            }
            // Never delete a branch/directory on failure: nonexistence before add
            // is not ownership after another process can interleave.
            return Err(error);
        }
        seed_trellis_developer_identity(&project, &target);
        return Ok(GitWorktreeCreateResult {
            name,
            branch,
            path: target_arg,
            base_branch,
        });
    }
    Err(format!(
        "worktree_create_candidates_exhausted: {last_collision}"
    ))
}

#[cfg(test)]
#[path = "worktree_create_tests.rs"]
mod tests;
