#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# RMS — Apply database migrations
# Reads DATABASE_URL from environment, .env.dev, or .env (in that order).
# Safe to run on an existing database — all migrations after rms_001 are
# idempotent. rms_001 is skipped automatically if the schema already exists.
#
# Usage:
#   ./infra/scripts/apply-migration.sh
#   DRY_RUN=1 ./infra/scripts/apply-migration.sh   # verify env without running psql
# =============================================================================

# Resolve the repo root regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Load env files (prefer .env.dev, then .env) ───────────────────────────────
load_dotenv_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      export "$key"="$val"
    else
      echo "Skipping non-assignment line in $file: $line" >&2
    fi
  done < "$file"
}

load_dotenv_file "$REPO_ROOT/.env.dev"
load_dotenv_file "$REPO_ROOT/.env"

# ── Dry-run mode ──────────────────────────────────────────────────────────────
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN: DATABASE_URL=${DATABASE_URL:-<not set>}"
  exit 0
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Add it to .env or export it before running."
  exit 1
fi

cd "$REPO_ROOT"

# ── rms_001: initial schema (not idempotent — skip if schema already exists) ──
SCHEMA_EXISTS=$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.users')" 2>/dev/null || echo "")
if [ -z "$SCHEMA_EXISTS" ]; then
  echo "Fresh database — applying initial schema (rms_001)..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/rms_001_initial_schema.sql
else
  echo "Schema already exists — skipping rms_001."
fi

# ── rms_002-004: idempotent — always safe to re-run ───────────────────────────
echo "Applying rms_002 (email_outbox)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/rms_002_email_outbox.sql

echo "Applying rms_003 (revoked_tokens)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/rms_003_revoked_tokens.sql

echo "Applying rms_004 (dispatch retry_after)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/rms_004_dispatch_retry_after.sql

echo "All migrations applied successfully."
