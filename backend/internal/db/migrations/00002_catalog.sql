-- +goose Up
CREATE TABLE sellers (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         text NOT NULL UNIQUE,
    rating       numeric(4, 1) NOT NULL CHECK (rating BETWEEN 0 AND 100),
    review_count int NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title        text NOT NULL,
    description  text NOT NULL DEFAULT '',
    cover_url    text NOT NULL,
    banner_url   text NOT NULL,
    platform     text NOT NULL CHECK (platform IN ('steam', 'xbox', 'playstation', 'nintendo', 'ea_app', 'ubisoft_connect', 'gog', 'epic')),
    region       text NOT NULL CHECK (region IN ('global', 'europe', 'north_america', 'united_kingdom')),
    product_type text NOT NULL DEFAULT 'game' CHECK (product_type IN ('game', 'dlc', 'gift_card', 'subscription')),
    msrp_cents   int NOT NULL CHECK (msrp_cents > 0),
    release_date date,
    sold_count   int NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_sold_count_idx ON products (sold_count DESC);
CREATE INDEX products_release_date_idx ON products (release_date DESC);

CREATE TABLE offers (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    seller_id   bigint NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
    price_cents int NOT NULL CHECK (price_cents > 0),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_id, seller_id)
);

CREATE INDEX offers_active_product_price_idx ON offers (product_id, price_cents) WHERE is_active;

-- +goose Down
DROP TABLE offers;
DROP TABLE products;
DROP TABLE sellers;
