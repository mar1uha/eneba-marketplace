-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- +goose Down
-- The extension is database-wide and may serve other schemas, so rolling back leaves it in place.
