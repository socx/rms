"""
Generate per-occurrence reminder reports after all dispatches resolve.
Sends a summary email to the event owner.
"""
import logging
import json
import os
from sqlalchemy import text

logger = logging.getLogger(__name__)


def maybe_generate_report(session, reminder_id: str, occurrence_number: int):
    """Create a report record if all dispatches for this occurrence are resolved."""
    pending = session.execute(text("""
        SELECT COUNT(*) FROM reminder_dispatches
        WHERE reminder_id = :rid AND occurrence_number = :occ AND status = 'pending'
    """), {'rid': reminder_id, 'occ': occurrence_number}).scalar()

    if pending > 0:
        return  # Not all resolved yet

    counts = session.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
            COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
        FROM reminder_dispatches
        WHERE reminder_id = :rid AND occurrence_number = :occ
    """), {'rid': reminder_id, 'occ': occurrence_number}).mappings().fetchone()

    failures = session.execute(text("""
        SELECT s.firstname, s.lastname, rd.channel, sc.contact_value, rd.failure_reason
        FROM reminder_dispatches rd
        JOIN subscribers s ON s.id = rd.subscriber_id
        LEFT JOIN subscriber_contacts sc ON sc.id = rd.subscriber_contact_id
        WHERE rd.reminder_id = :rid AND rd.occurrence_number = :occ AND rd.status = 'failed'
    """), {'rid': reminder_id, 'occ': occurrence_number}).mappings().fetchall()

    failure_details = [
        {'subscriber': f"{r['firstname']} {r['lastname']}", 'channel': r['channel'],
         'contact': r['contact_value'], 'reason': r['failure_reason']}
        for r in failures
    ]

    session.execute(text("""
        INSERT INTO reminder_reports
          (reminder_id, occurrence_number, total_dispatches, total_sent, total_failed, total_skipped, failure_details)
        VALUES (:rid, :occ, :total, :sent, :failed, :skipped, :details::jsonb)
        ON CONFLICT (reminder_id, occurrence_number) DO NOTHING
    """), {
        'rid': reminder_id, 'occ': occurrence_number,
        'total': counts['total'], 'sent': counts['sent'],
        'failed': counts['failed'], 'skipped': counts['skipped'],
        'details': json.dumps(failure_details),
    })
    session.commit()

    _send_owner_report(session, reminder_id, occurrence_number, counts, failure_details)
    logger.info('Report generated for reminder %s occurrence %d', reminder_id, occurrence_number)


def _send_owner_report(session, reminder_id, occurrence_number, counts, failure_details):
    """Send an HTML summary email to the event owner."""
    reminder = session.execute(
        text('SELECT r.*, e.owner_id, e.subject FROM reminders r JOIN events e ON e.id = r.event_id WHERE r.id = :id'),
        {'id': reminder_id}
    ).mappings().fetchone()
    owner = session.execute(
        text('SELECT * FROM users WHERE id = :id'), {'id': reminder['owner_id']}
    ).mappings().fetchone()

    subject = f"Dispatch report: {reminder['subject']} (occurrence {occurrence_number})"
    body_lines = [
        f"<h2>Reminder Dispatch Report</h2>",
        f"<p>Event: <strong>{reminder['subject']}</strong></p>",
        f"<p>Occurrence: #{occurrence_number}</p>",
        f"<table><tr><th>Sent</th><th>Failed</th><th>Skipped</th><th>Total</th></tr>",
        f"<tr><td>{counts['sent']}</td><td>{counts['failed']}</td><td>{counts['skipped']}</td><td>{counts['total']}</td></tr></table>",
    ]
    if failure_details:
        body_lines.append("<h3>Failures</h3><ul>")
        for f in failure_details:
            body_lines.append(f"<li>{f['subscriber']} ({f['channel']}: {f['contact']}) — {f['reason']}</li>")
        body_lines.append("</ul>")

    try:
        import sendgrid
        from sendgrid.helpers.mail import Mail
        sg = sendgrid.SendGridAPIClient(api_key=os.environ['SENDGRID_API_KEY'])
        msg = Mail(
            from_email=os.environ['SENDGRID_FROM_EMAIL'],
            to_emails=owner['email'],
            subject=subject,
            html_content=''.join(body_lines),
        )
        sg.send(msg)
        session.execute(text("""
            UPDATE reminder_reports SET report_sent_to_owner = true, report_sent_at = NOW()
            WHERE reminder_id = :rid AND occurrence_number = :occ
        """), {'rid': reminder_id, 'occ': occurrence_number})
        session.commit()
    except Exception as e:
        logger.exception('Failed to send owner report: %s', e)
