"""
Recurrence calculation for the dispatch engine.
Mirrors the logic in apps/api/src/services/recurrenceCalculator.js.
"""
from datetime import datetime, timezone, timedelta
from dateutil.relativedelta import relativedelta
import pytz


def next_occurrence(current: datetime, recurrence: str, timezone_str: str) -> datetime | None:
    """
    Compute the next occurrence after `current`.
    `timezone_str` is an IANA timezone string used for weekday/weekend calculations.
    Returns a UTC-aware datetime, or None if recurrence == 'never'.
    """
    if recurrence == 'never':
        return None

    tz = pytz.timezone(timezone_str or 'UTC')
    local_dt = current.astimezone(tz)

    if recurrence == 'hourly':
        return current + timedelta(hours=1)
    elif recurrence == 'daily':
        return current + timedelta(days=1)
    elif recurrence == 'weekly':
        return current + timedelta(weeks=1)
    elif recurrence == 'fortnightly':
        return current + timedelta(weeks=2)
    elif recurrence == 'monthly':
        return _add_months_safe(local_dt, 1, tz)
    elif recurrence == 'every_3_months':
        return _add_months_safe(local_dt, 3, tz)
    elif recurrence == 'every_6_months':
        return _add_months_safe(local_dt, 6, tz)
    elif recurrence == 'yearly':
        return _add_months_safe(local_dt, 12, tz)
    elif recurrence == 'weekdays':
        next_dt = local_dt + timedelta(days=1)
        while next_dt.weekday() >= 5:  # 5=Sat, 6=Sun
            next_dt += timedelta(days=1)
        return next_dt.astimezone(timezone.utc)
    elif recurrence == 'weekends':
        next_dt = local_dt + timedelta(days=1)
        while next_dt.weekday() < 5:
            next_dt += timedelta(days=1)
        return next_dt.astimezone(timezone.utc)
    return None


def _add_months_safe(local_dt, months: int, tz) -> datetime:
    """
    Add months using relativedelta (handles month-end clamping automatically:
    e.g. Jan 31 + 1 month = Feb 28/29).
    Returns UTC-aware datetime.
    """
    result = local_dt + relativedelta(months=months)
    return result.astimezone(timezone.utc)
