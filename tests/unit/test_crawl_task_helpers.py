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
