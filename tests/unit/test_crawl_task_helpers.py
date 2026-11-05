"""
Unit tests for pure helper functions in backend/services/crawl_task.py.
Tests _utcnow_iso and _duration without triggering Playwright imports.
"""
import os
import re
import time

import pytest

os.environ.setdefault("MSSQL_CONN_STR", "")
os.environ.setdefault("REDIS_URL", "")

from backend.services.crawl_task import _utcnow_iso, _duration


# ── _utcnow_iso ───────────────────────────────────────────────────────────────

@pytest.mark.unit
class TestUtcNowIso:
    def test_returns_string(self):
        assert isinstance(_utcnow_iso(), str)

    def test_matches_iso_format_with_z(self):
        ts = _utcnow_iso()
        assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$", ts), ts

    def test_ends_with_z(self):
        assert _utcnow_iso().endswith("Z")

    def test_includes_milliseconds(self):
        ts = _utcnow_iso()
        # Everything after the decimal must be digits
        frac = ts.split(".")[1].rstrip("Z")
        assert frac.isdigit()

    def test_consecutive_calls_are_non_decreasing(self):
        t1 = _utcnow_iso()
        time.sleep(0.01)
        t2 = _utcnow_iso()
        # ISO 8601 lexicographic order matches chronological order
        assert t1 <= t2


# ── _duration ─────────────────────────────────────────────────────────────────

@pytest.mark.unit
class TestDuration:
    def test_basic_30_seconds(self):
        r = _duration("2026-06-01T10:00:00.000Z", "2026-06-01T10:00:30.000Z")
        assert r == pytest.approx(30.0)

    def test_exactly_one_minute(self):
        r = _duration("2026-06-01T10:00:00.000Z", "2026-06-01T10:01:00.000Z")
        assert r == pytest.approx(60.0)

    def test_sub_second_precision(self):
        r = _duration("2026-06-01T10:00:00.000Z", "2026-06-01T10:00:00.500Z")
        assert r == pytest.approx(0.5, abs=0.01)

    def test_duration_across_midnight(self):
        r = _duration("2026-06-01T23:00:00.000Z", "2026-06-02T01:00:00.000Z")
        assert r == pytest.approx(7200.0)

    def test_invalid_start_returns_none(self):
        assert _duration("not-a-date", "2026-06-01T10:00:00.000Z") is None

    def test_invalid_end_returns_none(self):
        assert _duration("2026-06-01T10:00:00.000Z", "bad") is None

    def test_none_inputs_return_none(self):
        assert _duration(None, None) is None

    def test_empty_strings_return_none(self):
        assert _duration("", "") is None


# ── _shows_login_page ─────────────────────────────────────────────────────────

class _FakePage:
    def __init__(self, url, boxes):
        self.url, self._boxes = url, boxes

    def evaluate(self, _js):
        return self._boxes


@pytest.mark.unit
class TestShowsLoginPage:
    LOGIN = "https://site.test/login"
    FORM = ["email||email|you@company.com", "password||password|Enter your password", "checkbox|||"]

    def _shows(self, url, boxes):
        from backend.services.crawl_task import _shows_login_page
        return _shows_login_page(_FakePage(url, boxes), self.LOGIN, self.FORM)

    def test_redirected_to_login_url(self):
        assert self._shows("https://site.test/login?next=/account", [])

    def test_login_form_drawn_in_place(self):  # SPA: address unchanged, login form shown
        assert self._shows("https://site.test/dashboard", self.FORM + ["text||search|Search"])

    def test_signup_form_is_not_the_login_form(self):
        assert not self._shows("https://site.test/signup",
                               ["text||name|Full name", "email||signup-email|", "password||signup-password|"])

    def test_real_page_without_form(self):
        assert not self._shows("https://site.test/dashboard", ["text||search|Search"])

    def test_no_recorded_form_only_checks_url(self):
        from backend.services.crawl_task import _shows_login_page
        assert not _shows_login_page(_FakePage("https://site.test/dashboard", self.FORM), self.LOGIN, None)
