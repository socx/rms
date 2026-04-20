#!/usr/bin/env python3
"""
Reminder Management System — Dispatch Engine
============================================
Polls the database for due reminders and fans out delivery to subscribers.
Poll frequency is controlled at runtime via the system_settings table:
  PATCH /admin/settings/dispatch_poll_interval_seconds

No restart required when the poll interval changes.
"""
import os
import time
import logging
from dotenv import load_dotenv

# Load environment variables from .env files.
# Prefer a central repo `.env.dev` (parent), then repo `.env`, then local worker files.
# This makes the worker pick up the root `.env.dev` when present.
base_dir = os.path.dirname(__file__)
candidates = [
  os.path.join(base_dir, '..', '.env'),
  os.path.join(base_dir, '..', '.env.dev'),
  os.path.join(base_dir, '..', '.env.example'),
  os.path.join(base_dir, '.env'),
  os.path.join(base_dir, '.env.dev'),
  os.path.join(base_dir, '.env.local'),
]
loaded = False
for p in candidates:
  if os.path.exists(p):
    # Force dotenv to override any existing environment variables so the
    # repo-root `.env.dev` takes precedence over exported vars or local files.
    load_dotenv(p, override=True)
    logging.basicConfig(level=logging.INFO)
    logging.getLogger(__name__).info('Loaded environment from %s', p)
    loaded = True
    break
if not loaded:
  # fallback to default search behavior of python-dotenv and allow overriding
  load_dotenv(override=True)
  logging.getLogger(__name__).info('Loaded environment from default lookup')

# Log selected important envs for debugging
logging.getLogger(__name__).info('USE_SEND_GRID=%s SENDGRID_API_KEY_SET=%s', os.environ.get('USE_SEND_GRID'), bool(os.environ.get('SENDGRID_API_KEY')))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)

if __name__ == '__main__':
  # Import scheduler after env vars are loaded so DB settings are available.
  from engine.scheduler import run_scheduler
  logging.info('RMS Dispatch Engine starting...')
  run_scheduler()
