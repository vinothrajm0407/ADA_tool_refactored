"""
Unit tests for backend/services/alert_service.py.
Tests evaluate_and_create_alerts threshold logic with fully mocked DB and Config.
"""
import os
from unittest.mock import MagicMock, patch, call

import pytest

os.environ.setdefault("MSSQL_CONN_STR", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "")

CRAWL_ID = "crawl-abc-123"
PREV_CRAWL_ID = "crawl-prev-456"
ROOT_URL = "https://example.com"


def _make_db(
    site_score=80,
    prev_score=80,
    violations=20,
    prev_violations=20,
    curr_critical=0,
    prev_critical=0,
    page_regressions=None,
    has_comparison=True,
) -> MagicMock:
    m = MagicMock()
    m.is_ready.return_value = True
    m.get_crawl_job.side_effect = [
        {"root_url": ROOT_URL, "site_score": site_score, "total_violations": violations, "notify_email": ""},
        {"root_url": ROOT_URL, "site_score": prev_score, "total_violations": prev_violations, "notify_email": ""},
    ]
    m.get_crawl_regressions.return_value = {
        "has_comparison": has_comparison,
        "previous_crawl_id": PREV_CRAWL_ID,
        "regressions": page_regressions or [],
    }
    m.get_crawl_violation_intel.side_effect = [
        {"severity_breakdown": {"critical": curr_critical, "serious": 2}},
        {"severity_breakdown": {"critical": prev_critical, "serious": 2}},
    ]
    m.create_alert.return_value = 1
    return m


def _run(db_mock, score_drop_threshold=5, violation_threshold=10) -> list:
    from backend.services import alert_service
    with patch("backend.services.alert_service.db", db_mock), \
         patch("backend.services.alert_service.Config") as cfg:
        cfg.ALERT_SCORE_DROP_THRESHOLD = score_drop_threshold
        cfg.ALERT_VIOLATION_INCREASE_THRESHOLD = violation_threshold
        cfg.SMTP_ENABLED = False
        cfg.SMTP_HOST = ""
        cfg.ALERT_EMAIL = ""
        return alert_service.evaluate_and_create_alerts(CRAWL_ID)


@pytest.mark.unit
class TestEvaluateAndCreateAlerts:

    def test_returns_empty_when_db_not_ready(self):
        m = _make_db()
        m.is_ready.return_value = False
        assert _run(m) == []

    def test_returns_empty_when_job_not_found(self):
        m = _make_db()
        m.get_crawl_job.side_effect = [None]
        assert _run(m) == []

    def test_returns_empty_when_no_prior_comparison(self):
        m = _make_db(has_comparison=False)
        m.get_crawl_job.side_effect = [
            {"root_url": ROOT_URL, "site_score": 80, "total_violations": 20, "notify_email": ""},
        ]
        assert _run(m) == []

    def test_returns_empty_when_prev_job_not_found(self):
        m = _make_db()
        m.get_crawl_job.side_effect = [
            {"root_url": ROOT_URL, "site_score": 70, "total_violations": 20, "notify_email": ""},
            None,
        ]
        assert _run(m) == []

    # ── Score drop ────────────────────────────────────────────────────────────

    def test_score_drop_gte_threshold_creates_alert(self):
        m = _make_db(site_score=74, prev_score=80)
        m.create_alert.return_value = 42
        result = _run(m, score_drop_threshold=5)
        alert_types = [c.kwargs["alert_type"] for c in m.create_alert.call_args_list]
        assert "score_decrease" in alert_types

    def test_score_drop_below_threshold_no_alert(self):
        m = _make_db(site_score=78, prev_score=80)  # drop of 2 < threshold of 5
        _run(m, score_drop_threshold=5)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "score_decrease" not in alert_types

    def test_score_drop_ge_10_severity_serious(self):
        m = _make_db(site_score=60, prev_score=80)
        _run(m)
        score_calls = [c for c in m.create_alert.call_args_list
                       if c.kwargs.get("alert_type") == "score_decrease"]
        assert score_calls[0].kwargs["severity"] == "serious"

    def test_score_drop_lt_10_severity_moderate(self):
        m = _make_db(site_score=73, prev_score=80)  # drop = 7
        _run(m)
        score_calls = [c for c in m.create_alert.call_args_list
                       if c.kwargs.get("alert_type") == "score_decrease"]
        assert score_calls[0].kwargs["severity"] == "moderate"

    # ── Violation increase ────────────────────────────────────────────────────

    def test_violation_increase_gte_threshold_creates_alert(self):
        m = _make_db(violations=35, prev_violations=20)  # increase = 15
        _run(m, violation_threshold=10)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "violation_increase" in alert_types

    def test_violation_increase_below_threshold_no_alert(self):
        m = _make_db(violations=25, prev_violations=20)  # increase = 5 < 10
        _run(m, violation_threshold=10)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "violation_increase" not in alert_types

    # ── Critical introduced ───────────────────────────────────────────────────

    def test_new_critical_violations_creates_alert(self):
        m = _make_db(curr_critical=3, prev_critical=0)
        _run(m)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "critical_introduced" in alert_types

    def test_no_alert_when_critical_count_unchanged(self):
        m = _make_db(curr_critical=2, prev_critical=2)
        _run(m)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "critical_introduced" not in alert_types

    # ── Page regressions ─────────────────────────────────────────────────────

    def test_page_regressions_create_alert(self):
        regressions = [{"url": "https://example.com/page1", "delta": 5}]
        m = _make_db(page_regressions=regressions)
        _run(m)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "regression_detected" in alert_types

    def test_no_regression_alert_when_no_regressions(self):
        m = _make_db(page_regressions=[])
        _run(m)
        alert_types = [c.kwargs.get("alert_type") for c in m.create_alert.call_args_list]
        assert "regression_detected" not in alert_types

    # ── Return values ─────────────────────────────────────────────────────────

    def test_returns_list_of_created_ids(self):
        m = _make_db(site_score=60, prev_score=80, violations=35, prev_violations=20)
        ids_seq = iter(range(10, 20))
        m.create_alert.side_effect = lambda **kw: next(ids_seq)
        result = _run(m)
        assert len(result) >= 2
        assert all(isinstance(i, int) for i in result)

    def test_none_alert_id_excluded_from_result(self):
        m = _make_db(site_score=60, prev_score=80)
        m.create_alert.return_value = None
        result = _run(m)
        assert None not in result

    def test_alert_includes_crawl_id_in_details(self):
        m = _make_db(site_score=60, prev_score=80)
        m.create_alert.return_value = 1
        _run(m)
        for c in m.create_alert.call_args_list:
            assert c.kwargs.get("crawl_id") == CRAWL_ID
