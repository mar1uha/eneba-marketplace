package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	return pool, nil
}

// NewMigrator returns the goose provider for the embedded migrations; call closeDB when done.
func NewMigrator(pool *pgxpool.Pool) (provider *goose.Provider, closeDB func() error, err error) {
	sqlDB := stdlib.OpenDBFromPool(pool)
	migrations, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		sqlDB.Close()
		return nil, nil, err
	}
	// An advisory lock makes concurrent starters (several instances, parallel test packages) migrate one at a time.
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		sqlDB.Close()
		return nil, nil, fmt.Errorf("init migration lock: %w", err)
	}
	provider, err = goose.NewProvider(goose.DialectPostgres, sqlDB, migrations, goose.WithSessionLocker(locker))
	if err != nil {
		sqlDB.Close()
		return nil, nil, fmt.Errorf("init migrations: %w", err)
	}
	return provider, sqlDB.Close, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	provider, closeDB, err := NewMigrator(pool)
	if err != nil {
		return err
	}
	defer closeDB()
	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	for _, r := range results {
		slog.Info("migration applied", "version", r.Source.Version, "file", r.Source.Path)
	}
	return nil
}
