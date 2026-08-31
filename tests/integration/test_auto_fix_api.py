"""
Integration tests for the real Auto-Fix pipeline endpoint.

Endpoint covered:
  POST /api/auto-fix
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
        db_mock.get_repo_link_by_domain.return_value = FAKE_LINK
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

    def test_failure_passthrough(self, client, db_mock, authed_headers):
        db_mock.get_repo_link_by_domain.return_value = FAKE_LINK
        fake_result = {"status": "failed", "steps": [], "error": "Could not uniquely match this violation"}
        with patch("backend.services.auto_fix_service.run_auto_fix", return_value=fake_result):
            resp = client.post("/api/auto-fix", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "failed"
        assert "match" in data["error"]

    def test_no_repo_linked_404(self, client, db_mock, authed_headers):
        db_mock.get_repo_link_by_domain.return_value = None
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
