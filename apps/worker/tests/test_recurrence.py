"""
Tests for engine/recurrence.py — covering DST-safe wall-clock arithmetic.

2026 US/Eastern DST transitions:
  Spring-forward: 2026-03-08 02:00 EST -> 03:00 EDT  (UTC-5 -> UTC-4)
  Fall-back:      2026-11-01 02:00 EDT -> 01:00 EST   (UTC-4 -> UTC-5)
"""
import pytest
from datetime import datetime, timezone, timedelta
from engine.recurrence import next_occurrence


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def utc(year, month, day, hour=0, minute=0, second=0):
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Hourly – pure UTC offset, no DST concern
# ---------------------------------------------------------------------------

class TestHourly:
    def test_advances_one_hour(self):
        start = utc(2026, 1, 15, 10, 30)
        result = next_occurrence(start, 'hourly', 'America/New_York')
        assert result == utc(2026, 1, 15, 11, 30)

    def test_returns_none_for_never(self):
        assert next_occurrence(utc(2026, 1, 1), 'never', 'UTC') is None


# ---------------------------------------------------------------------------
# Daily
# ---------------------------------------------------------------------------

class TestDaily:
    def test_normal_day_advance(self):
        # 10:00 EST = 15:00 UTC; next day same wall-clock = 15:00 UTC
        start = utc(2026, 1, 20, 15)
        result = next_occurrence(start, 'daily', 'America/New_York')
        assert result == utc(2026, 1, 21, 15)

    def test_spring_forward_preserves_wall_clock(self):
        # 2026-03-07 10:00 AM EST = 15:00 UTC
        # Next day is 2026-03-08: spring-forward happens at 02:00, so EDT is UTC-4
        # 10:00 AM EDT = 14:00 UTC
        start = utc(2026, 3, 7, 15)
        result = next_occurrence(start, 'daily', 'America/New_York')
        assert result == utc(2026, 3, 8, 14)

    def test_fall_back_preserves_wall_clock(self):
        # 2026-10-31 10:00 AM EDT = 14:00 UTC
        # Next day 2026-11-01: fall-back happens, EST is UTC-5
        # 10:00 AM EST = 15:00 UTC
        start = utc(2026, 10, 31, 14)
        result = next_occurrence(start, 'daily', 'America/New_York')
        assert result == utc(2026, 11, 1, 15)


# ---------------------------------------------------------------------------
# Weekly – the primary focus of the DST fix
# ---------------------------------------------------------------------------

class TestWeekly:
    def test_normal_weekly(self):
        # 2026-01-06 10:00 EST = 15:00 UTC -> 2026-01-13 10:00 EST = 15:00 UTC
        start = utc(2026, 1, 6, 15)
        result = next_occurrence(start, 'weekly', 'America/New_York')
        assert result == utc(2026, 1, 13, 15)

    def test_spring_forward_preserves_wall_clock(self):
        # 2026-03-06 10:00 AM EST = 15:00 UTC (before spring-forward on Mar 8)
        # One week later: 2026-03-13 10:00 AM EDT = 14:00 UTC
        # Wrong (old) result would be 15:00 UTC = 11:00 AM EDT
        start = utc(2026, 3, 6, 15)
        result = next_occurrence(start, 'weekly', 'America/New_York')
        assert result == utc(2026, 3, 13, 14), (
            f"Expected 14:00 UTC (10:00 AM EDT), got {result}"
        )

    def test_fall_back_preserves_wall_clock(self):
        # 2026-10-30 10:00 AM EDT = 14:00 UTC (before fall-back on Nov 1)
        # One week later: 2026-11-06 10:00 AM EST = 15:00 UTC
        # Wrong (old) result would be 14:00 UTC = 09:00 AM EST
        start = utc(2026, 10, 30, 14)
        result = next_occurrence(start, 'weekly', 'America/New_York')
        assert result == utc(2026, 11, 6, 15), (
            f"Expected 15:00 UTC (10:00 AM EST), got {result}"
        )

    def test_utc_timezone_unchanged(self):
        # When timezone is UTC there are no DST transitions; result is exact +7d
        start = utc(2026, 3, 6, 15)
        result = next_occurrence(start, 'weekly', 'UTC')
        assert result == utc(2026, 3, 13, 15)

    def test_different_iana_zone(self):
        # Europe/London spring-forward 2026-03-29 01:00 UTC  (GMT -> BST = UTC+1)
        # 2026-03-27 09:00 GMT = 09:00 UTC; one week -> 2026-04-03 09:00 BST = 08:00 UTC
        start = utc(2026, 3, 27, 9)
        result = next_occurrence(start, 'weekly', 'Europe/London')
        assert result == utc(2026, 4, 3, 8)


# ---------------------------------------------------------------------------
# Fortnightly
# ---------------------------------------------------------------------------

class TestFortnightly:
    def test_normal_fortnightly(self):
        start = utc(2026, 1, 6, 15)
        result = next_occurrence(start, 'fortnightly', 'America/New_York')
        assert result == utc(2026, 1, 20, 15)

    def test_spring_forward_preserves_wall_clock(self):
        # 2026-02-28 10:00 AM EST = 15:00 UTC; +14 days = 2026-03-14 10:00 AM EDT = 14:00 UTC
        start = utc(2026, 2, 28, 15)
        result = next_occurrence(start, 'fortnightly', 'America/New_York')
        assert result == utc(2026, 3, 14, 14)


# ---------------------------------------------------------------------------
# Monthly (existing logic, now using _localize_safe)
# ---------------------------------------------------------------------------

class TestMonthly:
    def test_normal_month(self):
        # 2026-01-15 10:00 EST = 15:00 UTC -> 2026-02-15 10:00 EST = 15:00 UTC
        start = utc(2026, 1, 15, 15)
        result = next_occurrence(start, 'monthly', 'America/New_York')
        assert result == utc(2026, 2, 15, 15)

    def test_month_end_clamp(self):
        # Jan 31 + 1 month = Feb 28 (2026 is not a leap year)
        start = utc(2026, 1, 31, 15)
        result = next_occurrence(start, 'monthly', 'America/New_York')
        assert result == utc(2026, 2, 28, 15)

    def test_spring_forward_preserves_wall_clock(self):
        # 2026-02-15 10:00 AM EST = 15:00 UTC; +1 month = 2026-03-15 10:00 AM EDT = 14:00 UTC
        start = utc(2026, 2, 15, 15)
        result = next_occurrence(start, 'monthly', 'America/New_York')
        assert result == utc(2026, 3, 15, 14)

    def test_fall_back_preserves_wall_clock(self):
        # 2026-10-15 10:00 AM EDT = 14:00 UTC; +1 month = 2026-11-15 10:00 AM EST = 15:00 UTC
        start = utc(2026, 10, 15, 14)
        result = next_occurrence(start, 'monthly', 'America/New_York')
        assert result == utc(2026, 11, 15, 15)


# ---------------------------------------------------------------------------
# Weekdays / Weekends
# ---------------------------------------------------------------------------

class TestWeekdays:
    def test_friday_advances_to_monday(self):
        # 2026-01-09 (Friday) 10:00 EST = 15:00 UTC -> 2026-01-12 (Monday) 10:00 EST = 15:00 UTC
        start = utc(2026, 1, 9, 15)
        result = next_occurrence(start, 'weekdays', 'America/New_York')
        assert result == utc(2026, 1, 12, 15)

    def test_monday_advances_to_tuesday(self):
        start = utc(2026, 1, 12, 15)
        result = next_occurrence(start, 'weekdays', 'America/New_York')
        assert result == utc(2026, 1, 13, 15)

    def test_spring_forward_preserves_wall_clock(self):
        # 2026-03-06 (Friday) 10:00 AM EST = 15:00 UTC
        # Next weekday: 2026-03-09 (Monday) — after spring-forward — 10:00 AM EDT = 14:00 UTC
        start = utc(2026, 3, 6, 15)
        result = next_occurrence(start, 'weekdays', 'America/New_York')
        assert result == utc(2026, 3, 9, 14)


class TestWeekends:
    def test_friday_advances_to_saturday(self):
        # 2026-01-09 (Friday) 10:00 EST -> 2026-01-10 (Saturday) 10:00 EST
        start = utc(2026, 1, 9, 15)
        result = next_occurrence(start, 'weekends', 'America/New_York')
        assert result == utc(2026, 1, 10, 15)

    def test_saturday_advances_to_sunday(self):
        start = utc(2026, 1, 10, 15)
        result = next_occurrence(start, 'weekends', 'America/New_York')
        assert result == utc(2026, 1, 11, 15)

    def test_sunday_advances_to_next_saturday(self):
        # 2026-01-11 (Sunday) -> 2026-01-17 (Saturday)
        start = utc(2026, 1, 11, 15)
        result = next_occurrence(start, 'weekends', 'America/New_York')
        assert result == utc(2026, 1, 17, 15)


# ---------------------------------------------------------------------------
# Longer intervals and edge cases
# ---------------------------------------------------------------------------

class TestLongerIntervals:
    def test_every_3_months(self):
        start = utc(2026, 1, 15, 15)
        result = next_occurrence(start, 'every_3_months', 'America/New_York')
        assert result == utc(2026, 4, 15, 14)  # EDT in April

    def test_every_6_months(self):
        start = utc(2026, 1, 15, 15)
        result = next_occurrence(start, 'every_6_months', 'America/New_York')
        assert result == utc(2026, 7, 15, 14)  # EDT in July

    def test_yearly(self):
        start = utc(2026, 1, 15, 15)
        result = next_occurrence(start, 'yearly', 'America/New_York')
        assert result == utc(2027, 1, 15, 15)  # still EST in January

    def test_unknown_recurrence_returns_none(self):
        assert next_occurrence(utc(2026, 1, 1), 'minutely', 'UTC') is None
