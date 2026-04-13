import os
import sys
import types

# ensure apps/worker is on sys.path so we can import engine.delivery
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import pytest


class DummySMTP:
    def __init__(self, host, port, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.tls_started = False
        self.logged_in = False
        self.sent_messages = []
        self.quitted = False

    def starttls(self):
        self.tls_started = True

    def login(self, user, password):
        self.logged_in = (user, password)

    def send_message(self, msg):
        self.sent_messages.append(msg)

    def quit(self):
        self.quitted = True


def test_smtp_send_with_auth_and_tls(monkeypatch):
    # prepare env
    monkeypatch.setenv('SMTP_HOST', 'smtp.test')
    monkeypatch.setenv('SMTP_PORT', '587')
    monkeypatch.setenv('SMTP_USER', 'u')
    monkeypatch.setenv('SMTP_PASSWORD', 'p')
    monkeypatch.setenv('SMTP_USE_TLS', '1')
    monkeypatch.setenv('SMTP_FROM_EMAIL', 'noreply@test')

    dummy = DummySMTP('smtp.test', 587)

    def fake_smtp(host, port, timeout=30):
        assert host == 'smtp.test'
        assert port == 587
        return dummy

    monkeypatch.setattr('smtplib.SMTP', fake_smtp)

    from engine.delivery import _smtp_send

    dispatch = {
        'contact_value': 'user@example.com',
        'rendered_subject': 'Subj',
        'rendered_body': '<p>HTML</p>',
    }

    assert _smtp_send(dispatch) is True
    assert dummy.tls_started is True
    assert dummy.logged_in == ('u', 'p')
    assert len(dummy.sent_messages) == 1
    assert dummy.quitted is True


def test_smtp_send_plain_no_auth(monkeypatch):
    monkeypatch.setenv('SMTP_HOST', 'smtp.test')
    monkeypatch.setenv('SMTP_PORT', '25')
    monkeypatch.delenv('SMTP_USER', raising=False)
    monkeypatch.delenv('SMTP_PASSWORD', raising=False)
    monkeypatch.setenv('SMTP_USE_TLS', '0')
    monkeypatch.setenv('SMTP_FROM_EMAIL', 'noreply@test')

    dummy = DummySMTP('smtp.test', 25)

    def fake_smtp(host, port, timeout=30):
        assert host == 'smtp.test'
        assert port == 25
        return dummy

    monkeypatch.setattr('smtplib.SMTP', fake_smtp)

    from engine.delivery import _smtp_send

    dispatch = {
        'contact_value': 'user2@example.com',
        'rendered_subject': 'Hello',
        'rendered_body': '<b>Hi</b>',
    }

    assert _smtp_send(dispatch) is True
    assert dummy.tls_started is False
    assert dummy.logged_in is False
    assert len(dummy.sent_messages) == 1
    assert dummy.quitted is True
