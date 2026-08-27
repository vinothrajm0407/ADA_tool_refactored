"""
Integration tests for scan history and trends endpoints.

Endpoints covered:
  GET /api/history
  GET /api/history/<scan_id>
  GET /api/history/prev-scan
  GET /api/trends
  GET /api/violations/summary
"""
from unittest.mock import patch
import pytest

from tests.conftest import auth_headers


FAKE_SCAN_ITEM = {
    "id":           1,
    "url":          "https://example.com",
    "timestampUtc": "2026-06-01T10:00:00Z",
    "violations":   3,
    "passes":       42,
    "passRate":     93,
    "usedFallback": False,
}

FAKE_SCAN_RESULT = {
    "url":       "https://example.com",
    "axeResult": {"violations": [], "passes": []},
}


# ── GET /api/history ──────────────────────────────────────────────────────────

class TestHistory:
    def test_returns_items(self, client, db_mock, authed_headers):
        db_mock.get_scan_history.return_value = [FAKE_SCAN_ITEM]
        resp = client.get("/api/history", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["available"] is True
        assert len(data["items"]) == 1

    def test_empty_history(self, client, db_mock, authed_headers):
        db_mock.get_scan_history.return_value = []
        resp = client.get("/api/history", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["items"] == []

    def test_db_unavailable_returns_message_not_error(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/history", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["available"] is False
        assert "message" in data
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/history")
        assert resp.status_code == 401

    def test_limit_param_passed_to_db(self, client, db_mock, authed_headers):
        db_mock.get_scan_history.return_value = []
        client.get("/api/history?limit=10", headers=authed_headers)
        db_mock.get_scan_history.assert_called_with(limit=10)


# ── GET /api/history/<scan_id> ────────────────────────────────────────────────

class TestHistoryResult:
    def test_existing_scan_returns_result(self, client, db_mock, authed_headers):
        db_mock.get_scan_result.return_value = FAKE_SCAN_RESULT
        resp = client.get("/api/history/1", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert "result" in data

    def test_not_found_404(self, client, db_mock, authed_headers):
        db_mock.get_scan_result.return_value = None
        resp = client.get("/api/history/9999", headers=authed_headers)
        assert resp.status_code == 404

    def test_db_unavailable_503(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/history/1", headers=authed_headers)
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/history/1")
        assert resp.status_code == 401


# ── GET /api/history/prev-scan ────────────────────────────────────────────────

class TestHistoryPrevScan:
    def test_returns_prev_scan_when_found(self, client, db_mock, authed_headers):
        db_mock.get_prev_scan_summary_for_url.return_value = FAKE_SCAN_ITEM
        resp = client.get("/api/history/prev-scan",
                          query_string={"url": "https://example.com"},
                          headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["scan"] is not None

    def test_returns_null_when_no_prev(self, client, db_mock, authed_headers):
        db_mock.get_prev_scan_summary_for_url.return_value = None
        resp = client.get("/api/history/prev-scan",
                          query_string={"url": "https://new-site.com"},
                          headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["scan"] is None

    def test_missing_url_param_400(self, client, authed_headers):
        resp = client.get("/api/history/prev-scan", headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.get("/api/history/prev-scan", query_string={"url": "https://example.com"})
        assert resp.status_code == 401


# ── GET /api/trends ───────────────────────────────────────────────────────────

class TestTrends:
    def test_default_daily_granularity(self, client, db_mock, authed_headers):
        db_mock.get_scan_trends.return_value = {"data": [], "summary": {}}
        resp = client.get("/api/trends", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["granularity"] == "daily"

    def test_weekly_granularity(self, client, db_mock, authed_headers):
        db_mock.get_scan_trends.return_value = {"data": [], "summary": {}}
        resp = client.get("/api/trends?granularity=weekly", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["granularity"] == "weekly"

    def test_monthly_granularity(self, client, db_mock, authed_headers):
        db_mock.get_scan_trends.return_value = {"data": [], "summary": {}}
        resp = client.get("/api/trends?granularity=monthly", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["granularity"] == "monthly"

    def test_invalid_granularity_falls_back_to_daily(self, client, db_mock, authed_headers):
        db_mock.get_scan_trends.return_value = {"data": [], "summary": {}}
        resp = client.get("/api/trends?granularity=hourly", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["granularity"] == "daily"

    def test_db_unavailable_returns_unavailable(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/trends", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["available"] is False
        db_mock.is_ready.return_value = True

    def test_days_param_used_when_no_from_date(self, client, db_mock, authed_headers):
        db_mock.get_scan_trends.return_value = {"data": [], "summary": {}}
        resp = client.get("/api/trends?days=7", headers=authed_headers)
        assert resp.status_code == 200
        call_kwargs = db_mock.get_scan_trends.call_args[1]
        assert call_kwargs["start_date"] is not None

    def test_no_auth_401(self, client):
        resp = client.get("/api/trends")
        assert resp.status_code == 401


# ── GET /api/violations/summary ───────────────────────────────────────────────

class TestViolationsSummary:
    def test_returns_summary(self, client, db_mock, authed_headers):
        db_mock.get_violation_intel.return_value = {
            "severity_breakdown": {"critical": 2, "serious": 5, "moderate": 8, "minor": 1},
            "top_issue_types":    [{"id": "color-contrast", "count": 10}],
            "wcag_breakdown":     [],
        }
        db_mock.get_regression_candidates.return_value = []
        resp = client.get("/api/violations/summary", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert "severity_breakdown" in data

    def test_db_unavailable_returns_zeros(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/violations/summary", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["severity_breakdown"]["critical"] == 0
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/violations/summary")
        assert resp.status_code == 401
