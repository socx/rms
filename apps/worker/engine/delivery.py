"""
Delivery workers for email (SendGrid) and SMS (Twilio).
Extensible: add new channels by implementing a ChannelAdapter.
"""
import os
import logging
from abc import ABC, abstractmethod
from sqlalchemy import text

from .db import get_setting

logger = logging.getLogger(__name__)

DEFAULT_BACKOFF_MINUTES = [1, 5, 15]   # fallback if setting is absent / unparseable


def get_backoff_minutes(session) -> list[int]:
    """
    Read dispatch_retry_backoff_minutes from system_settings.
    Expected format: comma-separated integers, e.g. '1,5,15'.
    Returns a list of int minute offsets; falls back to DEFAULT_BACKOFF_MINUTES on any error.
    """
    raw = get_setting(session, 'dispatch_retry_backoff_minutes', '')
    if raw:
        try:
            parsed = [int(x.strip()) for x in raw.split(',') if x.strip()]
            if parsed:
                return parsed
        except ValueError:
            pass
    return list(DEFAULT_BACKOFF_MINUTES)


class ChannelAdapter(ABC):
    @abstractmethod
    def send(self, dispatch: dict) -> bool:
        """Send the message. Returns True on success, raises on failure."""


class EmailAdapter(ChannelAdapter):
    def send(self, dispatch: dict) -> bool:
        # dispatch to configured email backend
        use_sendgrid = os.environ.get('USE_SEND_GRID', '1')
        use_sendgrid_val = use_sendgrid.lower() in ('1', 'true', 'yes')
        logger.debug('EmailAdapter: USE_SEND_GRID=%s', use_sendgrid)
        if use_sendgrid_val:
            logger.info('EmailAdapter: using SendGrid for delivery')
            return _sendgrid_send(dispatch)
        else:
            logger.info('EmailAdapter: using SMTP for delivery')
            return _smtp_send(dispatch)


def _sendgrid_send(dispatch: dict) -> bool:
    import sendgrid
    from sendgrid.helpers.mail import Mail
    sg = sendgrid.SendGridAPIClient(api_key=os.environ['SENDGRID_API_KEY'])
    message = Mail(
        from_email=(os.environ.get('SENDGRID_FROM_EMAIL'), os.environ.get('SENDGRID_FROM_NAME', 'RMS')),
        to_emails=dispatch['contact_value'],
        subject=dispatch.get('rendered_subject') or 'Reminder',
        html_content=dispatch.get('rendered_body'),
    )
    response = sg.send(message)
    if getattr(response, 'status_code', 200) >= 400:
        raise Exception(f'SendGrid error {getattr(response, "status_code", "?final") }')
    return True


def _smtp_send(dispatch: dict) -> bool:
    import smtplib
    from email.message import EmailMessage

    host = os.environ.get('SMTP_HOST')
    port = int(os.environ.get('SMTP_PORT', '587'))
    user = os.environ.get('SMTP_USER')
    password = os.environ.get('SMTP_PASSWORD')
    use_tls = os.environ.get('SMTP_USE_TLS', '1').lower() in ('1', 'true', 'yes')

    if not host or not port:
        raise Exception('SMTP_HOST and SMTP_PORT must be set for SMTP delivery')

    msg = EmailMessage()
    from_addr = os.environ.get('SMTP_FROM_EMAIL') or os.environ.get('SENDGRID_FROM_EMAIL')
    from_name = os.environ.get('SMTP_FROM_NAME') or os.environ.get('SENDGRID_FROM_NAME', 'RMS')
    if from_addr:
        msg['From'] = f"{from_name} <{from_addr}>"
    msg['To'] = dispatch['contact_value']
    msg['Subject'] = dispatch.get('rendered_subject') or 'Reminder'
    html = dispatch.get('rendered_body') or ''
    msg.set_content('This message requires an HTML-capable client')
    msg.add_alternative(html, subtype='html')

    # If port is 465 commonly expect implicit SSL (SMTPS)
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        server = smtplib.SMTP(host, port, timeout=30)
        if use_tls:
            server.starttls()

    try:
        if user and password:
            server.login(user, password)
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass
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


def deliver_dispatch(session, dispatch_id: str, backoff_minutes: list[int] | None = None):
    if backoff_minutes is None:
        backoff_minutes = get_backoff_minutes(session)
    retry_max = len(backoff_minutes)

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
            SET status = 'sent', attempts = :a, sent_at = NOW(), last_attempted_at = NOW(),
                retry_after = NULL
            WHERE id = :id
        """), {'a': attempts, 'id': dispatch_id})
        session.commit()
        logger.info('Dispatch %s sent via %s', dispatch_id, dispatch['channel'])
    except Exception as e:
        failure_reason = str(e)[:500]
        if attempts >= retry_max:
            session.execute(text("""
                UPDATE reminder_dispatches
                SET status = 'failed', attempts = :a, failure_reason = :r,
                    last_attempted_at = NOW(), retry_after = NULL
                WHERE id = :id
            """), {'a': attempts, 'r': failure_reason, 'id': dispatch_id})
            session.commit()
            logger.warning('Dispatch %s permanently failed after %d attempts: %s',
                           dispatch_id, attempts, failure_reason)
        else:
            delay = backoff_minutes[attempts - 1]   # e.g. attempt=1 → backoff_minutes[0]
            session.execute(text("""
                UPDATE reminder_dispatches
                SET attempts = :a, failure_reason = :r, last_attempted_at = NOW(),
                    retry_after = NOW() + INTERVAL '1 minute' * :delay
                WHERE id = :id
            """), {'a': attempts, 'r': failure_reason, 'delay': delay, 'id': dispatch_id})
            session.commit()
            logger.warning('Dispatch %s failed (attempt %d/%d), retry in %dm: %s',
                           dispatch_id, attempts, retry_max, delay, failure_reason)


def retry_pending_dispatches(session):
    """
    Re-attempt all pending dispatches whose retry_after has elapsed.
    Called every poll cycle so retries are honoured as soon as the window passes.
    """
    backoff_minutes = get_backoff_minutes(session)

    rows = session.execute(text("""
        SELECT rd.id
        FROM reminder_dispatches rd
        WHERE rd.status = 'pending'
          AND rd.attempts > 0
          AND rd.retry_after IS NOT NULL
          AND rd.retry_after <= NOW()
        FOR UPDATE SKIP LOCKED
    """)).fetchall()

    if not rows:
        return

    ids = [str(r[0]) for r in rows]
    logger.info('retry_pending_dispatches: %d dispatch(es) ready for retry', len(ids))

    for did in ids:
        try:
            deliver_dispatch(session, did, backoff_minutes=backoff_minutes)
        except Exception:
            logger.exception('Error retrying dispatch %s', did)
