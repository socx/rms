"""
Template rendering for the dispatch engine.
Mirrors the logic in apps/api/src/services/templateRenderer.js.
"""
import re
from datetime import datetime
import pytz


def render_for_subscriber(subscriber, owner, event, reminder, fire_time, occurrence_number):
    tz_str, fallback = _resolve_timezone(subscriber, owner)
    tz = pytz.timezone(tz_str)

    event_dt = _to_local(event['event_datetime'], tz)
    rem_dt   = _to_local(fire_time, tz)
    tz_label = _tz_label(tz_str, fallback)

    vars = {
        'subscriber_firstname':  subscriber['firstname'],
        'subscriber_lastname':   subscriber['lastname'],
        'subscriber_fullname':   f"{subscriber['firstname']} {subscriber['lastname']}",
        'event_subject':         event['subject'],
        'event_description':     event['description'] or '',
        'event_datetime':        _fmt_dt(event_dt),
        'event_date':            _fmt_date(event_dt),
        'event_time':            _fmt_time(event_dt),
        'event_location':        event['location'] or 'TBD',
        'event_timezone_label':  tz_label,
        'owner_firstname':       owner['firstname'],
        'owner_lastname':        owner['lastname'],
        'owner_fullname':        f"{owner['firstname']} {owner['lastname']}",
        'reminder_datetime':     _fmt_dt(rem_dt),
        'occurrence_number':     str(occurrence_number),
    }

    subject = _render(reminder['subject_template'], vars)
    body    = _render(reminder['body_template'], vars)
    return subject, body


def _render(template, vars):
    return re.sub(r'\{\{(\w+)\}\}', lambda m: vars.get(m.group(1), ''), template)


def _resolve_timezone(subscriber, owner):
    if subscriber.get('timezone'): return subscriber['timezone'], False
    if owner.get('timezone'):      return owner['timezone'], True
    return 'UTC', True


def _tz_label(tz_str, fallback):
    try:
        tz = pytz.timezone(tz_str)
        abbr = datetime.now(tz).strftime('%Z')
        label = f"{tz_str} ({abbr})"
        return f"{label} — using event owner's timezone" if fallback else label
    except Exception:
        return tz_str


def _to_local(dt, tz):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=pytz.utc)
    return dt.astimezone(tz)


def _fmt_dt(dt):   return dt.strftime('%d %b %Y, %H:%M %Z')
def _fmt_date(dt): return dt.strftime('%d %b %Y')
def _fmt_time(dt): return dt.strftime('%H:%M %Z')
