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
from engine.scheduler import run_scheduler

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)

if __name__ == '__main__':
    logging.info('RMS Dispatch Engine starting...')
    run_scheduler()
