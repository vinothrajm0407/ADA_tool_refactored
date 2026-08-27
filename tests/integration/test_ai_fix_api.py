"""
Integration tests for the AI fix endpoint.

Endpoint covered:
  POST /api/ai-fix

Tests the mock path (no API key) and the real call path
(Claude API mocked via urllib.request.urlopen).
"""
import json
from unittest.mock import patch, MagicMock
import pytest

from tests.conftest import auth_headers


FAKE_VIOLATION = {
    "id":          "color-contrast",
    "impact":      "serious",
    "description": "Elements must have sufficient color contrast",
    "help":        "Ensure the contrast ratio of text to background meets WCAG requirements",
    "helpUrl":     "https://dequeuniversity.com/rules/axe/4.7/color-contrast",
    "nodes": [
        {"html": '<p style="color:#767676">Sample text</p>'},
    ],
}


# ── No API key (mock response) ────────────────────────────────────────────────

class TestAIFixNoApiKey:
    def test_returns_mock_fix_when_no_key(self, client, authed_headers):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}):
            resp = client.post("/api/ai-fix",
                               json={"violation": FAKE_VIOLATION, "framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert "explanation" in data
        assert "before" in data
        assert "after" in data

    def test_missing_violation_400(self, client, authed_headers):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}):
            resp = client.post("/api/ai-fix",
                               json={"framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 400

    def test_violation_without_id_400(self, client, authed_headers):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}):
            resp = client.post("/api/ai-fix",
                               json={"violation": {"description": "no id"}, "framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 400

    def test_no_auth_401(self, client):
        resp = client.post("/api/ai-fix",
                           json={"violation": FAKE_VIOLATION})
        assert resp.status_code == 401

    def test_non_json_400(self, client, authed_headers):
        resp = client.post("/api/ai-fix",
                           data="violation=test",
                           content_type="text/plain",
                           headers=authed_headers)
        assert resp.status_code == 400


# ── With API key (Claude mocked) ──────────────────────────────────────────────

class TestAIFixWithApiKey:
    def _mock_claude_response(self, fix_json: dict):
        """Return a mock that urllib.urlopen will return."""
        mock_resp = MagicMock()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_resp.read.return_value = json.dumps({
            "content": [{"text": json.dumps(fix_json)}]
        }).encode()
        return mock_resp

    def test_returns_ai_fix_data(self, client, authed_headers):
        fix = {
            "explanation":   "Text color lacks sufficient contrast against the background.",
            "wcagCriterion": "WCAG 2.1 Success Criterion 1.4.3 - Contrast (Minimum) (Level AA)",
            "before":        '<p style="color:#767676">Text</p>',
            "after":         '<p style="color:#595959">Text</p>',
        }
        mock_resp = self._mock_claude_response(fix)
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"}), \
             patch("urllib.request.urlopen", return_value=mock_resp):
            resp = client.post("/api/ai-fix",
                               json={"violation": FAKE_VIOLATION, "framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["explanation"] == fix["explanation"]
        assert data["before"] == fix["before"]
        assert data["after"] == fix["after"]

    def test_framework_react_accepted(self, client, authed_headers):
        fix = {
            "explanation": "Missing label.",
            "wcagCriterion": "WCAG 2.1 1.3.1",
            "before": "<input />",
            "after":  '<label htmlFor="x">Email</label><input id="x" />',
        }
        mock_resp = self._mock_claude_response(fix)
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"}), \
             patch("urllib.request.urlopen", return_value=mock_resp):
            resp = client.post("/api/ai-fix",
                               json={"violation": FAKE_VIOLATION, "framework": "react"},
                               headers=authed_headers)
        assert resp.status_code == 200

    def test_claude_http_error_returns_502(self, client, authed_headers):
        import urllib.error
        http_err = urllib.error.HTTPError(
            url="https://api.anthropic.com/v1/messages",
            code=429,
            msg="Too Many Requests",
            hdrs=None,
            fp=None,
        )
        http_err.read = lambda: b'{"error": "rate_limit"}'
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"}), \
             patch("urllib.request.urlopen", side_effect=http_err):
            resp = client.post("/api/ai-fix",
                               json={"violation": FAKE_VIOLATION, "framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 502

    def test_claude_returns_invalid_json_502(self, client, authed_headers):
        mock_resp = MagicMock()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_resp.read.return_value = json.dumps({
            "content": [{"text": "This is not JSON at all, just prose."}]
        }).encode()
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"}), \
             patch("urllib.request.urlopen", return_value=mock_resp):
            resp = client.post("/api/ai-fix",
                               json={"violation": FAKE_VIOLATION, "framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 502

    def test_network_error_500(self, client, authed_headers):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"}), \
             patch("urllib.request.urlopen", side_effect=ConnectionError("timeout")):
            resp = client.post("/api/ai-fix",
                               json={"violation": FAKE_VIOLATION, "framework": "html"},
                               headers=authed_headers)
        assert resp.status_code == 500
