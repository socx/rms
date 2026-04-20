"""
Unit tests for the retry-backoff feature in engine.delivery.

Tests cover:
- get_backoff_minutes parsing (DB setting → list, fallback on bad input)
- deliver_dispatch: success path clears retry_after
- deliver_dispatch: first failure sets retry_after from backoff[0]
- deliver_dispatch: second failure sets retry_after from backoff[1]
- deliver_dispatch: final attempt marks status='failed', clears retry_after
- retry_pending_dispatches: calls deliver_dispatch for due dispatches only
"""
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import pytest
from unittest.mock import MagicMock, patch, call


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dispatch(attempts=0, status='pending', channel='email', contact='a@b.com'):
    """Return a dict that mimics a reminder_dispatches row mapping."""
    return {
        'id': 'disp-001',
        'status': status,
        'channel': channel,
        'attempts': attempts,
        'contact_value': contact,
        'rendered_subject': 'Subj',
        'rendered_body': '<p>Body</p>',
        'subscriber_contact_id': 'contact-001',
    }


def _session_returning(dispatch_dict):
    """Mock session whose execute().mappings().fetchone() returns dispatch_dict."""
    session = MagicMock()
    mapping = MagicMock()
    mapping.fetchone.return_value = dispatch_dict
    execute_ret = MagicMock()
    execute_ret.mappings.return_value = mapping
    session.execute.return_value = execute_ret
    return session


# ---------------------------------------------------------------------------
# get_backoff_minutes
# ---------------------------------------------------------------------------

class TestGetBackoffMinutes:
    def test_parses_valid_setting(self, monkeypatch):
        session = MagicMock()
        monkeypatch.setattr('engine.delivery.get_setting', lambda s, k, d='': '2,10,30')
        from engine.delivery import get_backoff_minutes
        assert get_backoff_minutes(session) == [2, 10, 30]

    def test_falls_back_on_empty_setting(self, monkeypatch):
        session = MagicMock()
        monkeypatch.setattr('engine.delivery.get_setting', lambda s, k, d='': '')
        from engine.delivery import get_backoff_minutes, DEFAULT_BACKOFF_MINUTES
        assert get_backoff_minutes(session) == DEFAULT_BACKOFF_MINUTES

    def test_falls_back_on_non_numeric(self, monkeypatch):
        session = MagicMock()
        monkeypatch.setattr('engine.delivery.get_setting', lambda s, k, d='': 'a,b,c')
        from engine.delivery import get_backoff_minutes, DEFAULT_BACKOFF_MINUTES
        assert get_backoff_minutes(session) == DEFAULT_BACKOFF_MINUTES

    def test_single_value(self, monkeypatch):
        session = MagicMock()
        monkeypatch.setattr('engine.delivery.get_setting', lambda s, k, d='': '5')
        from engine.delivery import get_backoff_minutes
        assert get_backoff_minutes(session) == [5]

    def test_strips_whitespace(self, monkeypatch):
        session = MagicMock()
        monkeypatch.setattr('engine.delivery.get_setting', lambda s, k, d='': ' 1 , 5 , 15 ')
        from engine.delivery import get_backoff_minutes
        assert get_backoff_minutes(session) == [1, 5, 15]


# ---------------------------------------------------------------------------
# deliver_dispatch — success path
# ---------------------------------------------------------------------------

class TestDeliverDispatchSuccess:
    def test_success_marks_sent_and_clears_retry_after(self, monkeypatch):
        session = _session_returning(_dispatch(attempts=0))
        captured = {}

        def fake_execute(stmt, params=None):
            if params:
                captured.update(params)
            r = MagicMock()
            r.mappings.return_value.fetchone.return_value = _dispatch(attempts=0)
            return r

        session.execute.side_effect = fake_execute

        fake_adapter = MagicMock()
        fake_adapter.send.return_value = True
        monkeypatch.setattr(
            'engine.delivery.ADAPTERS', {'email': fake_adapter}
        )
        monkeypatch.setattr(
            'engine.delivery.get_backoff_minutes', lambda s: [1, 5, 15]
        )

        from engine.delivery import deliver_dispatch
        deliver_dispatch(session, 'disp-001')

        # The SQL that fires on success should contain 'sent' and 'retry_after = NULL'
        all_calls = [str(c[0][0]) for c in session.execute.call_args_list]
        success_sql = next((s for s in all_calls if 'sent' in s and 'retry_after' in s), None)
        assert success_sql is not None, 'No SQL updating status=sent with retry_after=NULL'

    def test_already_sent_dispatch_is_skipped(self, monkeypatch):
        session = _session_returning(_dispatch(status='sent'))
        monkeypatch.setattr('engine.delivery.get_backoff_minutes', lambda s: [1, 5, 15])
        from engine.delivery import deliver_dispatch
        deliver_dispatch(session, 'disp-001')
        # Should not call any adapter
        session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# deliver_dispatch — failure / backoff paths
# ---------------------------------------------------------------------------

class TestDeliverDispatchBackoff:
    def _run_failure(self, monkeypatch, attempts_before, backoff, expect_final_fail=False):
        """Helper: simulate a dispatch that has already had `attempts_before` attempts."""
        dispatched = _dispatch(attempts=attempts_before)
        session = MagicMock()

        def fake_execute(stmt, params=None):
            r = MagicMock()
            r.mappings.return_value.fetchone.return_value = dispatched
            return r

        session.execute.side_effect = fake_execute

        fake_adapter = MagicMock()
        fake_adapter.send.side_effect = Exception('network error')
        monkeypatch.setattr('engine.delivery.ADAPTERS', {'email': fake_adapter})
        monkeypatch.setattr('engine.delivery.get_backoff_minutes', lambda s: backoff)

        from engine.delivery import deliver_dispatch
        deliver_dispatch(session, 'disp-001', backoff_minutes=backoff)
        return session

    def test_first_failure_sets_retry_after_delay_0(self, monkeypatch):
        """attempt 0→1: backoff[0] = 1 min."""
        session = self._run_failure(monkeypatch, attempts_before=0, backoff=[1, 5, 15])
        all_params = [c[0][1] for c in session.execute.call_args_list if c[0][1]]
        retry_params = next((p for p in all_params if 'delay' in p), None)
        assert retry_params is not None, 'No delay param found in UPDATE call'
        assert retry_params['delay'] == 1

    def test_second_failure_sets_retry_after_delay_1(self, monkeypatch):
        """attempt 1→2: backoff[1] = 5 min."""
        session = self._run_failure(monkeypatch, attempts_before=1, backoff=[1, 5, 15])
        all_params = [c[0][1] for c in session.execute.call_args_list if c[0][1]]
        retry_params = next((p for p in all_params if 'delay' in p), None)
        assert retry_params is not None
        assert retry_params['delay'] == 5

    def test_final_attempt_marks_failed(self, monkeypatch):
        """attempt 2→3 (=retry_max): status must become 'failed'."""
        session = self._run_failure(monkeypatch, attempts_before=2, backoff=[1, 5, 15])
        all_calls = [str(c[0][0]) for c in session.execute.call_args_list]
        failed_sql = next((s for s in all_calls if 'failed' in s and 'retry_after = NULL' in s), None)
        assert failed_sql is not None, 'No SQL marking dispatch as failed with retry_after=NULL'

    def test_single_attempt_backoff_exhausted_immediately(self, monkeypatch):
        """With backoff=[5] (only 1 retry allowed), the first failure is the last."""
        session = self._run_failure(monkeypatch, attempts_before=0, backoff=[5])
        all_calls = [str(c[0][0]) for c in session.execute.call_args_list]
        failed_sql = next((s for s in all_calls if 'failed' in s), None)
        assert failed_sql is not None


# ---------------------------------------------------------------------------
# retry_pending_dispatches
# ---------------------------------------------------------------------------

class TestRetryPendingDispatches:
    def test_calls_deliver_for_due_dispatches(self, monkeypatch):
        session = MagicMock()
        row = MagicMock()
        row.__getitem__ = lambda self, i: 'disp-001'
        session.execute.return_value.fetchall.return_value = [('disp-001',)]

        delivered = []

        def fake_deliver(sess, did, backoff_minutes=None):
            delivered.append(did)

        monkeypatch.setattr('engine.delivery.get_backoff_minutes', lambda s: [1, 5, 15])
        monkeypatch.setattr('engine.delivery.deliver_dispatch', fake_deliver)

        from engine.delivery import retry_pending_dispatches
        retry_pending_dispatches(session)

        assert delivered == ['disp-001']

    def test_no_op_when_no_due_dispatches(self, monkeypatch):
        session = MagicMock()
        session.execute.return_value.fetchall.return_value = []

        delivered = []
        monkeypatch.setattr('engine.delivery.get_backoff_minutes', lambda s: [1, 5, 15])
        monkeypatch.setattr('engine.delivery.deliver_dispatch', lambda s, d, **kw: delivered.append(d))

        from engine.delivery import retry_pending_dispatches
        retry_pending_dispatches(session)

        assert delivered == []

    def test_passes_backoff_to_deliver(self, monkeypatch):
        session = MagicMock()
        session.execute.return_value.fetchall.return_value = [('disp-abc',)]

        call_kwargs = {}
        def fake_deliver(sess, did, backoff_minutes=None):
            call_kwargs['backoff_minutes'] = backoff_minutes

        monkeypatch.setattr('engine.delivery.get_backoff_minutes', lambda s: [2, 10])
        monkeypatch.setattr('engine.delivery.deliver_dispatch', fake_deliver)

        from engine.delivery import retry_pending_dispatches
        retry_pending_dispatches(session)

        assert call_kwargs['backoff_minutes'] == [2, 10]
