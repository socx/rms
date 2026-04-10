-- =============================================================
-- Reminder Management System — Initial Database Migration
-- PostgreSQL 16
-- Version: 1.1.0
-- =============================================================
-- Run order respects foreign key dependencies.
-- All tables use UUID primary keys (gen_random_uuid()).
-- All timestamps are timestamptz (UTC stored, timezone-aware).
-- =============================================================

-- Enable pgcrypto for gen_random_uuid() if not already available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUM TYPES
-- =============================================================

CREATE TYPE system_role      AS ENUM ('user', 'system_admin');
CREATE TYPE user_status      AS ENUM ('active', 'disabled', 'deleted');
CREATE TYPE event_status     AS ENUM ('active', 'cancelled', 'archived');
CREATE TYPE event_role       AS ENUM ('owner', 'contributor', 'reader');
CREATE TYPE subscriber_status AS ENUM ('active', 'unsubscribed');
CREATE TYPE contact_channel  AS ENUM ('email', 'sms');
CREATE TYPE contact_status   AS ENUM ('active', 'inactive');
CREATE TYPE reminder_status  AS ENUM ('scheduled', 'processing', 'recurring', 'sent', 'cancelled', 'failed');
CREATE TYPE recurrence_type  AS ENUM (
    'never',
    'hourly',
    'daily',
    'weekdays',
    'weekends',
    'weekly',
    'fortnightly',
    'monthly',
    'every_3_months',
    'every_6_months',
    'yearly'
);
CREATE TYPE dispatch_status  AS ENUM ('pending', 'sent', 'failed', 'skipped');
CREATE TYPE api_key_status   AS ENUM ('active', 'revoked');
CREATE TYPE api_key_scope    AS ENUM (
    'users:read',
    'events:read',
    'events:write',
    'subscribers:read',
    'subscribers:write',
    'reports:read'
);

-- =============================================================
-- TABLE: system_settings
-- Key/value store for platform-wide configuration.
-- Must be created before other tables reference it indirectly.
-- =============================================================

CREATE TABLE system_settings (
    key             VARCHAR(100)    PRIMARY KEY,
    value           TEXT            NOT NULL,
    description     TEXT,
    updated_by_id   UUID,           -- FK added after users table is created
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Seed default settings
INSERT INTO system_settings (key, value, description) VALUES
    ('allow_public_registration',       'false',    'When false, POST /auth/register returns 403. Toggle to open self-registration.'),
    ('dispatch_poll_interval_seconds',  '60',       'Seconds between dispatch engine poll cycles. Min: 10, Max: 3600. Changes are live — no restart required.'),
    ('dispatch_lookahead_seconds',      '65',       'Reminders due within this many seconds of NOW() are picked up each cycle. Should exceed poll interval slightly.'),
    ('dispatch_retry_max',              '3',        'Maximum delivery attempts per dispatch record before marking as permanently failed.'),
    ('dispatch_retry_backoff_minutes',  '1,5,15',   'Comma-separated backoff intervals in minutes between retry attempts.'),
    ('event_archive_days',              '90',       'Days after event_datetime before the nightly job auto-archives an event.'),
    ('default_email_wrapper_html',      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:32px}.footer{margin-top:32px;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px}</style></head><body><div class="container">{{body}}<div class="footer">This reminder was sent by the Reminder Management System.</div></div></body></html>',
     'Default HTML email wrapper. Must contain exactly one {{body}} placeholder.');

-- =============================================================
-- TABLE: users
-- =============================================================

CREATE TABLE users (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    firstname           VARCHAR(100)    NOT NULL,
    lastname            VARCHAR(100)    NOT NULL,
    email               VARCHAR(255)    NOT NULL,
    phone               VARCHAR(30),
    password_hash       VARCHAR         NOT NULL,
    timezone            VARCHAR(60)     NOT NULL DEFAULT 'UTC',
    system_role         system_role     NOT NULL DEFAULT 'user',
    status              user_status     NOT NULL DEFAULT 'active',
    email_verified      BOOLEAN         NOT NULL DEFAULT FALSE,
    email_verified_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX users_email_idx     ON users (email);
CREATE        INDEX users_status_idx    ON users (status);
CREATE        INDEX users_role_idx      ON users (system_role);

-- Add deferred FK on system_settings now that users exists
ALTER TABLE system_settings
    ADD CONSTRAINT fk_settings_updated_by
    FOREIGN KEY (updated_by_id) REFERENCES users (id)
    ON DELETE SET NULL;

-- =============================================================
-- TABLE: email_verification_tokens
-- =============================================================

CREATE TABLE email_verification_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  VARCHAR(128) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX evt_token_hash_idx  ON email_verification_tokens (token_hash);
CREATE        INDEX evt_user_id_idx     ON email_verification_tokens (user_id);
CREATE        INDEX evt_expires_idx     ON email_verification_tokens (expires_at)
    WHERE used_at IS NULL;  -- partial index: only unexpired/unused tokens

-- =============================================================
-- TABLE: api_keys
-- =============================================================

CREATE TABLE api_keys (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key_hash    VARCHAR(128)    NOT NULL,
    key_prefix  VARCHAR(8)      NOT NULL,
    name        VARCHAR(100)    NOT NULL,
    status      api_key_status  NOT NULL DEFAULT 'active',
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX api_keys_hash_idx       ON api_keys (key_hash);
CREATE        INDEX api_keys_user_id_idx    ON api_keys (user_id);
CREATE        INDEX api_keys_status_exp_idx ON api_keys (status, expires_at)
    WHERE expires_at IS NOT NULL;  -- partial index for expiry job

-- =============================================================
-- TABLE: api_key_scopes
-- =============================================================

CREATE TABLE api_key_scopes (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id  UUID            NOT NULL REFERENCES api_keys (id) ON DELETE CASCADE,
    scope       api_key_scope   NOT NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_api_key_scope UNIQUE (api_key_id, scope)
);

CREATE INDEX api_key_scopes_key_idx ON api_key_scopes (api_key_id);

-- =============================================================
-- TABLE: email_wrapper_settings
-- =============================================================

CREATE TABLE email_wrapper_settings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wrapper_html TEXT       NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_wrapper_owner UNIQUE (owner_id)
);

-- =============================================================
-- TABLE: events
-- =============================================================

CREATE TABLE events (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID            NOT NULL REFERENCES users (id),
    created_by_id   UUID            NOT NULL REFERENCES users (id),
    subject         VARCHAR(255)    NOT NULL,
    description     TEXT,
    event_datetime  TIMESTAMPTZ     NOT NULL,
    event_timezone  VARCHAR(60)     NOT NULL DEFAULT 'UTC',
    location        VARCHAR(500),
    status          event_status    NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX events_owner_id_idx    ON events (owner_id);
CREATE INDEX events_status_dt_idx   ON events (status, event_datetime);
CREATE INDEX events_created_by_idx  ON events (created_by_id);

-- =============================================================
-- TABLE: event_access
-- =============================================================

CREATE TABLE event_access (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role            event_role  NOT NULL,
    granted_by_id   UUID        NOT NULL REFERENCES users (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_event_access UNIQUE (event_id, user_id)
);

CREATE INDEX event_access_user_idx  ON event_access (user_id);
CREATE INDEX event_access_event_idx ON event_access (event_id);

-- =============================================================
-- TABLE: subscribers
-- =============================================================

CREATE TABLE subscribers (
    id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID                NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id     UUID                REFERENCES users (id) ON DELETE SET NULL,
    firstname   VARCHAR(100)        NOT NULL,
    lastname    VARCHAR(100)        NOT NULL,
    timezone    VARCHAR(60),        -- Nullable: falls back to event owner timezone then UTC
    status      subscriber_status   NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX sub_event_id_idx       ON subscribers (event_id);
CREATE INDEX sub_event_status_idx   ON subscribers (event_id, status);
CREATE INDEX sub_user_id_idx        ON subscribers (user_id) WHERE user_id IS NOT NULL;

-- =============================================================
-- TABLE: subscriber_contacts
-- =============================================================

CREATE TABLE subscriber_contacts (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id   UUID            NOT NULL REFERENCES subscribers (id) ON DELETE CASCADE,
    channel         contact_channel NOT NULL,
    contact_value   VARCHAR(320)    NOT NULL,
    is_primary      BOOLEAN         NOT NULL DEFAULT FALSE,
    label           VARCHAR(100),
    status          contact_status  NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX sc_subscriber_idx  ON subscriber_contacts (subscriber_id);
CREATE INDEX sc_primary_idx     ON subscriber_contacts (subscriber_id, channel, is_primary);
CREATE INDEX sc_status_idx      ON subscriber_contacts (status);

-- =============================================================
-- TABLE: reminders
-- =============================================================

CREATE TABLE reminders (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID            NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
    remind_at           TIMESTAMPTZ     NOT NULL,
    subject_template    VARCHAR(500)    NOT NULL,
    body_template       TEXT            NOT NULL,
    channels            contact_channel[] NOT NULL,
    recurrence          recurrence_type NOT NULL DEFAULT 'never',
    next_remind_at      TIMESTAMPTZ,    -- Null for non-recurring or when recurrence is complete
    last_dispatched_at  TIMESTAMPTZ,
    occurrence_count    INT             NOT NULL DEFAULT 0,
    status              reminder_status NOT NULL DEFAULT 'scheduled',
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- A reminder may not fire at or after the parent event
    -- (enforced in application layer with access to event_datetime)

    CONSTRAINT chk_channels_not_empty CHECK (array_length(channels, 1) >= 1)
);

-- Standard reminder index
CREATE INDEX rem_event_id_idx   ON reminders (event_id);

-- HOT PATH: first-fire scheduler poll (status = 'scheduled')
CREATE INDEX rem_scheduler_idx  ON reminders (status, remind_at)
    WHERE status = 'scheduled';

-- HOT PATH: recurring scheduler poll (status = 'recurring')
CREATE INDEX rem_recurring_idx  ON reminders (status, next_remind_at)
    WHERE status = 'recurring';

-- Max 5 reminders per event — enforced by application layer.
-- Optional DB-level guard (partial unique would require a counter; use app constraint instead).

-- =============================================================
-- TABLE: reminder_dispatches
-- Largest table in the system. Index discipline is critical.
-- =============================================================

CREATE TABLE reminder_dispatches (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    reminder_id             UUID            NOT NULL REFERENCES reminders (id) ON DELETE RESTRICT,
    subscriber_id           UUID            NOT NULL REFERENCES subscribers (id) ON DELETE RESTRICT,
    subscriber_contact_id   UUID            NOT NULL REFERENCES subscriber_contacts (id) ON DELETE RESTRICT,
    channel                 contact_channel NOT NULL,
    occurrence_number       INT             NOT NULL DEFAULT 1,
    rendered_subject        VARCHAR(500),   -- Null for SMS
    rendered_body           TEXT            NOT NULL,
    status                  dispatch_status NOT NULL DEFAULT 'pending',
    attempts                SMALLINT        NOT NULL DEFAULT 0,
    last_attempted_at       TIMESTAMPTZ,
    sent_at                 TIMESTAMPTZ,
    failure_reason          TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Load dispatches for one occurrence of a reminder (report generation, status checks)
CREATE INDEX rd_reminder_occ_idx    ON reminder_dispatches (reminder_id, occurrence_number);

-- Subscriber delivery history
CREATE INDEX rd_subscriber_idx      ON reminder_dispatches (subscriber_id);

-- HOT PATH: retry worker query — find failed records needing retry
CREATE INDEX rd_retry_idx           ON reminder_dispatches (status, attempts, last_attempted_at)
    WHERE status = 'failed';

-- All-dispatches-resolved check for report trigger
CREATE INDEX rd_pending_idx         ON reminder_dispatches (reminder_id, occurrence_number, status)
    WHERE status = 'pending';

-- Archive/cleanup queries — future partition key
CREATE INDEX rd_sent_at_idx         ON reminder_dispatches (sent_at)
    WHERE sent_at IS NOT NULL;

-- =============================================================
-- TABLE: reminder_reports
-- One record per reminder occurrence.
-- =============================================================

CREATE TABLE reminder_reports (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reminder_id         UUID        NOT NULL REFERENCES reminders (id) ON DELETE RESTRICT,
    occurrence_number   INT         NOT NULL DEFAULT 1,
    total_dispatches    INT         NOT NULL DEFAULT 0,
    total_sent          INT         NOT NULL DEFAULT 0,
    total_failed        INT         NOT NULL DEFAULT 0,
    total_skipped       INT         NOT NULL DEFAULT 0,
    failure_details     JSONB,      -- Array of {subscriber_id, channel, contact_value, reason}
    report_sent_to_owner    BOOLEAN     NOT NULL DEFAULT FALSE,
    report_sent_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_report_occurrence UNIQUE (reminder_id, occurrence_number)
);

CREATE INDEX rr_reminder_idx ON reminder_reports (reminder_id);

-- =============================================================
-- TRIGGERS: updated_at auto-maintenance
-- =============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscribers_updated_at
    BEFORE UPDATE ON subscribers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reminders_updated_at
    BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_wrapper_updated_at
    BEFORE UPDATE ON email_wrapper_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- COMMENTS
-- =============================================================

COMMENT ON TABLE  system_settings   IS 'Platform-wide key/value configuration. dispatch_poll_interval_seconds is read live by the dispatch engine each loop — no restart needed.';
COMMENT ON TABLE  users             IS 'Registered user accounts. Soft-delete only (status=deleted).';
COMMENT ON TABLE  api_keys          IS 'Named API keys for machine-to-machine access. Raw key never stored — only SHA-256 hash.';
COMMENT ON TABLE  api_key_scopes    IS 'Optional permission restrictions per API key. No rows = unrestricted.';
COMMENT ON TABLE  events            IS 'Schedulable occurrences. event_datetime is the hard boundary for all recurring reminders.';
COMMENT ON TABLE  event_access      IS 'Per-user role grants for a specific event.';
COMMENT ON TABLE  subscribers       IS 'Delivery targets scoped to one event. Timezone nullable — falls back to owner timezone then UTC.';
COMMENT ON TABLE  subscriber_contacts IS 'Individual contact details. channel enum is extension point: add new values + ChannelAdapter for new channels.';
COMMENT ON TABLE  reminders         IS 'Scheduled notifications. remind_at = first occurrence. next_remind_at managed by dispatch engine for recurring reminders.';
COMMENT ON TABLE  reminder_dispatches IS 'Atomic delivery records. One per reminder x subscriber x channel x occurrence. Largest table — partition by sent_at when >50M rows.';
COMMENT ON TABLE  reminder_reports  IS 'Per-occurrence delivery summaries. failure_details is JSONB array of {subscriber_id, channel, contact_value, reason}.';

COMMENT ON COLUMN reminders.recurrence         IS 'never = one-shot (default). All other values: remind_at is first occurrence, engine computes next_remind_at after each dispatch.';
COMMENT ON COLUMN reminders.next_remind_at     IS 'Next scheduled fire time for recurring reminders. NULL when recurrence=never or when no further occurrences remain before event_datetime.';
COMMENT ON COLUMN reminders.occurrence_count   IS 'Incremented by engine on each dispatch cycle. Drives {{occurrence_number}} template variable.';
COMMENT ON COLUMN reminder_dispatches.occurrence_number IS 'Which occurrence this dispatch belongs to. Matches reminders.occurrence_count at time of dispatch.';
COMMENT ON COLUMN subscribers.timezone         IS 'IANA timezone. NULL = use event owner timezone. If owner has none, use UTC. Resolution noted in {{event_timezone_label}}.';
COMMENT ON COLUMN events.event_timezone        IS 'IANA timezone for display and day-of-week recurrence calculations (weekdays/weekends/weekly).';

-- =============================================================
-- END OF MIGRATION
-- =============================================================
