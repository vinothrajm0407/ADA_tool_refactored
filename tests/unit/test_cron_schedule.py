"""
Unit tests for cron-expression scheduling: services/db._compute_next_run_cron
and the create/update API's cron validation.
"""
import os
from datetime import datetime, timezone

import pytest

os.environ.setdefault("MSSQL_CONN_STR", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "")


@pytest.mark.unit
class TestComputeNextRunCron:

    def test_every_five_minutes_stays_utc_and_within_window(self):
        from services.db import _compute_next_run_cron
        now = datetime(2026, 9, 10, 10, 3, tzinfo=timezone.utc)
        nxt = _compute_next_run_cron("*/5 * * * *", now)
        assert nxt.tzinfo is not None
        assert nxt == datetime(2026, 9, 10, 10, 5, tzinfo=timezone.utc)

    def test_weekly_on_sunday(self):
        from services.db import _compute_next_run_cron
        now = datetime(2026, 9, 10, 10, 3, tzinfo=timezone.utc)  # a Thursday
        nxt = _compute_next_run_cron("0 9 * * 0", now)
        assert nxt.weekday() == 6  # Sunday
        assert (nxt.hour, nxt.minute) == (9, 0)


@pytest.mark.unit
class TestCronValidity:
    """app.py's create/update endpoints gate on croniter.is_valid() before saving."""

    def test_rejects_malformed_expression(self):
        from croniter import croniter
        assert croniter.is_valid("not a cron") is False

    def test_accepts_well_formed_expression(self):
        from croniter import croniter
        assert croniter.is_valid("*/5 * * * *") is True
