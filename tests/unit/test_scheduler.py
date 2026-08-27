"""
Unit tests for backend/services/scheduler_service.py.
Tests start_scheduler idempotency and _tick dispatch logic.
"""
import os
import threading
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("MSSQL_CONN_STR", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "")


def _make_db(due_schedules=None, active=False) -> MagicMock:
    m = MagicMock()
    m.get_due_schedules.return_value = due_schedules or []
    m.has_active_crawl_for_url.return_value = active
    m.mark_schedule_ran.return_value = None
    return m


def _tick(db_mock, create_mock=None) -> MagicMock:
    """Run _tick() with patched db and create_crawl_job, return the create mock."""
    import backend.services.scheduler_service as svc
    if create_mock is None:
        create_mock = MagicMock(return_value={"crawl_id": "new-crawl-1"})
    with patch("services.db", db_mock), \
         patch("backend.services.crawl_service.create_crawl_job", create_mock):
        svc._tick()
    return create_mock


# ── start_scheduler ───────────────────────────────────────────────────────────

@pytest.mark.unit
class TestStartScheduler:

    def setup_method(self):
        import backend.services.scheduler_service as svc
        svc._started = False

    def test_no_thread_spawned_when_disabled(self):
        import backend.services.scheduler_service as svc
        before = threading.active_count()
        with patch("backend.services.scheduler_service.Config") as cfg:
            cfg.SCHEDULER_ENABLED = False
            svc.start_scheduler()
        assert threading.active_count() == before

    def test_idempotent_second_call_does_not_spawn_thread(self):
        import backend.services.scheduler_service as svc

        def noop_loop():
            pass  # immediately return so daemon thread doesn't hang

        with patch("backend.services.scheduler_service.Config") as cfg, \
             patch.object(svc, "_scheduler_loop", side_effect=noop_loop):
            cfg.SCHEDULER_ENABLED = True
            cfg.SCHEDULER_INTERVAL_SECONDS = 60
            before = threading.active_count()
            svc.start_scheduler()
            after_first = threading.active_count()
            svc.start_scheduler()
            after_second = threading.active_count()
        # Second call must not increase thread count
        assert after_first == after_second

    def test_disabled_flag_prevents_multiple_starts(self):
        import backend.services.scheduler_service as svc
        with patch("backend.services.scheduler_service.Config") as cfg:
            cfg.SCHEDULER_ENABLED = False
            for _ in range(3):
                svc.start_scheduler()
        assert svc._started is False


# ── _tick ─────────────────────────────────────────────────────────────────────

@pytest.mark.unit
class TestTick:

    def test_no_action_when_no_due_schedules(self):
        db = _make_db(due_schedules=[])
        create = _tick(db)
        create.assert_not_called()

    def test_get_due_schedules_is_always_called(self):
        db = _make_db(due_schedules=[])
        _tick(db)
        db.get_due_schedules.assert_called_once()

    def test_creates_crawl_for_due_schedule(self):
        db = _make_db(due_schedules=[
            {"id": 10, "root_url": "https://example.com", "frequency": "weekly"}
        ])
        create = _tick(db)
        create.assert_called_once_with("https://example.com", {})

    def test_marks_schedule_ran_after_crawl(self):
        db = _make_db(due_schedules=[
            {"id": 10, "root_url": "https://example.com", "frequency": "weekly"}
        ])
        _tick(db)
        db.mark_schedule_ran.assert_called_once_with(10, "weekly", time_of_day=None)

    def test_skips_create_when_crawl_already_active(self):
        db = _make_db(
            due_schedules=[{"id": 20, "root_url": "https://busy.com", "frequency": "daily"}],
            active=True,
        )
        create = _tick(db)
        create.assert_not_called()

    def test_advances_schedule_even_when_active(self):
        """Advancing NextRunAt prevents the same schedule from retrying immediately."""
        db = _make_db(
            due_schedules=[{"id": 30, "root_url": "https://busy.com", "frequency": "monthly"}],
            active=True,
        )
        _tick(db)
        db.mark_schedule_ran.assert_called_once_with(30, "monthly", time_of_day=None)

    def test_processes_multiple_due_schedules(self):
        db = _make_db(due_schedules=[
            {"id": 1, "root_url": "https://a.com", "frequency": "weekly"},
            {"id": 2, "root_url": "https://b.com", "frequency": "daily"},
        ])
        create = MagicMock(return_value={"crawl_id": "x"})
        _tick(db, create_mock=create)
        assert create.call_count == 2

    def test_exception_in_create_crawl_is_caught(self):
        """Errors from create_crawl_job must not bubble up and break the scheduler loop."""
        db = _make_db(due_schedules=[
            {"id": 50, "root_url": "https://failing.com", "frequency": "weekly"}
        ])
        create = MagicMock(side_effect=RuntimeError("DB unavailable"))
        # Must not raise
        _tick(db, create_mock=create)

    def test_exception_does_not_prevent_remaining_schedules(self):
        """A failure on one schedule should not block processing of the next."""
        db = _make_db(due_schedules=[
            {"id": 50, "root_url": "https://failing.com", "frequency": "weekly"},
            {"id": 51, "root_url": "https://ok.com", "frequency": "weekly"},
        ])
        call_count = 0
        def maybe_raise(url, opts):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("first fails")
            return {"crawl_id": "ok-crawl"}

        import backend.services.scheduler_service as svc
        with patch("services.db", db), \
             patch("backend.services.crawl_service.create_crawl_job", maybe_raise):
            svc._tick()

        assert call_count == 2  # both schedules were attempted
