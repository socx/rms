-- Migration 003: add revoked_tokens table
-- Stores JWT token hashes that have been explicitly revoked (e.g. on logout).
-- The authenticate middleware checks this table on every authenticated request.

CREATE TABLE IF NOT EXISTS revoked_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  VARCHAR(128) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens (expires_at);
