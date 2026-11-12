package db_test

import (
	"fmt"
	"testing"

	"eneba-marketplace/backend/internal/db"
	"eneba-marketplace/backend/internal/testdb"
)

// Rolling every migration back must leave nothing of ours in the schema and must not touch
// database-wide objects (extensions) that other schemas use; migrating up again must rebuild the
// same seeded data.
func TestMigrationsRollBackAndReapply(t *testing.T) {
	pool := testdb.Pool(t, "rollback")
	ctx := t.Context()
	migrator, closeDB, err := db.NewMigrator(pool)
	if err != nil {
		t.Fatal(err)
	}
	defer closeDB()

	count := func(sql string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	seeded := func() string {
		return fmt.Sprint(
			count(`SELECT count(*) FROM products`), count(`SELECT count(*) FROM offers`),
			count(`SELECT count(*) FROM digital_keys`), count(`SELECT count(*) FROM genres`),
			count(`SELECT count(*) FROM homepage_blocks`), count(`SELECT count(*) FROM products WHERE edition_of IS NOT NULL`),
		)
	}
	before := seeded()

	if _, err := migrator.DownTo(ctx, 0); err != nil {
		t.Fatalf("roll back: %v", err)
	}
	if n := count(`SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name <> 'goose_db_version'`); n != 0 {
		t.Errorf("%d tables left after rolling everything back", n)
	}
	if n := count(`SELECT count(*) FROM pg_extension WHERE extname IN ('pg_trgm', 'fuzzystrmatch')`); n != 2 {
		t.Fatalf("rolling back one schema removed database-wide extensions (%d of 2 left)", n)
	}

	if _, err := migrator.Up(ctx); err != nil {
		t.Fatalf("migrate up again: %v", err)
	}
	if after := seeded(); after != before {
		t.Errorf("seed after re-applying = %s, want %s (products offers keys genres blocks editions)", after, before)
	}
}
