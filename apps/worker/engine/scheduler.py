"""
Main scheduler loop for the RMS dispatch engine.

Poll interval is read from system_settings.dispatch_poll_interval_seconds
on EVERY loop iteration — changes are live without restart.
"""
import time
import logging
from .db import SessionLocal, get_setting
from .poller import poll_and_dispatch

logger = logging.getLogger(__name__)

FALLBACK_INTERVAL = 60      # seconds — used if DB read fails
MIN_INTERVAL = 10           # seconds — lower safety bound
MAX_INTERVAL = 3600         # seconds — upper safety bound

def run_scheduler():
    """Infinite loop: poll, dispatch, sleep, repeat."""
    last_interval = FALLBACK_INTERVAL

    while True:
        interval = last_interval  # default to last known good value
        try:
            with SessionLocal() as session:
                raw = get_setting(session, 'dispatch_poll_interval_seconds', str(FALLBACK_INTERVAL))
                interval = max(MIN_INTERVAL, min(MAX_INTERVAL, int(raw)))
                last_interval = interval

                lookahead = int(get_setting(session, 'dispatch_lookahead_seconds', '65'))
                poll_and_dispatch(session, lookahead_seconds=lookahead)

        except Exception as e:
            logger.exception('Error in scheduler loop: %s', e)

        logger.debug('Sleeping %ds before next poll cycle', interval)
        time.sleep(interval)
