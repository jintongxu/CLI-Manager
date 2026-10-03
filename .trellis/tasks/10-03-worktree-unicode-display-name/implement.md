# Implementation

1. Add migration 42 and Worktree record fields with legacy backfill.
2. Separate Unicode metadata validation from ASCII slug generation in `worktreeStore`.
3. Update desktop creation, editing, search, tree, terminal, task-dialog and provider/history displays.
4. Propagate optional metadata through Web bridge, protocol, server validation and Web UI.
5. Preserve metadata in sync backup/restore with legacy column whitelist compatibility.
6. Add Rust boundary coverage, update bilingual messages and required project documentation.
7. Verify TypeScript, Web build/typecheck, Rust checks/tests, architecture and diff integrity.
