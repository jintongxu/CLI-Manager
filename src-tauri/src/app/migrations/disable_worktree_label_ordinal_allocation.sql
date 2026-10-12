DROP TRIGGER IF EXISTS worktree_ordinal_allocate;
DROP TRIGGER IF EXISTS worktree_ordinal_insert_guard;

CREATE TRIGGER worktree_ordinal_insert_guard BEFORE INSERT ON worktrees
BEGIN
    -- Keep referential validation, but do not reject empty labels based on the
    -- legacy ordinal high-water mark now that ordinals are never allocated.
    SELECT RAISE(ABORT, 'worktree_label_project_missing')
        WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id);
END;
