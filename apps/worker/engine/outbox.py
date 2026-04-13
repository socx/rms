"""
Process the email_outbox table: send pending emails and update status.
"""
import logging
from datetime import datetime, timezone
from sqlalchemy import text
from . import delivery

logger = logging.getLogger(__name__)


def process_outbox(session, batch_size: int = 20):
    """Send pending outbox emails in small batches using SELECT FOR UPDATE SKIP LOCKED."""
    rows = session.execute(text("""
        SELECT id, user_id, to_address, subject, body_html, attempts
        FROM email_outbox
        WHERE status = 'pending'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT :limit
    """), {'limit': batch_size}).mappings().fetchall()

    if not rows:
        logger.debug('No pending outbox emails')
        return

    logger.info('Found %d outbox email(s) to process', len(rows))

    adapter = delivery.EmailAdapter()

    for row in rows:
        outbox_id = str(row['id'])
        attempts = (row['attempts'] or 0) + 1
        try:
            dispatch = {
                'contact_value': row['to_address'],
                'rendered_subject': row['subject'],
                'rendered_body': row['body_html'],
            }
            adapter.send(dispatch)
            session.execute(text("""
                UPDATE email_outbox
                SET status = 'sent', attempts = :a, sent_at = NOW(), last_attempt_at = NOW()
                WHERE id = :id
            """), {'a': attempts, 'id': outbox_id})
            session.commit()
            logger.info('Outbox email %s sent', outbox_id)
        except Exception as e:
            logger.exception('Failed to send outbox email %s: %s', outbox_id, e)
            if attempts >= delivery.RETRY_MAX:
                session.execute(text("""
                    UPDATE email_outbox
                    SET status = 'failed', attempts = :a, last_attempt_at = NOW()
                    WHERE id = :id
                """), {'a': attempts, 'id': outbox_id})
            else:
                session.execute(text("""
                    UPDATE email_outbox
                    SET attempts = :a, last_attempt_at = NOW()
                    WHERE id = :id
                """), {'a': attempts, 'id': outbox_id})
            session.commit()
