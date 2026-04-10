"""
Fan-out: for each due reminder, create dispatch records for all active subscribers.
Then trigger delivery and compute the next occurrence for recurring reminders.
"""
import logging
from datetime import datetime, timezone
from sqlalchemy import text
from .recurrence import next_occurrence
from .delivery import deliver_dispatch
from .reports import maybe_generate_report

logger = logging.getLogger(__name__)

def fan_out_reminder(session, reminder_id: str):
    """
    1. Load reminder + event + owner
    2. Increment occurrence_count
    3. For each active subscriber x channel: render templates, create dispatch record
    4. Trigger delivery for each dispatch
    5. Compute next occurrence and update reminder status
    """
    # Load reminder
    reminder = session.execute(
        text('SELECT * FROM reminders WHERE id = :id'), {'id': reminder_id}
    ).mappings().fetchone()
    if not reminder:
        logger.warning('Reminder %s not found', reminder_id)
        return

    # Load event + owner
    event = session.execute(
        text('SELECT * FROM events WHERE id = :id'), {'id': reminder['event_id']}
    ).mappings().fetchone()
    owner = session.execute(
        text('SELECT * FROM users WHERE id = :id'), {'id': event['owner_id']}
    ).mappings().fetchone()

    # Increment occurrence count
    new_count = (reminder['occurrence_count'] or 0) + 1
    current_fire_time = reminder['next_remind_at'] or reminder['remind_at']

    session.execute(text("""
        UPDATE reminders
        SET occurrence_count = :count, last_dispatched_at = NOW(), updated_at = NOW()
        WHERE id = :id
    """), {'count': new_count, 'id': reminder_id})

    # Load active subscribers for this event
    subscribers = session.execute(text("""
        SELECT s.*, array_agg(json_build_object(
            'id', sc.id, 'channel', sc.channel, 'contact_value', sc.contact_value, 'is_primary', sc.is_primary
        )) AS contacts
        FROM subscribers s
        JOIN subscriber_contacts sc ON sc.subscriber_id = s.id AND sc.status = 'active' AND sc.is_primary = true
        WHERE s.event_id = :eid AND s.status = 'active'
        GROUP BY s.id
    """), {'eid': str(event['id'])}).mappings().fetchall()

    dispatch_ids = []

    for subscriber in subscribers:
        for channel in reminder['channels']:
            # Find primary contact for this channel
            contact = next((c for c in subscriber['contacts'] if c['channel'] == channel), None)
            if not contact:
                # No contact for channel — create skipped dispatch
                dispatch_id = _create_dispatch(session, reminder, subscriber, None, channel,
                                               new_count, None, None, 'skipped', 'NO_PRIMARY_CONTACT')
                dispatch_ids.append(dispatch_id)
                continue

            # Render templates
            from .renderer import render_for_subscriber
            rendered_subject, rendered_body = render_for_subscriber(
                subscriber, owner, event, reminder, current_fire_time, new_count
            )

            dispatch_id = _create_dispatch(session, reminder, subscriber, contact, channel,
                                           new_count, rendered_subject, rendered_body, 'pending', None)
            dispatch_ids.append(dispatch_id)

    session.commit()

    # Deliver all pending dispatches
    for did in dispatch_ids:
        deliver_dispatch(session, did)

    # Compute next occurrence and update reminder status
    _schedule_next_or_complete(session, reminder, event, current_fire_time, new_count)
    session.commit()

    # Check if all dispatches resolved and generate report
    maybe_generate_report(session, reminder_id, new_count)


def _create_dispatch(session, reminder, subscriber, contact, channel,
                     occurrence_number, rendered_subject, rendered_body, status, failure_reason):
    result = session.execute(text("""
        INSERT INTO reminder_dispatches
          (reminder_id, subscriber_id, subscriber_contact_id, channel, occurrence_number,
           rendered_subject, rendered_body, status, failure_reason)
        VALUES (:rid, :sid, :cid, :ch, :occ, :subj, :body, :status::dispatch_status, :reason)
        RETURNING id
    """), {
        'rid': str(reminder['id']), 'sid': str(subscriber['id']),
        'cid': str(contact['id']) if contact else None,
        'ch': channel, 'occ': occurrence_number,
        'subj': rendered_subject, 'body': rendered_body or '',
        'status': status, 'reason': failure_reason,
    })
    return str(result.fetchone()[0])


def _schedule_next_or_complete(session, reminder, event, current_fire_time, occurrence_count):
    recurrence = reminder['recurrence']
    if recurrence == 'never':
        session.execute(text("""
            UPDATE reminders SET status = 'sent', next_remind_at = NULL, updated_at = NOW()
            WHERE id = :id
        """), {'id': str(reminder['id'])})
        return

    candidate = next_occurrence(current_fire_time, recurrence, event['event_timezone'])
    if candidate is None or candidate >= event['event_datetime']:
        # Recurrence complete
        session.execute(text("""
            UPDATE reminders SET status = 'sent', next_remind_at = NULL, updated_at = NOW()
            WHERE id = :id
        """), {'id': str(reminder['id'])})
        logger.info('Reminder %s recurrence complete after %d occurrence(s)', reminder['id'], occurrence_count)
    else:
        session.execute(text("""
            UPDATE reminders SET status = 'recurring', next_remind_at = :nxt, updated_at = NOW()
            WHERE id = :id
        """), {'id': str(reminder['id']), 'nxt': candidate})
        logger.info('Reminder %s next occurrence: %s', reminder['id'], candidate)
