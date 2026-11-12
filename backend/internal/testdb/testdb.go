// Package testdb connects integration tests to TEST_DATABASE_URL. Each test package gets its own
// schema, migrated and seeded, so packages running in parallel never see each other's fixtures.
package testdb

import (
	"context"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"eneba-marketplace/backend/internal/db"
)

// Pool returns a pool whose tables live in schema "test_<name>". Tests skip without TEST_DATABASE_URL.
func Pool(t *testing.T, name string) *pgxpool.Pool {
	t.Helper()
	_ = godotenv.Load("../../.env")
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	schema := "test_" + name

	setup, err := db.Connect(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	// Extensions are database-wide; creating them in public first keeps the migrations from putting
	// them in whichever test schema happens to migrate first. The advisory lock serializes test
	// packages starting together on a fresh database: CREATE EXTENSION IF NOT EXISTS is not safe to
	// run concurrently and fails with a duplicate key in pg_extension. It must be a transaction lock:
	// these statements run as one implicit transaction, and a session lock released before COMMIT
	// would let the next package in before the extensions are visible to it.
	_, err = setup.Exec(ctx, `
		SELECT pg_advisory_xact_lock(727001);
		CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
		CREATE EXTENSION IF NOT EXISTS fuzzystrmatch SCHEMA public;
		CREATE SCHEMA IF NOT EXISTS `+schema)
	setup.Close()
	if err != nil {
		t.Fatal(err)
	}

	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()

	pool, err := db.Connect(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool
}
