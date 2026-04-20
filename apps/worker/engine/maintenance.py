"""
Nightly maintenance jobs for the RMS dispatch engine.

Jobs run once per UTC day at or after 02:00 UTC:
  - archive_stale_events  — set status='archived' for events whose
    event_datetime is more than `event_archive_days` days in the past.
  - expire_api_keys       — set status='revoked' for api_keys whose
    expires_at is <= NOW().

The scheduler tracks the last-run date in memory so each job fires at most
once per calendar day (UTC), regardless of how frequently the poll loop runs.
"""
import logging
from datetime import datetime, timezone, date

from sqlalchemy import text

from .db import get_setting

logger = logging.getLogger(__name__)


def archive_stale_events(session) -> int:
    """
    Archive events whose event_datetime has passed by more than
    `event_archive_days` days (default 90).

    Returns the number of rows updated.
    """
    archive_days = int(get_setting(session, 'event_archive_days', '90'))
    result = session.execute(text("""
        UPDATE events
           SET status     = 'archived',
               updated_at = NOW()
         WHERE status       = 'active'
           AND event_datetime < NOW() - INTERVAL '1 day' * :days
    """), {'days': archive_days})
    session.commit()
    count = result.rowcount
    if count:
        logger.info('archive_stale_events: archived %d event(s) (threshold=%d days)', count, archive_days)
    else:
        logger.debug('archive_stale_events: no stale events found (threshold=%d days)', archive_days)
    return count


def expire_api_keys(session) -> int:
    """
    Revoke API keys whose expires_at timestamp is <= NOW().

    Returns the number of rows updated.
    """
    result = session.execute(text("""
        UPDATE api_keys
           SET status     = 'revoked',
               revoked_at = NOW()
         WHERE status    = 'active'
           AND expires_at IS NOT NULL
           AND expires_at <= NOW()
    """))
    session.commit()
    count = result.rowcount
    if count:
        logger.info('expire_api_keys: revoked %d key(s)', count)
    else:
        logger.debug('expire_api_keys: no expired keys found')
    return count


def run_nightly_jobs(session, now: datetime | None = None) -> dict:
    """
    Run all nightly maintenance jobs.
    Returns a dict with counts for each job.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    logger.info('Running nightly maintenance jobs (UTC %s)', now.isoformat())

    archived = archive_stale_events(session)
    revoked = expire_api_keys(session)

    return {'archived_events': archived, 'revoked_keys': revoked}


class NightlySchedule:
    """
    Tracks whether the nightly window (02:00–03:00 UTC) has already fired
    today, so jobs run exactly once per day even when the poll loop is tight.
    """
    WINDOW_HOUR = 2   # 02:00 UTC

    def __init__(self):
        self._last_run_date: date | None = None

    def should_run(self, now: datetime | None = None) -> bool:
        if now is None:
            now = datetime.now(timezone.utc)
        if now.hour < self.WINDOW_HOUR:
            return False
        today = now.date()
        return self._last_run_date != today

    def mark_ran(self, now: datetime | None = None) -> None:
        if now is None:
            now = datetime.now(timezone.utc)
        self._last_run_date = now.date()
