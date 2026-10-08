# Worktree Isolation Contracts

> Executable contracts for Git worktree based parallel task isolation.

---

## Scenario: Git worktree parallel task isolation

### 1. Scope / Trigger

- Trigger: opening a project terminal for a CLI-configured project while another same-project terminal is already open can make two CLI/AI tasks modify the same checkout.
- This is a cross-layer contract because SQLite migrations, Tauri Git commands, Zustand stores, terminal tab metadata, project tree UI, and Git cleanup all participate in one lifecycle.
- The feature creates an isolated Git worktree, opens PTY sessions inside it, then guides commit → merge → cleanup.

### 2. Signatures

#### Database schema

```sql
ALTER TABLE projects ADD COLUMN worktree_strategy TEXT NOT NULL DEFAULT 'disabled';
ALTER TABLE projects ADD COLUMN worktree_root TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN worktree_deps_prompt_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS worktrees (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  branch                TEXT NOT NULL,
  path                  TEXT NOT NULL,
  base_branch           TEXT NOT NULL DEFAULT '',
  deps_prompt_dismissed INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
```

Allowed project strategies:

```ts
type WorktreeIsolationStrategy = "prompt" | "disabled" | "autoParallel" | "always";

interface Settings {
  projectWorktreeConfigEnabled: boolean; // defaults to true
}
```

#### Backend commands

```rust
#[tauri::command]
pub async fn git_worktree_validate(project_path: String) -> Result<bool, String>

#[tauri::command]
pub async fn git_worktree_create(
    req: GitWorktreeCreateRequest,
) -> Result<GitWorktreeCreateResult, String>

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateRequest {
    pub project_path: String,
    pub task_name: String,
    pub worktree_root: Option<String>,
}

#[tauri::command]
pub async fn git_worktree_check_deps(
    worktree_path: String,
) -> Result<GitWorktreeDepsCheckResult, String>

#[tauri::command]
pub async fn git_worktree_merge(
    project_path: String,
    worktree_branch: String,
    base_branch: String,
) -> Result<GitWorktreeMergeResult, String>

#[tauri::command]
pub async fn git_worktree_force_merge(
    project_path: String,
    worktree_branch: String,
    base_branch: String,
) -> Result<GitWorktreeMergeResult, String>

#[tauri::command]
pub async fn git_worktree_remove(
    project_path: String,
    worktree_path: String,
    branch: String,
    delete_branch: bool,
) -> Result<String, String>
```

Response payloads are camelCase for the WebView boundary:

```ts
interface GitWorktreeCreateResult {
  name: string;
  branch: string;      // must be wt/<name>
  path: string;
  baseBranch: string;
}

interface GitWorktreeDepsCheckResult {
  needsInstall: boolean;
  command: string | null;
  reason: string | null;
}

interface GitWorktreeMergeResult {
  merged: boolean;
  output: string;
  conflictFiles: string[];
  skipped: boolean;
  skipReason: string | null;
  stashCreated: boolean;
  stashRestored: boolean;
  stashReference: string | null;
  stashRestoreConflictFiles: string[];
}
```

#### Frontend records

```ts
interface WorktreeRecord {
  id: string;
  project_id: string;
  name: string;
  branch: string;
  path: string;
  base_branch: string;
  deps_prompt_dismissed: number;
  status: "active" | "missing" | "pending";
  created_at: string;
  updated_at: string;
}

interface TerminalSession {
  worktreeId?: string;
}

type TreeNode =
  | { type: "group"; group: Group; children: TreeNode[] }
  | { type: "project"; project: Project; worktrees?: WorktreeRecord[] }
  | { type: "worktree"; project: Project; worktree: WorktreeRecord };
```

### 3. Contracts

#### Isolation strategy

- `settingsStore.projectWorktreeConfigEnabled=false` is a global frontend gate. Project create/edit forms hide the Worktree configuration section, and normal/split project launches must return the equivalent of strategy `disabled` before Git validation, prompts, or automatic creation.
- The global gate does not erase project Worktree fields, delete existing Worktree records, hide existing Worktree tree entries, or disable explicit manual Worktree actions.

| Strategy | Required behavior |
|---|---|
| `prompt` | If the project has a configured CLI tool and at least one existing same-project terminal session, ask whether to open in an isolated worktree. Direct-open must preserve legacy behavior. |
| `disabled` | Default. Do nothing. Always open a normal project terminal; never prompt and never auto-create a worktree, regardless of CLI tool configuration or existing same-project sessions. |
| `autoParallel` | If the project has a configured CLI tool and at least one existing same-project terminal session, propose isolation and show the display/internal-name form before creating. The first session opens normally. |
| `always` | Every supported local Git project launch shows the display/internal-name form before creating a new worktree. Non-Git/WSL projects open normally. |

- `disabled` must short-circuit before Git validation and preserve pre-worktree behavior exactly.
- `prompt` / `autoParallel` must not depend on visible tab runtime state, `running` notifications, startup commands such as `npm run dev`, or shell process liveness.
- A project counts as CLI-configured when `projects.cli_tool` is non-empty and not a sentinel unconfigured value such as `none` / `未选择`.
- Existing same-project sessions should be open PTY terminal sessions for the same `projectId`; pseudo-tabs such as file editors or subagent transcript views must not trigger isolation.
- Non-Git projects and unsupported WSL/remote paths must not trigger prompts or automatic worktree creation.
- Split-terminal project launches must use the same isolation decision path as normal launches.

#### Worktree creation

- The frontend generates an ASCII internal candidate with a random suffix once per creation dialog open (or automatic action). The preview is immutable within that action; display name initializes to the preview but can be edited independently, including Chinese or duplicate labels. Legacy string/Web `taskName` display inputs do not determine internal identity.
- Rust is the authority for validation, path construction and bounded allocation: try at most five candidates total, reallocating only for actual directory, local ref (including `wt/<candidate>/child` descendants), or registered checkout occupancy. Missing directories with retained registration remain occupied. Never reuse or delete occupied objects. An exact local `wt` ref blocks all candidates and returns `worktree_branch_namespace_blocked` without blind retries.
- Successful creation returns the authoritative final `name`, `branch`, `path` and `baseBranch`; the Store persists these, preserving the independent display name. Normally final name equals preview; rare occupancy/creation races may reallocate, as explained in both languages. SQL save failure reports the created name/path and does not roll back Git objects.
- Task names must be non-empty, 1..64 chars, only ASCII letters/digits/`-`/`_`, not start with `-`, and not be Windows reserved device names (`CON`, `NUL`, `COM1`, `LPT1`, etc.).
- Branch names must be `wt/<taskName>` and pass Git-safe validation.
- Default path is under a sibling worktree root (`<project-parent>/<project-name>-worktrees/<taskName>`). A custom root may only be used as a root; the task name is still appended by Rust.
- Git commands must be executed with argument arrays (`Command::new("git").args([...])`), never through shell string concatenation.
- Windows extended-length path prefixes (`\\?\` / `//?/`) must be stripped before passing paths to `git worktree add/remove`; Git CLI receives normal local paths only.
- WSL / UNC / remote paths remain unsupported and must be rejected before appending the task name or executing Git.
- A failed `git worktree add -b wt/<task>` does not prove ownership of any remaining branch/directory, even if it was absent before add. Unknown failed-add ownership prohibits deletion: preserve residual and concurrent objects and report the error.
- Retry failed add only for explicit diagnostics bound to this candidate path/branch plus confirmed current occupancy. Mixed or unknown diagnostics (including permission, checkout or hook failures) terminate conservatively; branch existence alone is not collision evidence.
- While a Worktree create request for the same project path, worktree root, and task name is in flight, the frontend must not invoke `git_worktree_create` again. Duplicate triggers must fail locally with `worktree_create_in_progress` and release the guard on both success and failure.
- All supported normal/split launches that would create a new Worktree, including `autoParallel` and `always`, show the name form first; creation happens only after user confirmation. Existing Worktree terminal creation and ordinary non-isolated terminals do not show this form. UI entrypoints use synchronous per-action guards during asynchronous validation/prompt initialization, released in `finally`; retain the Store candidate guard for confirmed creation.
- A failed `git_worktree_create` response must preserve the final Git error tail. Checkout progress prefixes may be normalized or truncated only after the terminal `fatal`/`error` text remains available to the frontend.

#### Dependency prompt

- Dependency install detection is advisory only. It must not block opening the actual task terminal.
- Automatic dependency install detection is gated by the project-level `worktree_deps_prompt_enabled` flag, which defaults to off for new and existing projects.
- Manual "Install dependencies" actions may still run dependency detection regardless of the automatic prompt flag.
- If dependency install is accepted, create a separate install tab in the worktree path. Do not write the install command into the original task tab.
- Dismissing/skipping the dependency prompt sets `deps_prompt_dismissed` for that worktree, so the same worktree does not repeatedly prompt.
- Once the expected dependency directory exists (`node_modules`, etc.), the detection condition self-heals and should not prompt.

#### Explicit force-delete recovery

- The Sidebar Worktree context menu offers a separate danger action directly below Discard Worktree, opening a standalone force-delete flow for unknown nonempty residuals or dirty/unmerged checkout discard. The finish dialog does not offer a force-delete button. Explicit confirmation authorizes complete removal of the target directory, registration, matching local `wt/*` branch and SQL/sidebar record; it does not relax automatic finish cleanup or assert merge success. Uncommitted/untracked data is deleted and unmerged commits may lose their branch reference. Never remove remote refs or roll back base-branch merges.
- `git_worktree_force_delete_inspect({req})` returns an ephemeral authorization: `token`, `confirmedPath` (exact original record path spelling), `deleteBranch=true`, `branchOid` (string or explicit null absence), `pathMissing`. The UI must show full project/target paths, branch to delete, irreversible directory-data and unmerged-commit risk and current associated sessions, and require exact typed target-path confirmation.
- `git_worktree_force_delete_validate({req,token,confirmedPath})` rechecks the original authorization without consuming or replacing it. Call this before closing sessions under the frontend Worktree lock. New sessions invalidate the user confirmation. `git_worktree_force_delete({req,token,confirmedPath})` independently rechecks and consumes authorization, returning `done=true, branchDeleted=true` only after filesystem, registration and matching local branch absence have been verified. SQL finalization follows this result, never a partial branch-deletion failure.
- Tokens are bounded, expire after ten minutes, and bind original request, native root/project/common-directory identity the registration snapshot and the inspected branch OID or explicit absence. Reject changed/absent-to-present refs and any physical-main/other-worktree use; validate again immediately before expected-OID `update-ref --no-deref -d`. Branch-use checking is not cross-process atomic, and same-OID delete/recreate cannot be distinguished solely by the OID. Failed validation/execution requires fresh inspection and explicit confirmation, never silently replacing a token after a directory change.
- Force rejects project and physical-main roots, ancestors/admin paths, other or contained Worktrees, branch/path mismatch, traversal and unsafe root/ancestor links. Internal symlink/junction traversal must unlink only the link itself, not its outside target. Reuse root-absence verification and bounded remove retries; reject prune if unrelated registration removal is possible or cannot be proved excluded.
- Force deletes only the explicitly confirmed matching local `wt/*` branch and never stages, commits, merges, deletes remote branches, acknowledges a finish receipt or automatically closes sessions. Missing path/branch permits explicitly authorized SQL finalization without claiming a merge. SQL failure retains the record for a fresh confirmed retry; SQL success removes local state before best-effort refresh.
- Focused regression commands: Rust library filter `commands::git_worktree::finish::force_delete`; `node scripts/worktreeForceDelete.test.mjs` (includes imported finish recovery tests). Use temporary repositories only, covering exact confirmation, opaque-original-token preflight, replacement/mismatch/protected paths, internal links preserving external targets, unrelated prune candidates, dirty/unmerged complete deletion, changed/recreated refs, branch-in-use/main/base protection, branch-deletion failure and missing-path fresh-confirmation retry, session arrival and SQL/refresh ordering.

#### Read-only status view

- Sidebar Worktree context menu exposes View Worktree status before Finish, including active/missing/pending records. The standalone dialog directly invokes `git_worktree_finish_inspect`, not Store.inspectFinish which persists record status.
- It distinguishes stored path/branch/base/status metadata from checkout/merge/cleanup evidence, includes blockers and stash references, and offers refresh/close only. Do not infer branch existence from `sourceOid`, merge success from unknown state, or filesystem/registration fields the inspect response does not supply.
- Inspect viewing must not write SQL, issue force authorization, close sessions, stage/commit/merge/prune or delete. Stable identity/open request generations prevent late results overwriting a new target or reopening; translation/object refresh must not restart inspection. Focused actual-mock verification: `node --test scripts/worktreeStatus.test.mjs`.

#### Merge-resolution commit authority

- `git_commit` must record HEAD as first parent and all real MERGE_HEAD commits, deduplicated in order. A resolved index tree equal to HEAD is still a valid merge commit; `nothing_staged` applies only to ordinary empty commits.
- Reject unresolved index entries and malformed/unresolvable merge parents without clearing merge evidence. Only a successfully created merge commit may call `cleanup_state`; creation/identity failures retain HEAD/index/MERGE_HEAD. A cleanup failure must expose `commit_created:<OID>` and `do_not_retry_commit`, not claim the commit never happened.
- Linked worktrees read their own Git administration state, not the physical-main MERGE_HEAD. Paths-only commit retains native `git commit --only` behavior. Focused authority tests: Rust library filter `commands::git::commit::tests`.
- Resolving file contents alone does not finish integration: verify base is an ancestor of the resulting commit and MERGE_HEAD is gone before retrying Finish. Do not repeatedly merge already resolved content using a single-parent commit API.

#### Finish task lifecycle

The recoverable finish path is separate from explicitly confirmed destructive discard:

```ts
interface FinishRequest {
  worktreeId: string;
  projectPath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
}
// git_worktree_finish_inspect({ req }): read-only authority check
// git_worktree_finish_merge({ req, force }): journaled merge, including stash blockers
// git_worktree_finish_cleanup_plan({ req, deleteBranch }): read-only exact expiring scope
// git_worktree_finish_cleanup_validate({ req, deleteBranch, token }): SAME token, daemon fence BEFORE closure
// git_worktree_finish_cleanup_confirmed({ req, deleteBranch, token }): revalidate, no live associated sessions
// git_worktree_finish_cleanup_release({ req, token }): release on cancel/failure; never replace scope
// legacy git_worktree_finish_cleanup requires confirmation for new preparation
// git_worktree_finish_ack({ req }): acknowledgement only after SQL record deletion
```

- Rust stores versioned finish receipts beneath the repository common Git administration directory, outside the target checkout and its removable worktree registration. Receipt identity binds the worktree ID, repository, normalized path, branch/base and source OID. Critical intent must be durably published before destructive operations.
- Response fields are camelCase: `checkoutValid`, `merged`, `outcome` (`null | "merged" | "no_diff"`), `sourceOid`, `cleanupReady`, `cleanupPending`, `blocker`, `unknown`, `done`, `stashReference`, and optional-result `mergeResult`; compatible additions `phase?: string` and `cleanupPlanRequired?: boolean`. `done` means Git/filesystem completion, not SQL completion. `no_diff` does not assert ancestry.
- `inspect` does not delete, merge, close sessions or create a cleanup receipt. Checkout validity requires matching path/branch registration, a usable `.git` file and matching repository/root; directory existence alone is insufficient. Missing branch with no trusted receipt is unknown, not completed.
- Merge/stash-restoration blockers are durable. Ancestry must not clear a pending force-restore blocker or reapply a stash automatically. Captured source/base evidence must still match before cleanup; dirty or newly advanced checkouts must not be silently discarded.
- Before unregistering, capture root identity and bounded file-content ownership evidence. A retry may delete only the same root and an unchanged residual subset; replaced roots, new/modified content, new Git metadata, path/branch mismatch, protected repository paths and links/junctions fail conservatively. Historical ancestry may prove a branch merged but cannot prove ownership of an unregistered nonempty directory.
- Merge never requires deletion snapshots or manifests. Cleanup plans bind request/source/base/native roots/registration/Git scope/rule version/exact candidates/deleteBranch. Plans display full paths, type/evidence, estimates (including unknown), preserved paths/reasons, session IDs, and irreversible whole-root/whole-authorized-directory risk, including hand-placed cache contents. Unknown content outside trusted cache roots is preserved and blocks root deletion; tracked cache-shaped files are not artifacts.
- Classify only verified checkout-local Node/workspace dependencies and Cargo default target, with manifest/installation or build metadata, ignored scope and no tracked descendants. Complex unsupported workspace declarations, shared/custom/outside output, root/ancestor links and nested repositories stop conservatively. No reliable application-temp provenance is currently available: report the missing record, never infer ownership from `.tmp`, age, name, size or ignore state.
- Finish ordinary snapshots retain conservative bounds and do not traverse links/junctions; metadata plus actual reads must not double-count bytes. Authorized artifacts use bounded streaming SHA-256 manifests in common Git storage: 32GiB content, 500000 entries, 128MiB manifest, ten-minute preparation. Intent/complete ownership must be durable before deletion; artifact-first removal precedes ordinary checkout removal. Changed root/content, corrupt/missing manifest and new Git metadata stop, including reverse partial recovery. Internal recorded links are only unlinked, never followed.
- Version-1 receipts remain conservative: a valid registered pre-cleanup checkout may obtain new explicitly confirmed ownership; old cleanup intent/unregistered unknown residual cannot acquire broader trust. Unsupported/new receipt evidence is not deletion authority for older code.
- Only root `NotFound` proves absence. Permission/I/O errors and inner-entry `NotFound` must not be treated as completed root deletion; verify root absence after deletion. Reuse existing bounded remove retries and prune helpers.
- Branch deletion is conditional on the recorded OID and explicit choice. An already-deleted branch is idempotent only with trusted finish progress. Preserve the receipt through SQL finalization; acknowledgement retains an idempotent completion tombstone.
- Frontend `pending` is a recovery/display status, never a runnable checkout. Invalid and pending records remain accessible through finish inspection. Dialog initialization uses stable identity/open-cycle generations, clears old changes, and ignores late requests; translation/object refresh must not rewind completion progress. Inspect before checkout reads or staging.
- Cleanup sequence is exact plan → explicit whole-root confirmation → validate SAME token/acquire daemon fence BEFORE any session closure → reject changed session set → await backend close/release → confirmed cleanup revalidates no live associated daemon sessions. Cancel/closure failure releases admission, never silently replaces the token; confirmed success consumes it and releases itself. Central frontend launch reservations span first await through session publication; daemon `worktree_admission_v1` gates all transport Create and in-flight creation, including other windows and child paths, not unrelated projects. Existing Create fields are unchanged. Unsupported old daemon fails closed with restart guidance, never kills/upgrades an active daemon. SQL-only done recovery does not issue a cleanup plan or repeat merge. SQL failure preserves finalization-only progress. SQL success immediately removes local records/tree nodes; ack or refresh failure must not re-run Git cleanup.
- Operation locks and frontend admission serialize within the application process; daemon admission covers associated local PTY launches across transports/windows. Neither is a cross-process filesystem lock against arbitrary external writers. Do not claim protection against arbitrary concurrent external mutation between validation and deletion.

- MVP finish flow commits all worktree changes, merges the worktree branch back into the base branch, then removes the worktree and optionally deletes the branch.
- Before merge, the main project checkout must be clean. Dirty main checkout returns a stable error and performs no Git mutation.
- The explicit force-merge command is the only path allowed to handle a dirty main checkout. After branch and content validation, it saves staged, unstaged, and untracked changes with `git stash push --include-untracked`, records the newly created stash OID, merges, and applies that exact OID with `--index`; it never drops the stash.
- Force merge must serialize with ordinary merge in the process. A stash-save, checkout, merge, abort, or restore failure must stop cleanup and return a stable `force_merge_*` error with the retained stash OID when available.
- A successful merge is cleanup-safe only when no stash was created or `stashRestored=true`. A stash-restore conflict returns `stashRestoreConflictFiles` (which may be empty when Git only reports raw output), retains the stash and Worktree, and does not roll back the already completed merge.
- The merge command receives both `branch` and `baseBranch`; if the checkout is clean but not on the base branch, it may checkout the base branch before merging.
- If the worktree branch and base branch have no content diff, the merge command must return `skipped=true` / `skipReason="no_diff"` and avoid checkout/merge mutation. The frontend should present this as "merge not needed" and still allow cleanup.
- Merge conflicts must be detected, conflict files returned, and `merge --abort` executed immediately. Do not leave the main checkout in a half-merged state.
- Stable backend error codes such as `dirty_main_worktree` are for the frontend contract, not end-user copy. The finish-task dialog must map dirty-main and merge-conflict states to readable guidance that says what happened, whether Git mutated the main checkout, and what the user should do next.
- Cleanup may delete a non-empty directory only when `git worktree list --porcelain` still records the same path and branch. If Git records the path/branch but `git worktree remove --force` reports a stale checkout such as `is not a working tree` or missing `.git`, the backend may remove that registered path, run `git worktree prune`, and then delete the `wt/` branch.
- Branch deletion is allowed only for `wt/` branches and only after explicit UI confirmation or successful finish flow.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `project_path` missing or not a Git repo | Return `path_not_found` / `open_repo_failed`; frontend opens normally only when validation says false. |
| WSL UNC path or unsupported remote path | Return `unsupported_wsl`; no prompt/auto isolation. |
| `projectWorktreeConfigEnabled=false` | Open the project directly; do not validate Git, prompt, or auto-create a Worktree. Preserve stored project Worktree fields. |
| Invalid task name | Return `invalid_task_name`; no directory or branch is created. |
| Candidate branch exists or has descendant refs | Rust reallocates within the five-candidate bound; preserve blocking refs. |
| Exact local `wt` prefix ref exists | Return `worktree_branch_namespace_blocked`; no blind retry or deletion. |
| Same project/root/task creation already in flight | Return `worktree_create_in_progress` locally; do not issue another Git command or show an unhandled Promise rejection. |
| Worktree path exists or remains registered while missing | Rust reallocates within the five-candidate bound; never reuse/delete the reserved path. |
| Five candidates occupied | Return `worktree_create_candidates_exhausted`; preserve all objects. |
| Failed add has mixed/unrelated occupancy and fatal permission/hook diagnostics | Stop, preserve final Git error tail and residual objects; do not retry based on branch existence. |
| Main checkout dirty before merge | Return `dirty_main_worktree`; no checkout/merge happens. |
| Force merge stash cannot be created or verified | Return `force_merge_stash_failed` / `force_merge_stash_reference_failed` / `force_merge_stash_incomplete`; do not checkout, merge, or cleanup; retain any created stash. |
| Force merge checkout/merge/abort fails | Attempt to restore the exact retained stash when safe; return the corresponding `force_merge_checkout_failed`, `force_merge_failed`, `force_merge_abort_failed`, or `force_merge_restore_failed`; keep the Worktree. |
| Force merge stash apply conflicts after merge | Return `merged=true`, `stashRestored=false`, and `stashRestoreConflictFiles` when available; keep the retained stash and Worktree, and block cleanup. |
| Worktree branch has no content diff from base branch | Return skipped `no_diff`; no checkout/merge happens; cleanup remains available. |
| Merge branch missing | Return `branch_not_found`; no cleanup happens automatically. |
| Merge conflict | Return conflict error with `conflictFiles`, run `merge --abort`, keep worktree record. |
| Frontend receives `dirty_main_worktree` | Show human-readable text: main worktree has uncommitted changes, no merge ran, the Worktree commit is still safe, and the user should clean/commit/stash the main checkout before retrying. |
| Frontend receives merge conflict result | Show human-readable text: merge was aborted automatically, main checkout returned to pre-merge state, and list `conflictFiles` when present. |
| Remove path not listed in `git worktree list --porcelain` and path is non-empty | Return `worktree_not_registered`; do not delete filesystem path. |
| Remove path not listed in `git worktree list --porcelain` and path is empty | Remove the empty stale directory and delete the requested `wt/` branch only when requested. |
| Remove path listed with matching branch but Git reports missing `.git` / `is not a working tree` | Treat as registered stale worktree: remove the registered directory, run `worktree prune`, and delete the requested `wt/` branch only when requested. |
| `worktree remove --force` exits 0 but leaves a directory (e.g. dangling pnpm workspace junction after its tracked target was deleted first) | After a successful remove, if the path still exists and is no longer registered, delete the residual directory via filesystem, run `worktree prune`, and report `removed_residual_worktree_dir`; if the path is still registered, return `worktree_remove_incomplete` and do not delete. |
| Remove path branch mismatch | Return `worktree_branch_mismatch`; do not delete worktree or branch. |
| Delete branch requested for non-`wt/` branch | Return `invalid_branch`; do not delete branch. |

### 5. Good/Base/Bad Cases

- Good: Project A has `cli_tool=codex` and one existing open Project A terminal. Opening another Project A terminal under `prompt` shows a worktree prompt; choosing isolate creates `wt/task-*`, opens the new PTY in that path, and displays a tab badge.
- Good: A fast double-click or simultaneous auto/manual trigger for the same task produces one Git create request; the duplicate is ignored while the first request completes.
- Base: Project A has `worktree_strategy=disabled`. Opening a terminal uses the original project path and existing startup command behavior, even when a CLI tool and same-project terminal already exist.
- Base: global Worktree configuration is disabled while Project A stores `worktree_strategy=prompt` or `always`. Normal and split launches open directly, the project form hides Worktree controls, and the stored strategy remains unchanged.
- Base: Project A has `cli_tool=codex` but no existing same-project terminals. Under `autoParallel`, opening a terminal uses the original project path and existing startup command behavior.
- Base: Project A has no configured CLI tool. Ordinary shell/startup-command terminals never trigger `prompt` or `autoParallel` just because a prior tab exists or a command is running.
- Base: Project A has `worktree_deps_prompt_enabled=0`. Creating/opening a worktree skips automatic dependency detection and never shows the dependency prompt.
- Base: Dependency prompt is dismissed. The worktree opens normally and the same worktree does not prompt again.
- Bad: Writing `npm install` into the original task terminal. This can corrupt the user’s CLI session and is forbidden.
- Bad: Calling `git merge` while the main checkout has uncommitted changes. This mixes unrelated work and must be blocked.
- Bad: Rendering `dirty_main_worktree` or `merge_conflict` raw in the dialog. The codes are correct transport values but not actionable user guidance.
- Bad: Deleting a path passed from the frontend without confirming it is a registered Git worktree. This is a high-risk filesystem deletion and is forbidden.
- Bad: Returning only the first 300 characters of Git output when checkout progress occupies that prefix; the actual fatal cause becomes invisible and cannot be diagnosed.

### 6. Tests Required

- Focused creation checks: `node --test scripts/worktreeCreation.test.mjs`, `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::git_worktree::create::tests`, and `npx tsc --noEmit`. Node harness loads actual Store/UI/controller source; cover stable preview/display independence, candidate guard, concurrent same automatic entry vs independent normal/split actions, and guard release on failures. Rust uses temporary repositories for descendant/packed refs, prefix blockers, external creation races, bounded allocation and misleading mixed fatal diagnostics. Failed-add tests must verify blocking refs are preserved.

- Focused finish regression tests use temporary repositories and injected cleanup/journal failures: successful completion, unregister followed by deletion failure/restart/retry, deleted branch with/without trusted receipt, changed source/base/checkout/residual/root, unknown residual refusal, protected paths/links, durable force-restore blockers, root inspection errors and internal `NotFound`.
- `node --test scripts/worktreeFinishRecovery.test.mjs scripts/worktreeArtifactCleanup.test.mjs` covers actual mocked dialog/store callbacks: reopen and late-response isolation, object/language refresh, invalid staging guards, cleanup retry without merge, SQL/refresh failure ordering, shared operation guards and explicit session confirmation/newcomer rejection.
- No regression test may clean real user worktree directories, branches or database rows.

- Rust unit tests:
  - task-name validation accepts safe names and rejects empty, whitespace/control, path separators, leading `-`, and Windows reserved device names.
  - default worktree path calculation keeps the task name under the computed root.
  - dependency detection returns the expected command for npm/pnpm/yarn fixtures and no prompt when dependency directories exist.
  - stale worktree directory cleanup retries transient Windows file-lock errors such as `os error 32`.
  - remove/merge helpers reject non-`wt/` branches and branch/path mismatches where feasible.
  - force merge preserves staged, unstaged, and untracked main-worktree changes, keeps an existing stash intact, switches from a non-base branch safely, aborts merge conflicts, and reports stash-restore conflicts without cleanup.
  - create error formatting keeps a final `fatal`/`error` line after long checkout progress.
- Frontend static checks:
  - `npx tsc --noEmit` must pass after adding `WorktreeRecord`, `TreeNode` union changes, and `TerminalSession.worktreeId`.
  - new project defaults keep `worktree_strategy="disabled"` and `worktree_deps_prompt_enabled=0`.
  - global Worktree configuration disabled gates both normal project opening and split-project opening before `shouldIsolateNewSession` can trigger prompt/auto behavior.
- Rust checks:
  - `cargo check --manifest-path src-tauri/Cargo.toml`.
  - `cargo test --manifest-path src-tauri/Cargo.toml`.
- Manual desktop checks:
  - prompt / disabled / autoParallel / always strategy behavior.
  - split-project launch uses the same isolation decision.
  - automatic dependency detection runs only when the project-level dependency prompt flag is enabled.
  - manual dependency install opens a new tab and original startup command still runs in the task tab regardless of the automatic prompt flag.
  - finish flow succeeds for clean merge and removes worktree/branch.
  - dirty main checkout blocks merge.
  - force merge requires explicit confirmation, restores the main worktree changes, retains the stash, and blocks cleanup when restoration conflicts.
  - conflict merge aborts and leaves main checkout clean.

### 7. Wrong vs Correct

#### Wrong

```ts
// Couples worktree isolation to visible runtime state or startup commands.
const busy = isTabVisiblyRunning(session.id) || project.startup_cmd.includes("npm run dev");
```

#### Correct

```ts
// prompt / autoParallel depend on CLI configuration plus an existing same-project PTY session.
const hasCliTool = project.cli_tool.trim() !== "" && project.cli_tool.trim().toLowerCase() !== "none";
const hasSameProjectTerminal = sessions.some((session) => session.projectId === project.id && (session.kind ?? "pty") === "pty");
```

#### Wrong

```rust
// Shell string interpolation allows argument injection.
Command::new("sh").arg("-c").arg(format!("git worktree remove {}", worktree_path));
```

#### Correct

```rust
// Arguments are passed directly, not parsed by a shell.
Command::new("git")
    .current_dir(project_path)
    .args(["worktree", "remove", worktree_path])
    .output()?;
```

#### Wrong

```ts
// Pollutes the user's original AI/CLI session.
await invoke("pty_write", { sessionId: originalTaskSessionId, data: "npm install\r" });
```

#### Correct

```ts
// Create a separate install terminal in the same worktree path.
await createSession(project.id, worktree.path, `Install deps: ${worktree.name}`, installCommand, envVars, shell);
```
