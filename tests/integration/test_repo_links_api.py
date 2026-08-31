"""
Integration tests for repo-linking endpoints (Auto-Fix Phase 0).

Endpoints covered:
  GET    /api/repo-links
  POST   /api/repo-links
  DELETE /api/repo-links/<id>
"""
import urllib.error
from unittest.mock import patch, MagicMock
import pytest

VALID_BODY = {
    "site_url": "https://example.com",
    "repo_url": "https://github.com/acme/example-site",
    "access_token": "ghp_test_token",
}


class TestRepoLinksList:
    def test_list_returns_items(self, client, db_mock, authed_headers):
        db_mock.get_repo_links.return_value = [
            {"id": 1, "domain": "example.com", "repo_url": "https://github.com/acme/example-site",
             "default_branch": "main", "framework": "react", "connected_at": "2026-08-01T00:00:00Z"},
        ]
        resp = client.get("/api/repo-links", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["links"]) == 1

    def test_empty_list(self, client, db_mock, authed_headers):
        db_mock.get_repo_links.return_value = []
        resp = client.get("/api/repo-links", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["links"] == []

    def test_no_auth_401(self, client):
        resp = client.get("/api/repo-links")
        assert resp.status_code == 401


class TestRepoLinksCreate:
    def test_create_success(self, client, db_mock, authed_headers):
        db_mock.save_repo_link.return_value = 7
        with patch("urllib.request.urlopen", return_value=MagicMock()) as mock_open:
            resp = client.post("/api/repo-links", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["ok"] is True
        assert data["id"] == 7
        mock_open.assert_called_once()
        db_mock.save_repo_link.assert_called_once()
        args = db_mock.save_repo_link.call_args[0]
        assert args[1] == "example.com"          # domain
        assert args[5] == "react"                 # framework fixed for MVP

    def test_create_missing_fields_400(self, client, authed_headers):
        resp = client.post("/api/repo-links", json={"site_url": "https://example.com"}, headers=authed_headers)
        assert resp.status_code == 400

    def test_create_bad_repo_url_400(self, client, authed_headers):
        body = {**VALID_BODY, "repo_url": "not-a-github-url"}
        resp = client.post("/api/repo-links", json=body, headers=authed_headers)
        assert resp.status_code == 400

    def test_create_github_validation_fails_502(self, client, db_mock, authed_headers):
        err = urllib.error.HTTPError("url", 404, "Not Found", {}, None)
        with patch("urllib.request.urlopen", side_effect=err):
            resp = client.post("/api/repo-links", json=VALID_BODY, headers=authed_headers)
        assert resp.status_code == 502
        assert resp.get_json()["ok"] is False
        db_mock.save_repo_link.assert_not_called()

    def test_no_auth_401(self, client):
        resp = client.post("/api/repo-links", json=VALID_BODY)
        assert resp.status_code == 401


class TestRepoLinksDelete:
    def test_delete_existing(self, client, db_mock, authed_headers):
        db_mock.delete_repo_link.return_value = True
        resp = client.delete("/api/repo-links/1", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_delete_nonexistent_404(self, client, db_mock, authed_headers):
        db_mock.delete_repo_link.return_value = False
        resp = client.delete("/api/repo-links/999", headers=authed_headers)
        assert resp.status_code == 404

    def test_no_auth_401(self, client):
        resp = client.delete("/api/repo-links/1")
        assert resp.status_code == 401
