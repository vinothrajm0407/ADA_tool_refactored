"""
Integration tests for the real Auto-Fix pipeline endpoint.

Endpoints covered:
  POST /api/auto-fix
  GET  /api/fixes
"""
from unittest.mock import patch
import pytest

VALID_BODY = {
    "page_url": "https://example.com/page",
    "rule": {"id": "button-name", "help": "Buttons must have discernible text"},
    "node": {"html": '<button class="menu-btn"><svg/></button>'},
}

FAKE_LINK = {
    "id": 1, "domain": "example.com", "site_url": "https://example.com",
    "repo_url": "https://github.com/acme/example-site", "default_branch": "main",
    "framework": "react", "access_token": "ghp_test",
}


class TestAutoFix:
    def test_success_passthrough(self, client, db_mock, authed_headers):
        db_mock.get_repo_link_for_url.return_value = FAKE_LINK
        fake_result = {"status": "verified", "steps": [{"name": "Clone repo", "ok": True}],
                       "branch_url": "https://github.com/acme/example-site/tree/ada/fix/button-name-abc"}
        with patch("backend.services.auto_fix_service.run_auto_fix", return_value=fake_result) as mock_run:
            resp = client.post("/api/auto-fix", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["status"] == "verified"
        assert data["branch_url"].endswith("button-name-abc")
        mock_run.assert_called_once()
        db_mock.save_fix.assert_called_once()
        args = db_mock.save_fix.call_args[0]
        assert args[3] == "verified"                # status
        assert args[4].endswith("button-name-abc")   # branch_url

    def test_duplicate_open_fix_skips_pipeline(self, client, db_mock, authed_headers):
        db_mock.get_repo_link_for_url.return_value = FAKE_LINK
        db_mock.get_open_fix.return_value = {
            "pr_url": "https://github.com/acme/example-site/pull/1",
            "branch_url": "https://github.com/acme/example-site/tree/ada/fix/button-name-abc",
        }
        with patch("backend.services.auto_fix_service.run_auto_fix") as mock_run, \
             patch("backend.services.auto_fix_service.is_pull_request_open", return_value=True):
            resp = client.post("/api/auto-fix", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "verified"
        assert data["duplicate"] is True
        assert data["pr_url"].endswith("/pull/1")
        mock_run.assert_not_called()
        db_mock.save_fix.assert_not_called()

    def test_stale_duplicate_record_reruns_when_pr_no_longer_open(self, client, db_mock, authed_headers):
        # The DB still has an "open" fix on record, but the PR was since closed
        # (or the repo archived) on GitHub's side — should not block a re-run.
        db_mock.get_repo_link_for_url.return_value = FAKE_LINK
        db_mock.get_open_fix.return_value = {
            "pr_url": "https://github.com/acme/example-site/pull/1",
            "branch_url": "https://github.com/acme/example-site/tree/ada/fix/button-name-abc",
        }
        fake_result = {"status": "verified", "steps": [], "pr_url": "https://github.com/acme/example-site/pull/2"}
        with patch("backend.services.auto_fix_service.run_auto_fix", return_value=fake_result) as mock_run, \
             patch("backend.services.auto_fix_service.is_pull_request_open", return_value=False):
            resp = client.post("/api/auto-fix", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("duplicate") is not True
        assert data["pr_url"].endswith("/pull/2")
        mock_run.assert_called_once()

    def test_failure_passthrough(self, client, db_mock, authed_headers):
        db_mock.get_repo_link_for_url.return_value = FAKE_LINK
        fake_result = {"status": "failed", "steps": [], "error": "Could not uniquely match this violation"}
        with patch("backend.services.auto_fix_service.run_auto_fix", return_value=fake_result):
            resp = client.post("/api/auto-fix", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "failed"
        assert "match" in data["error"]

    def test_no_repo_linked_404(self, client, db_mock, authed_headers):
        db_mock.get_repo_link_for_url.return_value = None
        resp = client.post("/api/auto-fix", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 404
        assert resp.get_json()["ok"] is False

    def test_missing_page_url_400(self, client, authed_headers):
        body = {**VALID_BODY, "page_url": ""}
        resp = client.post("/api/auto-fix", json=body, headers=authed_headers)
        assert resp.status_code == 400

    def test_missing_rule_id_400(self, client, authed_headers):
        body = {**VALID_BODY, "rule": {}}
        resp = client.post("/api/auto-fix", json=body, headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/auto-fix", json=VALID_BODY)
        assert resp.status_code == 401


class TestFixesList:
    def test_returns_items(self, client, db_mock, authed_headers):
        db_mock.get_fixes.return_value = [
            {"id": 1, "page_url": "https://example.com", "rule_id": "button-name", "status": "verified",
             "branch_url": "https://github.com/acme/example-site/tree/ada/fix/button-name-abc",
             "pr_url": "https://github.com/acme/example-site/pull/1", "error_message": None,
             "created_at": "2026-08-31T00:00:00"},
        ]
        resp = client.get("/api/fixes", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["fixes"]) == 1
        assert data["fixes"][0]["pr_url"].endswith("/pull/1")

    def test_empty_list(self, client, db_mock, authed_headers):
        db_mock.get_fixes.return_value = []
        resp = client.get("/api/fixes", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["fixes"] == []

    def test_no_auth_401(self, client):
        resp = client.get("/api/fixes")
        assert resp.status_code == 401
