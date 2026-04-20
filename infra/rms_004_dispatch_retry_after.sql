-- Migration 004: add retry_after column to reminder_dispatches
-- This column was present in the Prisma schema but missing from the initial
-- SQL migration, causing Prisma to fail when creating dispatch records in CI.

ALTER TABLE reminder_dispatches
    ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;

-- Replace the old retry index (which didn't include retry_after) with one
-- that matches the Prisma schema index on (status, retry_after).
DROP INDEX IF EXISTS rd_retry_idx;
CREATE INDEX IF NOT EXISTS rd_retry_idx ON reminder_dispatches (status, retry_after);
