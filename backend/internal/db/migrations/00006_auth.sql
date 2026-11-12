-- +goose Up
CREATE TABLE users (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         text NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
    display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
    password_hash text,
    google_sub    text UNIQUE,
    -- Set once the user proves they own the email (Google sign-in or a completed password reset).
    email_verified_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- Every account needs at least one way to sign in.
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

-- The cookie holds a random token; only its SHA-256 hash is stored, so a database leak does not leak live sessions.
CREATE TABLE sessions (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   bytea NOT NULL UNIQUE,
    user_agent   text NOT NULL DEFAULT '',
    ip           text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE password_reset_tokens (
    token_hash bytea PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);

-- +goose Down
DROP TABLE password_reset_tokens;
DROP TABLE sessions;
DROP TABLE users;
