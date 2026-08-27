"""
Integration tests for assistive testing endpoints.

Endpoints covered:
  POST /api/assisted/keyboard
  POST /api/assisted/color-contrast
  POST /api/assisted/page-structure
  GET  /api/assistive-history

Playwright browser is mocked — tests verify API contract, auth, and
error handling without launching a real browser.
"""
from unittest.mock import patch, MagicMock
import pytest

from tests.conftest import auth_headers, FAKE_USER


def _keyboard_result(passed=True):
    return {
        "url":            "https://example.com",
        "module":         "keyboard",
        "ok":             True,
        "passed":         passed,
        "checks": [
            {"id": "focusable-elements-present",  "label": "Focusable elements detected",         "passed": passed},
            {"id": "initial-focus-reachable",     "label": "Initial keyboard focus is reachable", "passed": passed},
            {"id": "tab-navigation-progresses",   "label": "Tab navigation progresses",           "passed": passed},
            {"id": "focus-indicator-visible",     "label": "Focused element has indicator",       "passed": passed},
        ],
        "failedChecks":    [],
        "focusPathSample": ["a#skip-link", "button.menu-toggle"],
        "errors":          [],
        "summary":         "Keyboard automated checks passed.",
        "title":           "Example Domain",
    }


def _contrast_result(passed=True):
    return {
        "url":                  "https://example.com",
        "module":               "color-contrast",
        "ok":                   True,
        "passed":               passed,
        "checks":               [],
        "failedChecks":         [],
        "totalContrastRules":   0,
        "totalAffectedElements": 0,
        "affectedSamples":      [],
        "groupedTargets":       [],
        "ratioOverview":        {"requiredAA": 4.5, "lowestFound": None, "averageFound": None, "sampleCount": 0},
        "summary":              "Color contrast automated checks passed.",
    }


def _page_structure_result(passed=True):
    return {
        "url":            "https://example.com",
        "module":         "page-structure",
        "ok":             True,
        "passed":         passed,
        "title":          "Example Domain",
        "checks": [
            {"id": "heading-hierarchy",  "label": "Heading hierarchy is logical",   "passed": passed},
            {"id": "landmark-regions",   "label": "Key landmark regions present",   "passed": passed},
        ],
        "failedChecks":    [],
        "headings":        [{"level": 1, "text": "Example Domain", "id": "", "visible": True}],
        "headingIssues":   [],
        "landmarks":       [{"role": "main", "tagName": "main", "label": "", "labelledby": "", "visible": True}],
        "landmarkIssues":  [],
        "errors":          [],
        "summary":         "Page structure checks passed.",
    }


# ── POST /api/assisted/keyboard ───────────────────────────────────────────────

class TestAssistedKeyboard:
    def test_success_returns_result(self, client, db_mock, authed_headers):
        with patch("app.run_keyboard_assisted_test", return_value=_keyboard_result()):
            resp = client.post("/api/assisted/keyboard",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["result"]["module"] == "keyboard"
        assert data["result"]["passed"] is True

    def test_missing_url_400(self, client, authed_headers):
        resp = client.post("/api/assisted/keyboard", json={}, headers=authed_headers)
        assert resp.status_code == 400
        assert resp.get_json()["ok"] is False

    def test_empty_url_400(self, client, authed_headers):
        resp = client.post("/api/assisted/keyboard",
                           json={"url": ""},
                           headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/assisted/keyboard",
                           json={"url": "https://example.com"})
        assert resp.status_code == 401

    def test_non_json_content_type_400(self, client, authed_headers):
        resp = client.post("/api/assisted/keyboard",
                           data="url=https://example.com",
                           content_type="text/plain",
                           headers=authed_headers)
        assert resp.status_code == 400

    def test_playwright_error_500(self, client, authed_headers):
        with patch("app.run_keyboard_assisted_test",
                   side_effect=RuntimeError("Browser launch failed")):
            resp = client.post("/api/assisted/keyboard",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 500

    def test_saves_to_db_when_ready(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = True
        with patch("app.run_keyboard_assisted_test", return_value=_keyboard_result()):
            client.post("/api/assisted/keyboard",
                        json={"url": "https://example.com"},
                        headers=authed_headers)
        db_mock.save_assistive_scan.assert_called_once_with(
            "keyboard", "https://example.com", True, _keyboard_result()
        )

    def test_failed_test_still_returns_200(self, client, db_mock, authed_headers):
        with patch("app.run_keyboard_assisted_test", return_value=_keyboard_result(passed=False)):
            resp = client.post("/api/assisted/keyboard",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["result"]["passed"] is False


# ── POST /api/assisted/color-contrast ────────────────────────────────────────

class TestAssistedColorContrast:
    def test_success_returns_result(self, client, db_mock, authed_headers):
        with patch("app.run_color_contrast_assisted_test", return_value=_contrast_result()):
            resp = client.post("/api/assisted/color-contrast",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["result"]["module"] == "color-contrast"

    def test_missing_url_400(self, client, authed_headers):
        resp = client.post("/api/assisted/color-contrast", json={}, headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/assisted/color-contrast",
                           json={"url": "https://example.com"})
        assert resp.status_code == 401

    def test_violations_found_still_200(self, client, db_mock, authed_headers):
        result = _contrast_result(passed=False)
        result["totalAffectedElements"] = 5
        with patch("app.run_color_contrast_assisted_test", return_value=result):
            resp = client.post("/api/assisted/color-contrast",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["result"]["passed"] is False

    def test_saves_scan_type_as_contrast(self, client, db_mock, authed_headers):
        with patch("app.run_color_contrast_assisted_test", return_value=_contrast_result()):
            client.post("/api/assisted/color-contrast",
                        json={"url": "https://example.com"},
                        headers=authed_headers)
        call_args = db_mock.save_assistive_scan.call_args
        assert call_args[0][0] == "contrast"


# ── POST /api/assisted/page-structure ────────────────────────────────────────

class TestAssistedPageStructure:
    def test_success_returns_result(self, client, db_mock, authed_headers):
        with patch("app.run_page_structure_assisted_test", return_value=_page_structure_result()):
            resp = client.post("/api/assisted/page-structure",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["result"]["module"] == "page-structure"

    def test_missing_url_400(self, client, authed_headers):
        resp = client.post("/api/assisted/page-structure", json={}, headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/assisted/page-structure",
                           json={"url": "https://example.com"})
        assert resp.status_code == 401

    def test_saves_scan_type_as_page_structure(self, client, db_mock, authed_headers):
        with patch("app.run_page_structure_assisted_test", return_value=_page_structure_result()):
            client.post("/api/assisted/page-structure",
                        json={"url": "https://example.com"},
                        headers=authed_headers)
        call_args = db_mock.save_assistive_scan.call_args
        assert call_args[0][0] == "page-structure"

    def test_structural_issues_still_returns_200(self, client, db_mock, authed_headers):
        result = _page_structure_result(passed=False)
        result["headingIssues"] = [{"type": "no_h1", "severity": "error", "message": "Page has no H1 heading"}]
        with patch("app.run_page_structure_assisted_test", return_value=result):
            resp = client.post("/api/assisted/page-structure",
                               json={"url": "https://example.com"},
                               headers=authed_headers)
        assert resp.status_code == 200


# ── GET /api/assistive-history ────────────────────────────────────────────────

class TestAssistiveHistory:
    def test_returns_items(self, client, db_mock, authed_headers):
        db_mock.get_assistive_scans.return_value = [
            {"id": 1, "scan_type": "keyboard", "url": "https://example.com", "passed": True},
            {"id": 2, "scan_type": "contrast", "url": "https://example.com", "passed": False},
        ]
        resp = client.get("/api/assistive-history", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["items"]) == 2

    def test_filter_by_scan_type(self, client, db_mock, authed_headers):
        db_mock.get_assistive_scans.return_value = []
        resp = client.get("/api/assistive-history",
                          query_string={"scan_type": "keyboard"},
                          headers=authed_headers)
        assert resp.status_code == 200
        call_kwargs = db_mock.get_assistive_scans.call_args[1]
        assert call_kwargs["scan_type"] == "keyboard"

    def test_db_unavailable_returns_empty(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/assistive-history", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["available"] is False
        assert data["items"] == []
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/assistive-history")
        assert resp.status_code == 401
