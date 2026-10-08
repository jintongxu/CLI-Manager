# Scenario matrix

| Authority | Lifecycle / safety | Verification |
|---|---|---|
| Valid same-base no receipt clean/tracked/untracked | active; dirty review allowed, cleanup blocked | Rust + mapping + startup |
| New tip not in base dirty / historical merged dirty / prepared dirty | active, preserve blockers | Rust + mapping |
| merged/no_diff/merge_intent/stash_pending/cleanup_intent/done | pending; active-only consumers unchanged | mapping + existing receipt recovery tests (frontend); backend production untouched |
| Changed source/base/residual/root / restore blocked | pending and cleanup refused | frontend gate matrix; existing Rust evidence not rerun |
| Missing path/registration/branch no receipt | missing/unknown or historical recovery, never blindly active | new Rust + frontend matrix |
| SQL stale pending, successful valid inspect | two stores + real tree + SQL active | actual mocked Store startup |
| inspect corrupt/identity/path errors pending | preserve pending, no SQL write | actual mocked Store startup |
| repeated startup/backup reload | no redundant SQL or merge/cleanup/session close | actual mocked Store startup |
| root/worktree, hidden/mixed split, daemon/snapshot, ask/auto | identity/cwd retained; true pending remains missing-worktree | focused models + lifecycle; App wiring static review |

Window focus/tray/sidebar modes/hooks/local shell/WSL presentation do not enter finishStatus; unchanged. Native app restart and real user checkout validation not performed; temporary-repository and mocked-boundary evidence only.
