"""
Query for due reminders and initiate fan-out.
Uses SELECT FOR UPDATE SKIP LOCKED to support future multi-instance deployment.
"""
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from .fanout import fan_out_reminder
from .db import get_setting

logger = logging.getLogger(__name__)

def poll_and_dispatch(session, lookahead_seconds: int = 65):
    """
    Find all reminders due within the lookahead window.
    Covers both first-fire (status='scheduled') and recurring (status='recurring').
    Locks rows immediately to prevent double-dispatch.
    """
    now = datetime.now(timezone.utc)
    window = now + timedelta(seconds=lookahead_seconds)

    # Combined query for scheduled (first-fire) and recurring reminders
    # SKIP LOCKED ensures safe concurrent execution if multiple workers are running
    rows = session.execute(text("""
        SELECT r.id
        FROM reminders r
        JOIN events e ON e.id = r.event_id
        WHERE e.status = 'active'
          AND (
            (r.status = 'scheduled'  AND r.remind_at      <= :window)
            OR
            (r.status = 'recurring'  AND r.next_remind_at <= :window)
          )
        FOR UPDATE OF r SKIP LOCKED
    """), {'window': window}).fetchall()

    if not rows:
        logger.debug('No due reminders found in this cycle')
        return

    reminder_ids = [str(row[0]) for row in rows]
    logger.info('Found %d due reminder(s)', len(reminder_ids))

    # Mark as processing immediately within the same transaction
    session.execute(text("""
        UPDATE reminders SET status = 'processing', updated_at = NOW()
        WHERE id = ANY(:ids::uuid[])
    """), {'ids': reminder_ids})
    session.commit()

    # Fan out each reminder
    for rid in reminder_ids:
        try:
            fan_out_reminder(session, rid)
        except Exception as e:
            logger.exception('Failed to fan out reminder %s: %s', rid, e)
