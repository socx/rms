"""
Unit tests for engine.maintenance — nightly archive and key-expiry jobs.

All DB calls are intercepted via a lightweight in-memory mock session so
these tests run without a real Postgres connection.
"""
import os
import sys
from datetime import datetime, timezone, date, timedelta
from unittest.mock import MagicMock, call, patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session(setting_value='90'):
    """Return a mock SQLAlchemy session with a configurable get_setting stub."""
    session = MagicMock()
    # Simulate execute(...).rowcount for UPDATE statements
    execute_result = MagicMock()
    execute_result.rowcount = 0
    session.execute.return_value = execute_result
    return session, execute_result


# ---------------------------------------------------------------------------
# archive_stale_events
# ---------------------------------------------------------------------------

class TestArchiveStaleEvents:
    def test_archives_when_rows_updated(self, monkeypatch):
        session, result = _make_session()
        result.rowcount = 3

        monkeypatch.setattr('engine.maintenance.get_setting', lambda s, k, d=None: '90')

        from engine.maintenance import archive_stale_events
        count = archive_stale_events(session)

        assert count == 3
        session.execute.assert_called_once()
        session.commit.assert_called_once()

        # Verify the SQL contains the expected table and status filter
        sql_arg = str(session.execute.call_args[0][0])
        assert 'events' in sql_arg
        assert 'archived' in sql_arg

    def test_returns_zero_when_no_stale_events(self, monkeypatch):
        session, result = _make_session()
        result.rowcount = 0

        monkeypatch.setattr('engine.maintenance.get_setting', lambda s, k, d=None: '30')

        from engine.maintenance import archive_stale_events
        count = archive_stale_events(session)

        assert count == 0
        session.commit.assert_called_once()

    def test_uses_archive_days_from_setting(self, monkeypatch):
        """The SQL bind param :days must reflect the setting value."""
        session, result = _make_session()
        result.rowcount = 0
        captured_params = {}

        def fake_execute(stmt, params=None):
            if params:
                captured_params.update(params)
            r = MagicMock()
            r.rowcount = 0
            return r

        session.execute.side_effect = fake_execute
        monkeypatch.setattr('engine.maintenance.get_setting', lambda s, k, d=None: '45')

        from engine.maintenance import archive_stale_events
        archive_stale_events(session)

        assert captured_params.get('days') == 45


# ---------------------------------------------------------------------------
# expire_api_keys
# ---------------------------------------------------------------------------

class TestExpireApiKeys:
    def test_revokes_expired_keys(self, monkeypatch):
        session, result = _make_session()
        result.rowcount = 2

        from engine.maintenance import expire_api_keys
        count = expire_api_keys(session)

        assert count == 2
        session.execute.assert_called_once()
        session.commit.assert_called_once()

        sql_arg = str(session.execute.call_args[0][0])
        assert 'api_keys' in sql_arg
        assert 'revoked' in sql_arg

    def test_returns_zero_when_no_expired_keys(self, monkeypatch):
        session, result = _make_session()
        result.rowcount = 0

        from engine.maintenance import expire_api_keys
        count = expire_api_keys(session)

        assert count == 0
        session.commit.assert_called_once()


# ---------------------------------------------------------------------------
# run_nightly_jobs
# ---------------------------------------------------------------------------

class TestRunNightlyJobs:
    def test_calls_both_jobs_and_returns_counts(self, monkeypatch):
        session = MagicMock()

        monkeypatch.setattr('engine.maintenance.archive_stale_events', lambda s: 5)
        monkeypatch.setattr('engine.maintenance.expire_api_keys', lambda s: 3)

        from engine.maintenance import run_nightly_jobs
        result = run_nightly_jobs(session)

        assert result == {'archived_events': 5, 'revoked_keys': 3}

    def test_accepts_explicit_now_for_logging(self, monkeypatch):
        session = MagicMock()
        monkeypatch.setattr('engine.maintenance.archive_stale_events', lambda s: 0)
        monkeypatch.setattr('engine.maintenance.expire_api_keys', lambda s: 0)

        from engine.maintenance import run_nightly_jobs
        now = datetime(2026, 4, 20, 2, 5, 0, tzinfo=timezone.utc)
        result = run_nightly_jobs(session, now=now)

        assert result == {'archived_events': 0, 'revoked_keys': 0}


# ---------------------------------------------------------------------------
# NightlySchedule
# ---------------------------------------------------------------------------

class TestNightlySchedule:
    def _dt(self, hour, minute=0, day=20):
        return datetime(2026, 4, day, hour, minute, 0, tzinfo=timezone.utc)

    def test_does_not_run_before_window(self):
        from engine.maintenance import NightlySchedule
        sched = NightlySchedule()
        assert sched.should_run(self._dt(1, 59)) is False
        assert sched.should_run(self._dt(0, 0)) is False

    def test_runs_at_window_hour(self):
        from engine.maintenance import NightlySchedule
        sched = NightlySchedule()
        assert sched.should_run(self._dt(2, 0)) is True

    def test_runs_after_window_hour(self):
        from engine.maintenance import NightlySchedule
        sched = NightlySchedule()
        assert sched.should_run(self._dt(3, 30)) is True
        assert sched.should_run(self._dt(23, 59)) is True

    def test_does_not_rerun_same_day_after_mark(self):
        from engine.maintenance import NightlySchedule
        sched = NightlySchedule()
        now = self._dt(2, 5)
        assert sched.should_run(now) is True
        sched.mark_ran(now)
        # Same day, later time — must not re-run
        assert sched.should_run(self._dt(3, 0)) is False
        assert sched.should_run(self._dt(23, 59)) is False

    def test_reruns_next_calendar_day(self):
        from engine.maintenance import NightlySchedule
        sched = NightlySchedule()
        day1 = self._dt(2, 5, day=20)
        sched.mark_ran(day1)
        day2 = self._dt(2, 5, day=21)
        assert sched.should_run(day2) is True

    def test_does_not_run_again_on_day2_after_second_mark(self):
        from engine.maintenance import NightlySchedule
        sched = NightlySchedule()
        day1 = self._dt(2, 5, day=20)
        sched.mark_ran(day1)
        day2 = self._dt(2, 5, day=21)
        assert sched.should_run(day2) is True
        sched.mark_ran(day2)
        assert sched.should_run(self._dt(3, 0, day=21)) is False
