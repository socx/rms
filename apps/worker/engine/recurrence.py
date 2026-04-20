"""
Recurrence calculation for the dispatch engine.
Mirrors the logic in apps/api/src/services/recurrenceCalculator.js.

All day/week/month arithmetic is performed on the *naive* local wall-clock
time and then re-localized via pytz so that DST transitions do not shift the
time-of-day (matching Luxon's behaviour in the JS counterpart).
"""
from datetime import datetime, timezone, timedelta
from dateutil.relativedelta import relativedelta
import pytz


def next_occurrence(current: datetime, recurrence: str, timezone_str: str) -> datetime | None:
    """
    Compute the next occurrence after `current`.
    `timezone_str` is an IANA timezone string used for wall-clock arithmetic.
    Returns a UTC-aware datetime, or None if recurrence == 'never'.
    """
    if recurrence == 'never':
        return None

    tz = pytz.timezone(timezone_str or 'UTC')
    local_dt = current.astimezone(tz)
    naive = local_dt.replace(tzinfo=None)  # wall-clock time, no offset

    if recurrence == 'hourly':
        return current + timedelta(hours=1)
    elif recurrence == 'daily':
        return _localize_safe(tz, naive + timedelta(days=1)).astimezone(timezone.utc)
    elif recurrence == 'weekly':
        return _localize_safe(tz, naive + timedelta(weeks=1)).astimezone(timezone.utc)
    elif recurrence == 'fortnightly':
        return _localize_safe(tz, naive + timedelta(weeks=2)).astimezone(timezone.utc)
    elif recurrence == 'monthly':
        return _add_months_safe(naive, 1, tz)
    elif recurrence == 'every_3_months':
        return _add_months_safe(naive, 3, tz)
    elif recurrence == 'every_6_months':
        return _add_months_safe(naive, 6, tz)
    elif recurrence == 'yearly':
        return _add_months_safe(naive, 12, tz)
    elif recurrence == 'weekdays':
        next_naive = naive + timedelta(days=1)
        while next_naive.weekday() >= 5:  # 5=Sat, 6=Sun
            next_naive += timedelta(days=1)
        return _localize_safe(tz, next_naive).astimezone(timezone.utc)
    elif recurrence == 'weekends':
        next_naive = naive + timedelta(days=1)
        while next_naive.weekday() < 5:
            next_naive += timedelta(days=1)
        return _localize_safe(tz, next_naive).astimezone(timezone.utc)
    return None


def _localize_safe(tz, naive_dt: datetime) -> datetime:
    """
    Localize a naive wall-clock datetime in *tz*, handling the two edge cases
    that arise during DST transitions:

    - NonExistentTimeError  (spring-forward gap): advance by 1 hour so the
      result lands in the valid post-transition period.
    - AmbiguousTimeError    (fall-back overlap):  choose the post-DST
      (standard-time) occurrence via is_dst=False.
    """
    try:
        return tz.localize(naive_dt, is_dst=None)
    except pytz.exceptions.NonExistentTimeError:
        return tz.localize(naive_dt + timedelta(hours=1), is_dst=None)
    except pytz.exceptions.AmbiguousTimeError:
        return tz.localize(naive_dt, is_dst=False)


def _add_months_safe(naive: datetime, months: int, tz) -> datetime:
    """
    Add months to a naive wall-clock datetime using relativedelta (handles
    month-end clamping: e.g. Jan 31 + 1 month → Feb 28/29), then re-localize
    with DST safety and convert to UTC.
    """
    result = naive + relativedelta(months=months)
    return _localize_safe(tz, result).astimezone(timezone.utc)
