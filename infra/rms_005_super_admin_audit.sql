-- rms_005_super_admin_audit.sql
-- Idempotent. Requires a superuser connection (owns the enum types).
-- Adds: super_admin role value, audit_action enum, audit_entity_type enum,
--       audit_logs table, indexes, and grants to rms_db_user (if it exists).

-- 1. Extend existing system_role enum
ALTER TYPE system_role ADD VALUE IF NOT EXISTS 'super_admin';

-- 2. New audit_action enum (idempotent via DO block)
DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. New audit_entity_type enum (idempotent via DO block)
DO $$ BEGIN
  CREATE TYPE audit_entity_type AS ENUM ('event', 'reminder', 'subscriber', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  actor_email   varchar(255) NOT NULL,
  action        audit_action NOT NULL,
  entity_type   audit_entity_type NOT NULL,
  entity_id     uuid        NOT NULL,
  entity_summary varchar(500),
  changes       jsonb,
  ip_address    varchar(45),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx   ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx    ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx  ON audit_logs(created_at);

-- 5. Grant to app user (skipped silently if the role does not exist, e.g. in CI)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rms_db_user') THEN
    GRANT SELECT, INSERT ON TABLE audit_logs TO rms_db_user;
  END IF;
END $$;
