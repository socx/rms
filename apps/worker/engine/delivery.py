"""
Delivery workers for email (SendGrid) and SMS (Twilio).
Extensible: add new channels by implementing a ChannelAdapter.
"""
import os
import logging
from abc import ABC, abstractmethod
from sqlalchemy import text

logger = logging.getLogger(__name__)

RETRY_MAX = 3


class ChannelAdapter(ABC):
    @abstractmethod
    def send(self, dispatch: dict) -> bool:
        """Send the message. Returns True on success, raises on failure."""


class EmailAdapter(ChannelAdapter):
    def send(self, dispatch: dict) -> bool:
        import sendgrid
        from sendgrid.helpers.mail import Mail
        sg = sendgrid.SendGridAPIClient(api_key=os.environ['SENDGRID_API_KEY'])
        message = Mail(
            from_email=(os.environ['SENDGRID_FROM_EMAIL'], os.environ.get('SENDGRID_FROM_NAME', 'RMS')),
            to_emails=dispatch['contact_value'],
            subject=dispatch['rendered_subject'] or 'Reminder',
            html_content=dispatch['rendered_body'],
        )
        response = sg.send(message)
        if response.status_code >= 400:
            raise Exception(f'SendGrid error {response.status_code}')
        return True


class SmsAdapter(ChannelAdapter):
    def send(self, dispatch: dict) -> bool:
        from twilio.rest import Client
        client = Client(os.environ['TWILIO_ACCOUNT_SID'], os.environ['TWILIO_AUTH_TOKEN'])
        import re
        plain = re.sub('<[^>]+>', '', dispatch['rendered_body'])
        client.messages.create(
            body=plain,
            from_=os.environ['TWILIO_FROM_NUMBER'],
            to=dispatch['contact_value'],
        )
        return True


ADAPTERS = {'email': EmailAdapter(), 'sms': SmsAdapter()}


def deliver_dispatch(session, dispatch_id: str):
    dispatch = session.execute(
        text("""
            SELECT rd.*, sc.contact_value
            FROM reminder_dispatches rd
            JOIN subscriber_contacts sc ON sc.id = rd.subscriber_contact_id
            WHERE rd.id = :id
        """), {'id': dispatch_id}
    ).mappings().fetchone()

    if not dispatch or dispatch['status'] in ('sent', 'skipped'):
        return

    adapter = ADAPTERS.get(dispatch['channel'])
    if not adapter:
        logger.error('No adapter for channel: %s', dispatch['channel'])
        return

    attempts = (dispatch['attempts'] or 0) + 1
    try:
        adapter.send(dict(dispatch))
        session.execute(text("""
            UPDATE reminder_dispatches
            SET status = 'sent', attempts = :a, sent_at = NOW(), last_attempted_at = NOW()
            WHERE id = :id
        """), {'a': attempts, 'id': dispatch_id})
        session.commit()
        logger.info('Dispatch %s sent via %s', dispatch_id, dispatch['channel'])
    except Exception as e:
        failure_reason = str(e)[:500]
        if attempts >= RETRY_MAX:
            session.execute(text("""
                UPDATE reminder_dispatches
                SET status = 'failed', attempts = :a, failure_reason = :r, last_attempted_at = NOW()
                WHERE id = :id
            """), {'a': attempts, 'r': failure_reason, 'id': dispatch_id})
            session.commit()
            logger.warning('Dispatch %s permanently failed after %d attempts: %s', dispatch_id, attempts, failure_reason)
        else:
            session.execute(text("""
                UPDATE reminder_dispatches
                SET attempts = :a, last_attempted_at = NOW()
                WHERE id = :id
            """), {'a': attempts, 'id': dispatch_id})
            session.commit()
            logger.warning('Dispatch %s failed (attempt %d/%d): %s', dispatch_id, attempts, RETRY_MAX, failure_reason)
