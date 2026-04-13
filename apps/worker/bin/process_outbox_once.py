#!/usr/bin/env python3
"""
Run a single pass of the email outbox processor. Useful for tests and one-off runs.

Usage:
  SKIP_SENDGRID=1 python3 apps/worker/bin/process_outbox_once.py
"""
import os
from dotenv import load_dotenv

# Load env similar to main.py
base_dir = os.path.dirname(os.path.dirname(__file__))
candidates = [
  os.path.join(base_dir, '.env'),
  os.path.join(base_dir, '.env.dev'),
  os.path.join(base_dir, '.env.local'),
  os.path.join(base_dir, '..', '.env'),
  os.path.join(base_dir, '..', '.env.example'),
]
for p in candidates:
    if os.path.exists(p):
        load_dotenv(p)
        break

import logging
import sys
import os
logging.basicConfig(level=logging.INFO)

# Ensure apps/worker is on sys.path so `import engine` works regardless of cwd
script_dir = os.path.dirname(os.path.abspath(__file__))
worker_root = os.path.dirname(script_dir)
if worker_root not in sys.path:
    sys.path.insert(0, worker_root)

from engine import outbox, delivery
from engine.db import SessionLocal


class DummyEmailAdapter:
    def send(self, dispatch: dict) -> bool:
        # pretend to send
        return True


def main():
    # Optionally skip real SendGrid usage
    if os.environ.get('SKIP_SENDGRID'):
        delivery.EmailAdapter = DummyEmailAdapter

    with SessionLocal() as session:
        outbox.process_outbox(session, batch_size=50)


if __name__ == '__main__':
    main()
