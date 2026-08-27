"""
Integration tests for scan endpoints.

Endpoints covered:
  POST /api/scan             — queue a new scan job
  GET  /api/scan/<job_id>   — poll scan status
  GET  /health/live
  GET  /health/ready

Scan execution (Playwright + axe) is always mocked.
RQ queue is mocked to return a fake job_id.
"""
from unittest.mock import patch, MagicMock
import pytest

from tests.conftest import auth_headers, make_token, FAKE_USER


FAKE_JOB_ID = "job-abc-123"


def _make_scan_job(status="queued"):
    return {"job_id": FAKE_JOB_ID, "status": status, "url": "https://example.com"}


def _mock_create_scan(url, opts):
    return _make_scan_job()


# ── POST /api/scan ────────────────────────────────────────────────────────────

class TestScanCreate:
    def test_returns_202_with_job_id(self, client, db_mock, authed_headers):
        with patch("app.create_scan_job", side_effect=_mock_create_scan):
            resp = client.post("/api/scan",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 202
        data = resp.get_json()
        assert data["ok"] is True
        assert data["jobId"] == FAKE_JOB_ID
        assert data["status"] == "queued"

    def test_missing_url_400(self, client, authed_headers):
        resp = client.post("/api/scan", json={}, headers=authed_headers)
        assert resp.status_code == 400
        assert "url" in resp.get_json()["error"].lower()

    def test_empty_url_400(self, client, authed_headers):
        resp = client.post("/api/scan", json={"url": "   "}, headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/scan", json={"url": "https://example.com"})
        assert resp.status_code == 401

    def test_non_json_content_type_400(self, client, authed_headers):
        resp = client.post("/api/scan",
                           data="url=https://example.com",
                           content_type="application/x-www-form-urlencoded",
                           headers=authed_headers)
        assert resp.status_code == 400

    def test_include_best_practices_accepted(self, client, authed_headers):
        with patch("app.create_scan_job", side_effect=_mock_create_scan):
            resp = client.post("/api/scan",
                               json={"url": "https://example.com", "includeBestPractices": True},
                               headers=authed_headers)
        assert resp.status_code == 202

    def test_rate_limit_second_request_429(self, client, authed_headers):
        with patch("app.create_scan_job", side_effect=_mock_create_scan):
            client.post("/api/scan", json={"url": "https://example.com"}, headers=authed_headers)
            resp = client.post("/api/scan", json={"url": "https://example.com"}, headers=authed_headers)
        assert resp.status_code == 429
        data = resp.get_json()
        assert "retry" in data["error"].lower() or "wait" in data["error"].lower()

    def test_rate_limit_includes_retry_after_header(self, client, authed_headers):
        with patch("app.create_scan_job", side_effect=_mock_create_scan):
            client.post("/api/scan", json={"url": "https://example.com"}, headers=authed_headers)
            resp = client.post("/api/scan", json={"url": "https://example.com"}, headers=authed_headers)
        assert "Retry-After" in resp.headers

    def test_queue_error_500(self, client, authed_headers):
        with patch("app.create_scan_job", side_effect=RuntimeError("Redis down")):
            resp = client.post("/api/scan", json={"url": "https://example.com"}, headers=authed_headers)
        assert resp.status_code == 500
        assert resp.get_json()["ok"] is False

    def test_invalid_url_via_create_scan_job_400(self, client, authed_headers):
        with patch("app.create_scan_job", side_effect=ValueError("Invalid URL scheme")):
            resp = client.post("/api/scan", json={"url": "ftp://bad.scheme"}, headers=authed_headers)
        assert resp.status_code == 400


# ── GET /api/scan/<job_id> ────────────────────────────────────────────────────

class TestScanStatus:
    def test_queued_job_returns_status(self, client, authed_headers):
        job = {"job_id": FAKE_JOB_ID, "status": "queued", "url": "https://example.com"}
        with patch("app.get_scan_status", return_value=job):
            resp = client.get(f"/api/scan/{FAKE_JOB_ID}", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["job"]["status"] == "queued"

    def test_finished_status_normalised_to_completed(self, client, authed_headers):
        job = {
            "job_id": FAKE_JOB_ID,
            "status": "finished",
            "result": {"scan_result": {"violations": []}},
        }
        with patch("app.get_scan_status", return_value=job):
            resp = client.get(f"/api/scan/{FAKE_JOB_ID}", headers=authed_headers)
        data = resp.get_json()
        assert data["job"]["status"] == "completed"
        assert "violations" in data["job"]["result"]

    def test_job_not_found_404(self, client, authed_headers):
        with patch("app.get_scan_status", return_value=None):
            resp = client.get("/api/scan/nonexistent", headers=authed_headers)
        assert resp.status_code == 404

    def test_no_auth_401(self, client):
        resp = client.get(f"/api/scan/{FAKE_JOB_ID}")
        assert resp.status_code == 401

    def test_service_error_500(self, client, authed_headers):
        with patch("app.get_scan_status", side_effect=RuntimeError("DB offline")):
            resp = client.get(f"/api/scan/{FAKE_JOB_ID}", headers=authed_headers)
        assert resp.status_code == 500


# ── Health endpoints ──────────────────────────────────────────────────────────

class TestHealthEndpoints:
    def test_health_live_always_200(self, client):
        resp = client.get("/health/live")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"

    def test_health_live_includes_request_id(self, client):
        resp = client.get("/health/live")
        assert resp.status_code == 200

    def test_health_ready_with_queue_and_db(self, client, db_mock):
        queue_mock = MagicMock()
        queue_mock.health_check.return_value = {
            "connected": True,
            "backend":   "redis",
            "queue_name": "ada_scan_queue",
            "redis_url":  "redis://localhost:6379",
        }
        db_mock.is_ready.return_value = True
        with patch("app.get_queue_service", return_value=queue_mock):
            resp = client.get("/health/ready")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["database"]["available"] is True

    def test_health_ready_degraded_when_db_down(self, client, db_mock):
        queue_mock = MagicMock()
        queue_mock.health_check.return_value = {"connected": True}
        db_mock.is_ready.return_value = False
        with patch("app.get_queue_service", return_value=queue_mock):
            resp = client.get("/health/ready")
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True

    def test_health_ready_degraded_when_queue_down(self, client, db_mock):
        queue_mock = MagicMock()
        queue_mock.health_check.side_effect = RuntimeError("Redis down")
        db_mock.is_ready.return_value = True
        with patch("app.get_queue_service", return_value=queue_mock):
            resp = client.get("/health/ready")
        assert resp.status_code == 503
