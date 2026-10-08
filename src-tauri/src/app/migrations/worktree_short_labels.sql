-- NULL is an insertion-only sentinel: the AFTER INSERT trigger initializes it
-- before the statement returns. Callers must SELECT the finalized row, not rely
-- on INSERT RETURNING (which observes SQLite's pre-AFTER-trigger row).
ALTER TABLE projects ADD COLUMN worktree_label_high_water INTEGER NOT NULL DEFAULT 0
    CONSTRAINT worktree_high_water_range CHECK (
        typeof(worktree_label_high_water) = 'integer'
        AND worktree_label_high_water BETWEEN 0 AND 2147483647
    );
ALTER TABLE worktrees ADD COLUMN short_label TEXT NOT NULL DEFAULT ''
    CONSTRAINT worktree_short_label_valid CHECK (
        typeof(short_label) = 'text' AND length(short_label) <= 12
        AND instr(short_label, char(0)) = 0
        AND short_label NOT GLOB ('*[' || char(1) || '-' || char(31)
            || char(127) || '-' || char(159) || char(1564)
            || char(8206) || char(8207) || char(8232) || '-' || char(8238)
            || char(8294) || '-' || char(8297) || ']*')
        AND NOT (substr(short_label, 1, 1) IN ('W', 'w')
            AND length(short_label) > 1
            AND substr(short_label, 2) NOT GLOB '*[^0-9]*')
    );
ALTER TABLE worktrees ADD COLUMN label_ordinal INTEGER DEFAULT NULL
    CONSTRAINT worktree_ordinal_range CHECK (label_ordinal IS NULL OR (
        typeof(label_ordinal) = 'integer' AND label_ordinal BETWEEN 1 AND 2147483647
    ));

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS ordinal
    FROM worktrees
)
UPDATE worktrees SET label_ordinal = (SELECT ordinal FROM ranked WHERE ranked.id = worktrees.id);
UPDATE projects SET worktree_label_high_water = COALESCE(
    (SELECT MAX(label_ordinal) FROM worktrees WHERE project_id = projects.id), 0
);
CREATE UNIQUE INDEX idx_worktrees_project_label_ordinal ON worktrees(project_id, label_ordinal);
CREATE UNIQUE INDEX idx_worktrees_project_short_label ON worktrees(project_id, short_label COLLATE NOCASE)
    WHERE short_label <> '';

CREATE TRIGGER worktree_high_water_monotonic BEFORE UPDATE OF worktree_label_high_water ON projects
WHEN NEW.worktree_label_high_water < OLD.worktree_label_high_water
BEGIN
    SELECT RAISE(ABORT, 'worktree_label_high_water_cannot_decrease');
END;
CREATE TRIGGER worktree_ordinal_immutable BEFORE UPDATE OF label_ordinal, project_id ON worktrees
WHEN NEW.project_id IS NOT OLD.project_id
    OR (OLD.label_ordinal IS NOT NULL AND NEW.label_ordinal IS NOT OLD.label_ordinal)
BEGIN
    SELECT RAISE(ABORT, 'worktree_label_ordinal_immutable');
END;
CREATE TRIGGER worktree_ordinal_insert_guard BEFORE INSERT ON worktrees
BEGIN
    -- Guard even when a connection has disabled foreign_keys.
    SELECT RAISE(ABORT, 'worktree_label_project_missing')
        WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id);
    SELECT RAISE(ABORT, 'worktree_label_ordinal_exhausted')
        WHERE NEW.label_ordinal IS NULL AND
            (SELECT worktree_label_high_water FROM projects WHERE id = NEW.project_id) >= 2147483647;
END;
CREATE TRIGGER worktree_ordinal_allocate AFTER INSERT ON worktrees
BEGIN
    UPDATE projects SET worktree_label_high_water = CASE
        WHEN NEW.label_ordinal IS NULL THEN worktree_label_high_water + 1
        ELSE MAX(worktree_label_high_water, NEW.label_ordinal) END
    WHERE id = NEW.project_id;
    UPDATE worktrees SET label_ordinal = (
        SELECT worktree_label_high_water FROM projects WHERE id = NEW.project_id
    ) WHERE rowid = NEW.rowid AND NEW.label_ordinal IS NULL;
END;
