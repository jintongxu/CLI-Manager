# Design

## Data model

- `worktrees.name`: stable ASCII slug for `<root>/<name>` and `wt/<name>`.
- `worktrees.display_name`: required user-facing Unicode name; migration backfills from `name`.
- `worktrees.description`: optional Unicode task description.

## Creation boundary

Desktop/Web inputs are validated as Unicode metadata. The frontend derives a sanitized, case-insensitively unique ASCII slug before invoking `git_worktree_create`; Rust continues enforcing the existing ASCII/Windows-reserved-name rules.

## Compatibility

- SQLite migration 42 is additive and preserves existing branch/path/name values.
- Web protocol fields are optional and consumers fall back to `name`/empty description.
- Web management accepts new `displayName`/`description` and legacy `taskName` payloads.
- Sync restore accepts both new and legacy Worktree column lists.

## UI

Creation dialogs collect task name and description. All identity surfaces use a shared `getWorktreeDisplayName` helper. Git Workspace metadata editing updates `display_name` and `description` only.
