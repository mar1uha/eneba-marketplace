-- +goose Up
-- levenshtein_less_equal() powers typo-tolerant search; pg_trgm (00001) ranks results and finds "did you mean" titles.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE TABLE genres (
    id   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL UNIQUE
);

CREATE TABLE product_genres (
    product_id bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    genre_id   smallint NOT NULL REFERENCES genres (id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, genre_id)
);

-- Search compares normalized text: lowercase; apostrophes, dots, and commas removed so "Baldur's" matches
-- "baldurs", "S.T.A.L.K.E.R." matches "stalker", and "40,000" matches "40000"; every other run of
-- non-alphanumerics becomes one space.
-- +goose StatementBegin
CREATE FUNCTION search_normalize(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN btrim(regexp_replace(regexp_replace(lower(t), '[''’.,]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'));
-- +goose StatementEnd

-- search_keywords holds aliases people type but titles lack, such as "gta 5" or "bg3".
ALTER TABLE products
    ADD COLUMN search_keywords text NOT NULL DEFAULT '',
    ADD COLUMN search_text text GENERATED ALWAYS AS (search_normalize(title || ' ' || search_keywords)) STORED;

-- +goose Down
ALTER TABLE products DROP COLUMN search_text, DROP COLUMN search_keywords;
DROP FUNCTION search_normalize(text);
DROP TABLE product_genres;
DROP TABLE genres;
DROP EXTENSION IF EXISTS fuzzystrmatch;
