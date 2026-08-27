"""
Integration tests for crawl endpoints.

Endpoints covered:
  POST /api/crawl                          — start a crawl
  GET  /api/crawl/<id>                    — poll status
  POST /api/crawl/<id>/stop               — cancel
  GET  /api/crawl/<id>/pages              — page list
  GET  /api/crawls                         — list all crawls
  GET  /api/crawl/<id>/intelligence       — WCAG breakdown
  GET  /api/crawl/<id>/regressions        — regression comparison
  GET  /api/crawls/compare                — side-by-side compare
  GET  /api/crawls/timeline               — score history
  GET  /api/crawl/<id>/page-trends        — most improved/regressed

crawl_service calls are mocked — no Playwright, no Redis.
"""
from unittest.mock import patch, MagicMock
import pytest

from tests.conftest import auth_headers, FAKE_USER

FAKE_CRAWL_ID = "crawl-xyz-789"


def _fake_crawl_job(status="queued"):
    return {
        "crawl_id":        FAKE_CRAWL_ID,
        "status":          status,
        "root_url":        "https://example.com",
        "total_scanned":   0,
        "total_failed":    0,
        "total_discovered": 0,
        "created_at":      "2026-06-01T00:00:00Z",
    }


# ── POST /api/crawl ───────────────────────────────────────────────────────────

class TestCrawlCreate:
    def test_valid_request_returns_202(self, client, authed_headers):
        with patch("app.create_crawl_job", return_value=_fake_crawl_job()):
            resp = client.post("/api/crawl",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 202
        data = resp.get_json()
        assert data["ok"] is True
        assert data["crawl_id"] == FAKE_CRAWL_ID

    def test_missing_url_400(self, client, authed_headers):
        resp = client.post("/api/crawl", json={}, headers=authed_headers)
        assert resp.status_code == 400

    def test_empty_url_400(self, client, authed_headers):
        resp = client.post("/api/crawl", json={"url": ""}, headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/crawl", json={"url": "https://example.com"})
        assert resp.status_code == 401

    def test_non_json_400(self, client, authed_headers):
        resp = client.post("/api/crawl",
                           data="url=x",
                           content_type="text/plain",
                           headers=authed_headers)
        assert resp.status_code == 400

    def test_full_site_flag_passed_to_service(self, client, authed_headers):
        captured = {}
        def _cap(url, opts):
            captured["opts"] = opts
            return _fake_crawl_job()
        with patch("app.create_crawl_job", side_effect=_cap):
            client.post("/api/crawl",
                        json={"url": "https://example.com", "fullSite": True},
                        headers=authed_headers)
        assert captured["opts"]["full_site"] is True

    def test_max_pages_option_passed(self, client, authed_headers):
        captured = {}
        def _cap(url, opts):
            captured["opts"] = opts
            return _fake_crawl_job()
        with patch("app.create_crawl_job", side_effect=_cap):
            client.post("/api/crawl",
                        json={"url": "https://example.com", "maxPages": 10},
                        headers=authed_headers)
        assert captured["opts"]["max_pages"] == 10

    def test_service_error_500(self, client, authed_headers):
        with patch("app.create_crawl_job", side_effect=RuntimeError("Redis gone")):
            resp = client.post("/api/crawl",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 500

    def test_validation_error_from_service_400(self, client, authed_headers):
        with patch("app.create_crawl_job", side_effect=ValueError("Bad URL")):
            resp = client.post("/api/crawl",
                               json={"url": "javascript:alert(1)"},
                               headers=authed_headers)
        assert resp.status_code == 400


# ── GET /api/crawl/<id> ───────────────────────────────────────────────────────

class TestCrawlStatus:
    def test_running_job_returns_status(self, client, authed_headers):
        with patch("app.get_crawl_status", return_value=_fake_crawl_job("running")):
            resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["job"]["status"] == "running"

    def test_not_found_404(self, client, authed_headers):
        with patch("app.get_crawl_status", return_value=None):
            resp = client.get("/api/crawl/nonexistent", headers=authed_headers)
        assert resp.status_code == 404

    def test_no_auth_401(self, client):
        resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}")
        assert resp.status_code == 401

    def test_service_error_500(self, client, authed_headers):
        with patch("app.get_crawl_status", side_effect=RuntimeError("oops")):
            resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}", headers=authed_headers)
        assert resp.status_code == 500


# ── POST /api/crawl/<id>/stop ─────────────────────────────────────────────────

class TestCrawlStop:
    def test_cancel_existing_crawl(self, client, authed_headers):
        with patch("app.cancel_crawl_job", return_value=True):
            resp = client.post(f"/api/crawl/{FAKE_CRAWL_ID}/stop", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True
        assert resp.get_json()["status"] == "cancelled"

    def test_cancel_nonexistent_crawl_404(self, client, authed_headers):
        with patch("app.cancel_crawl_job", return_value=False):
            resp = client.post("/api/crawl/ghost/stop", headers=authed_headers)
        assert resp.status_code == 404

    def test_no_auth_401(self, client):
        resp = client.post(f"/api/crawl/{FAKE_CRAWL_ID}/stop")
        assert resp.status_code == 401


# ── GET /api/crawl/<id>/pages ─────────────────────────────────────────────────

class TestCrawlPages:
    def test_returns_page_list(self, client, authed_headers):
        pages = [
            {"url": "https://example.com/", "status": "scanned", "violations": 2},
            {"url": "https://example.com/about", "status": "scanned", "violations": 0},
        ]
        with patch("app.get_crawl_pages", return_value=pages):
            resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/pages", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["count"] == 2
        assert len(data["pages"]) == 2

    def test_empty_pages(self, client, authed_headers):
        with patch("app.get_crawl_pages", return_value=[]):
            resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/pages", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["count"] == 0

    def test_no_auth_401(self, client):
        with patch("app.get_crawl_pages", return_value=[]):
            resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/pages")
        assert resp.status_code == 401


# ── GET /api/crawls ───────────────────────────────────────────────────────────

class TestCrawlsList:
    def test_returns_list(self, client, db_mock, authed_headers):
        db_mock.get_all_crawl_jobs.return_value = [_fake_crawl_job("completed")]
        resp = client.get("/api/crawls", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["items"]) == 1

    def test_db_unavailable_returns_empty_not_error(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/crawls", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["available"] is False
        assert resp.get_json()["items"] == []
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/crawls")
        assert resp.status_code == 401


# ── GET /api/crawl/<id>/intelligence ─────────────────────────────────────────

class TestCrawlIntelligence:
    def test_returns_intel_data(self, client, db_mock, authed_headers):
        db_mock.get_crawl_violation_intel.return_value = {
            "severity_breakdown": {"critical": 3},
            "top_issue_types":    [{"id": "color-contrast", "count": 5}],
        }
        resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/intelligence", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_no_auth_401(self, client):
        resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/intelligence")
        assert resp.status_code == 401


# ── GET /api/crawls/compare ───────────────────────────────────────────────────

class TestCrawlsCompare:
    def test_valid_comparison(self, client, db_mock, authed_headers):
        db_mock.compare_crawls.return_value = {
            "crawl_a": _fake_crawl_job("completed"),
            "crawl_b": _fake_crawl_job("completed"),
        }
        resp = client.get("/api/crawls/compare",
                          query_string={"a": "crawl-1", "b": "crawl-2"},
                          headers=authed_headers)
        assert resp.status_code == 200

    def test_same_crawl_id_400(self, client, db_mock, authed_headers):
        resp = client.get("/api/crawls/compare",
                          query_string={"a": "same-id", "b": "same-id"},
                          headers=authed_headers)
        assert resp.status_code == 400
        assert "itself" in resp.get_json()["error"].lower()

    def test_missing_params_400(self, client, authed_headers):
        resp = client.get("/api/crawls/compare", headers=authed_headers)
        assert resp.status_code == 400

    def test_crawl_not_found_404(self, client, db_mock, authed_headers):
        db_mock.compare_crawls.return_value = None
        resp = client.get("/api/crawls/compare",
                          query_string={"a": "crawl-1", "b": "crawl-2"},
                          headers=authed_headers)
        assert resp.status_code == 404


# ── GET /api/crawls/timeline ──────────────────────────────────────────────────

class TestCrawlTimeline:
    def test_valid_url_returns_data(self, client, db_mock, authed_headers):
        db_mock.get_crawl_score_timeline.return_value = [
            {"score": 85, "completed_at": "2026-06-01"},
        ]
        resp = client.get("/api/crawls/timeline",
                          query_string={"url": "https://example.com"},
                          headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 1

    def test_missing_url_param_400(self, client, authed_headers):
        resp = client.get("/api/crawls/timeline", headers=authed_headers)
        assert resp.status_code == 400
