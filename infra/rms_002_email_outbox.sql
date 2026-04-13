-- Add email_outbox table and enum for worker outbox (idempotent)

DO $$
BEGIN
    CREATE TYPE outbox_status AS ENUM ('pending', 'sent', 'failed');
EXCEPTION
    WHEN duplicate_object THEN NULL; -- type already exists
END$$;

CREATE TABLE IF NOT EXISTS email_outbox (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID        REFERENCES users (id) ON DELETE SET NULL,
        to_address  VARCHAR(320) NOT NULL,
        subject     VARCHAR(255) NOT NULL,
        body_html   TEXT,
        status      outbox_status NOT NULL DEFAULT 'pending',
        attempts    INTEGER     NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        sent_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox (status);
