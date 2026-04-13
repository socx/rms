#!/usr/bin/env bash
set -euo pipefail

# Load env files if present (prefer .env.dev then .env)
load_dotenv_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    # skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    # accept only simple KEY=VALUE assignments
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      # strip surrounding quotes
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      export "$key"="$val"
    else
      echo "Skipping non-assignment line in $file: $line" >&2
    fi
  done < "$file"
}

load_dotenv_file .env.dev
load_dotenv_file .env

# Allow quick dry-run to verify env parsing without running psql
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN: loaded env. DATABASE_URL=${DATABASE_URL:-<not set>}"
  exit 0
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set. Please set it in environment or in .env.dev/.env"
  exit 1
fi

echo "Applying infra/rms_002_email_outbox.sql to $$DATABASE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/rms_002_email_outbox.sql

echo "Migration applied."
