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
# Prefer a local `.env`, then `.env.dev`, then fall back to parent `.env` or `.env.example`.
base_dir = os.path.dirname(__file__)
candidates = [
  os.path.join(base_dir, '.env'),
  os.path.join(base_dir, '.env.dev'),
  os.path.join(base_dir, '.env.local'),
  os.path.join(base_dir, '..', '.env'),
  os.path.join(base_dir, '..', '.env.example'),
]
loaded = False
for p in candidates:
  if os.path.exists(p):
    load_dotenv(p)
    loaded = True
    break
if not loaded:
  load_dotenv()  # fallback to default search

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)

if __name__ == '__main__':
  # Import scheduler after env vars are loaded so DB settings are available.
  from engine.scheduler import run_scheduler
  logging.info('RMS Dispatch Engine starting...')
  run_scheduler()
