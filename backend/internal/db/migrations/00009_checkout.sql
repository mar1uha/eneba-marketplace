-- +goose Up
-- Editions of the same game (Steam Global, Nintendo Europe, ...) point at the main edition.
ALTER TABLE products
    ADD COLUMN edition_of bigint REFERENCES products (id) ON DELETE SET NULL,
    ADD CONSTRAINT products_edition_not_self CHECK (edition_of <> id);

CREATE INDEX products_edition_of_idx ON products (edition_of) WHERE edition_of IS NOT NULL;

CREATE TABLE cart_items (
    user_id           bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    offer_id          bigint NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
    quantity          int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
    -- Price when added, so the cart can say "price changed" instead of silently charging more.
    added_price_cents int NOT NULL CHECK (added_price_cents > 0),
    added_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, offer_id)
);

-- 'expired' is never stored by a background job: a pending order past reserved_until reads as expired.
CREATE TABLE orders (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),
    total_cents    int NOT NULL CHECK (total_cents > 0),
    reserved_until timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    paid_at        timestamptz,
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);

-- unit_price_cents is copied at checkout, so later price changes never alter a placed order.
CREATE TABLE order_items (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id         bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    offer_id         bigint NOT NULL REFERENCES offers (id) ON DELETE RESTRICT,
    unit_price_cents int NOT NULL CHECK (unit_price_cents > 0),
    quantity         int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
    UNIQUE (order_id, offer_id)
);

-- A key is for sale when it is available, or reserved by a checkout whose timer ran out:
--   status = 'available' OR (status = 'reserved' AND reserved_until < now())
CREATE TABLE digital_keys (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    offer_id       bigint NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
    code           text NOT NULL UNIQUE,
    status         text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
    order_item_id  bigint REFERENCES order_items (id) ON DELETE SET NULL,
    reserved_until timestamptz,
    sold_at        timestamptz,
    revealed_at    timestamptz,
    CHECK (status <> 'available' OR (order_item_id IS NULL AND reserved_until IS NULL AND sold_at IS NULL)),
    CHECK (status <> 'reserved' OR reserved_until IS NOT NULL),
    CHECK (status <> 'sold' OR sold_at IS NOT NULL),
    CHECK (revealed_at IS NULL OR status = 'sold')
);

CREATE INDEX digital_keys_offer_status_idx ON digital_keys (offer_id, status);
CREATE INDEX digital_keys_order_item_idx ON digital_keys (order_item_id) WHERE order_item_id IS NOT NULL;

-- Simulated card payments. Only the brand and last 4 digits are stored, never the card number.
CREATE TABLE payments (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    amount_cents int NOT NULL CHECK (amount_cents > 0),
    status       text NOT NULL CHECK (status IN ('succeeded', 'declined')),
    decline_code text,
    card_brand   text NOT NULL,
    card_last4   text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'declined') = (decline_code IS NOT NULL))
);

-- The database itself refuses a second successful charge for one order.
CREATE UNIQUE INDEX payments_one_success_per_order ON payments (order_id) WHERE status = 'succeeded';

-- +goose Down
DROP TABLE payments;
DROP TABLE digital_keys;
DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE cart_items;
DROP INDEX products_edition_of_idx;
ALTER TABLE products DROP CONSTRAINT products_edition_not_self, DROP COLUMN edition_of;
