-- +goose Up
CREATE TABLE homepage_blocks (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    block_type text NOT NULL CHECK (block_type IN ('hero_carousel', 'product_carousel', 'deal')),
    position   int NOT NULL,
    title      text NOT NULL DEFAULT '',
    config     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
    is_active  boolean NOT NULL DEFAULT true,
    starts_at  timestamptz,
    ends_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX homepage_blocks_active_position_idx ON homepage_blocks (position) WHERE is_active;

-- +goose Down
DROP TABLE homepage_blocks;
