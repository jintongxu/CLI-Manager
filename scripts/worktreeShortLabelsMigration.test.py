"""Real SQLite contract tests; stdlib only, never opens an application database.
Run: python scripts/worktreeShortLabelsMigration.test.py
"""
import concurrent.futures
import contextlib
import pathlib
import re
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'src-tauri/src/app/migrations.rs').read_text(encoding='utf-8')
SQL = (ROOT / 'src-tauri/src/app/migrations/worktree_short_labels.sql').read_text(encoding='utf-8')


@contextlib.contextmanager
def connection(path, **options):
    db = sqlite3.connect(path, **options)
    try:
        with db:
            yield db
    finally:
        db.close()


def schema(db):
    # Use the actual production baseline SQL rather than mocked tables.
    projects = re.search(r'sql: "(CREATE TABLE IF NOT EXISTS projects \(.*?)",\s*kind:', SOURCE, re.S).group(1)
    worktrees = re.search(r'MIGRATION_ADD_WORKTREE_ISOLATION_SQL: &str = "(.*?)";', SOURCE, re.S).group(1)
    db.executescript(projects + ';' + worktrees)
    db.execute("INSERT INTO projects (id,name,path,created_at,updated_at) VALUES ('p','P','/p','',''),('q','Q','/q','','')")
    db.commit()


def insert(db, identity, project='p', **extra):
    values = dict(id=identity, project_id=project, name=identity, branch=identity,
                  path='/' + str(identity), created_at='', updated_at='', **extra)
    return db.execute('INSERT INTO worktrees (' + ','.join(values) + ') VALUES (' + ','.join('?' for _ in values) + ')', list(values.values()))


def migrate(db):
    db.executescript('BEGIN;\n' + SQL + '\nCOMMIT;')


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        schema(self.db)
        migrate(self.db)

    def error(self, code, message, action):
        with self.assertRaises(sqlite3.IntegrityError) as caught:
            action()
        self.assertEqual(caught.exception.sqlite_errorcode, code)
        self.assertIn(message, str(caught.exception))

    def ordinal(self, identity):
        return self.db.execute('SELECT label_ordinal FROM worktrees WHERE id=?', (identity,)).fetchone()[0]

    def high(self):
        return self.db.execute("SELECT worktree_label_high_water FROM projects WHERE id='p'").fetchone()[0]

    def test_registered_after_49(self):
        self.assertIn('MIGRATION_ADD_WORKTREE_SHORT_LABELS_VERSION: i64 = 50', SOURCE)
        registry = SOURCE[SOURCE.index('pub(crate) fn migrations()'):]
        self.assertGreater(registry.index('version: MIGRATION_ADD_WORKTREE_SHORT_LABELS_VERSION'), registry.index('version: MIGRATION_ADD_PROJECT_IDEA_SORT_ORDER_VERSION'))
        self.assertIn('include_str!("migrations/worktree_short_labels.sql")', SOURCE)

    def test_backfill_all_statuses_ties_and_project_isolation(self):
        with connection(':memory:') as db:
            schema(db)
            for identity, status, project, timestamp in [('b','archived','p','1'), ('a','pending','p','1'), ('c','active','p','2'), ('d','deleted','q','0')]:
                insert(db, identity, project, status=status)
                db.execute('UPDATE worktrees SET created_at=? WHERE id=?', (timestamp, identity))
            db.commit()
            migrate(db)
            self.assertEqual(db.execute('SELECT id,label_ordinal,short_label FROM worktrees ORDER BY id').fetchall(), [('a',1,''),('b',2,''),('c',3,''),('d',1,'')])
            self.assertEqual(db.execute('SELECT worktree_label_high_water FROM projects ORDER BY id').fetchall(), [(3,), (1,)])

    def test_legacy_insert_delete_all_restore_and_immutable(self):
        insert(self.db, 'a'); insert(self.db, 'b')
        self.assertEqual((self.ordinal('a'), self.ordinal('b')), (1,2))
        self.db.execute("DELETE FROM worktrees WHERE id='b'")
        insert(self.db, 'c'); self.assertEqual(self.ordinal('c'), 3)
        self.db.execute('DELETE FROM worktrees')
        insert(self.db, 'd'); self.assertEqual(self.ordinal('d'), 4)
        insert(self.db, 'restore', label_ordinal=20)
        insert(self.db, 'old', label_ordinal=2)
        insert(self.db, 'next'); self.assertEqual(self.ordinal('next'), 21)
        for assignment in ['label_ordinal=22', 'label_ordinal=NULL', "project_id='q'"]:
            self.error(1811, 'worktree_label_ordinal_immutable', lambda: self.db.execute("UPDATE worktrees SET " + assignment + " WHERE id='next'"))
        self.db.execute("UPDATE worktrees SET label_ordinal=21, short_label='ship' WHERE id='next'")
        self.db.execute("UPDATE worktrees SET short_label='' WHERE id='next'")
        self.assertEqual(self.ordinal('next'), 21)
        self.error(1811, 'cannot_decrease', lambda: self.db.execute("UPDATE projects SET worktree_label_high_water=0 WHERE id='p'"))
        self.error(2067, 'worktrees.project_id, worktrees.label_ordinal', lambda: insert(self.db, 'duplicate', label_ordinal=20))
        self.error(1811, 'project_missing', lambda: insert(self.db, 'orphan', 'absent'))

    def test_labels_unicode_controls_reserved_case_and_update(self):
        insert(self.db, 'a', short_label='Ship')
        insert(self.db, 'other-project', 'q', short_label='ship')
        self.error(2067, 'worktrees.project_id, worktrees.short_label', lambda: insert(self.db, 'dupe', short_label='sHIP'))
        invalid = ['a'*13, '😀'*13, 'W1', 'w000', 'W12345678901'] + ['a'+chr(c) for c in [0,1,9,10,13,31,127,128,159,1564,8206,8207,8232,8233,8234,8238,8294,8297]]
        for label in invalid:
            self.error(275, 'worktree_short_label_valid', lambda: insert(self.db, 'invalid', short_label=label))
            self.error(275, 'worktree_short_label_valid', lambda: self.db.execute("UPDATE worktrees SET short_label=? WHERE id='a'", (label,)))
        for i, label in enumerate(['', '', '😀'*12, 'W', 'w１', 'W1x', 'é', 'É']):
            insert(self.db, 'valid'+str(i), short_label=label)
        self.error(1299, 'worktrees.short_label', lambda: insert(self.db, 'null', short_label=None))

    def test_ranges_overflow_and_failed_statement_atomicity(self):
        for value in [0,-1,2147483648,1.5,'bad']:
            self.error(275, 'worktree_ordinal_range', lambda: insert(self.db, 'bad', label_ordinal=value))
        for value in [-1,2147483648,1.5,'bad']:
            # Negative values hit the monotonic guard before the CHECK.
            self.error(1811 if value == -1 else 275, 'cannot_decrease' if value == -1 else 'worktree_high_water_range', lambda: self.db.execute('UPDATE projects SET worktree_label_high_water=?', (value,)))
        insert(self.db, 'maximum', label_ordinal=2147483647)
        self.error(1811, 'worktree_label_ordinal_exhausted', lambda: insert(self.db, 'overflow'))
        self.assertEqual(self.high(), 2147483647)
        insert(self.db, 'lower-restore', label_ordinal=10)
        self.db.execute('DELETE FROM worktrees')
        self.error(1811, 'exhausted', lambda: insert(self.db, 'still-overflow'))
        self.assertEqual(self.db.execute('SELECT count(*) FROM worktrees').fetchone()[0], 0)

    def test_multirow_single_statement_and_failure_does_not_consume(self):
        self.db.execute("""INSERT INTO worktrees (id,project_id,name,branch,path,created_at,updated_at)
            VALUES ('one','p','one','','/one','',''), ('two','p','two','','/two','','')""")
        self.assertEqual((self.ordinal('one'), self.ordinal('two'), self.high()), (1,2,2))
        self.error(2067, 'worktrees.path', lambda: self.db.execute("""INSERT INTO worktrees
            (id,project_id,name,branch,path,created_at,updated_at)
            VALUES ('three','p','three','','/three','',''), ('four','p','four','','/one','','')"""))
        self.assertEqual(self.high(), 2)
        self.assertEqual(self.db.execute('SELECT count(*) FROM worktrees').fetchone()[0], 2)
        insert(self.db, 'null-sentinel', label_ordinal=None)
        self.assertEqual(self.ordinal('null-sentinel'), 3)

    def test_restore_transaction_rollback(self):
        self.db.execute('BEGIN')
        self.db.execute("UPDATE projects SET worktree_label_high_water=100 WHERE id='p'")
        insert(self.db, 'restore1', label_ordinal=12, short_label='Ship')
        self.error(2067, 'short_label', lambda: insert(self.db, 'restore2', label_ordinal=13, short_label='ship'))
        self.db.rollback()  # ABORT rejects the statement, restore owner must rollback the transaction.
        self.assertEqual(self.high(), 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM worktrees').fetchone()[0], 0)

    def test_concurrent_connections_and_reopen(self):
        with tempfile.TemporaryDirectory(prefix='worktree-label-test-') as temp:
            path = pathlib.Path(temp) / 'isolated.sqlite'
            with connection(path) as db:
                schema(db); migrate(db)
                db.execute('PRAGMA journal_mode=WAL')
            def worker(i):
                with connection(path, timeout=20) as db:
                    db.execute('PRAGMA recursive_triggers=ON')
                    insert(db, 'concurrent'+str(i))
                    return db.execute('SELECT label_ordinal FROM worktrees WHERE id=?', ('concurrent'+str(i),)).fetchone()[0]
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(sorted(pool.map(worker, range(40))), list(range(1,41)))
            with connection(path) as db:
                db.execute('DELETE FROM worktrees'); db.commit()
            with connection(path) as db:
                insert(db, 'reopened')
                self.assertEqual(db.execute('SELECT label_ordinal FROM worktrees').fetchone()[0], 41)


if __name__ == '__main__':
    print('SQLite', sqlite3.sqlite_version)
    unittest.main(verbosity=2)
