"""
Unit tests for backend/services/ai_summary_service.py.
Tests generate_and_store_summary, _collect_crawl_context, and _call_claude.
"""
import json
import os
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("MSSQL_CONN_STR", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")


CRAWL_ID = "crawl-test-999"
_UNSET = object()  # sentinel for "use default" vs "explicitly pass None"

SAMPLE_SUMMARY = {
    "overall_health": "Good accessibility foundation.",
    "major_risks": ["Missing alt text on images"],
    "most_affected_areas": ["Navigation"],
    "positive_findings": ["High contrast ratios"],
    "recommended_priorities": ["Fix ARIA labels"],
}

SAMPLE_JOB = {
    "root_url": "https://example.com",
    "total_scanned": 10,
    "total_violations": 5,
    "avg_pass_rate": 92,
    "site_score": 88,
}

SAMPLE_INTEL = {
    "severity_breakdown": {"critical": 0, "serious": 1, "moderate": 2, "minor": 2},
    "top_issue_types": [{"id": "color-contrast", "count": 3}],
    "wcag_principles": {"Perceivable": 2, "Operable": 1},
}


def _make_db(job=_UNSET, intel=_UNSET, regressions=None, cached_summary=None) -> MagicMock:
    m = MagicMock()
    m.get_crawl_job.return_value = SAMPLE_JOB if job is _UNSET else job
    m.get_crawl_ai_summary.return_value = cached_summary
    m.get_crawl_violation_intel.return_value = SAMPLE_INTEL if intel is _UNSET else intel
    m.get_crawl_regressions.return_value = regressions or {"has_comparison": False, "regressions": []}
    m.set_crawl_ai_summary.return_value = None
    return m


def _make_urlopen(response_body: str):
    """Return an urlopen mock that yields response_body as a context-managed response."""
    mock_resp = MagicMock()
    mock_resp.read.return_value = response_body.encode()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return MagicMock(return_value=mock_resp)


def _run(db_mock, urlopen_mock=None, ai_enabled=True, api_key="test-key") -> bool:
    from contextlib import ExitStack
    from backend.services import ai_summary_service

    with ExitStack() as stack:
        stack.enter_context(patch("backend.services.ai_summary_service.db", db_mock))
        cfg = stack.enter_context(patch("backend.services.ai_summary_service.Config"))
        cfg.AI_SUMMARY_ENABLED = ai_enabled
        cfg.ANTHROPIC_API_KEY = api_key
        cfg.AI_SUMMARY_MODEL = "claude-haiku-4-5-20251001"
        if urlopen_mock is not None:
            stack.enter_context(patch("urllib.request.urlopen", urlopen_mock))
        return ai_summary_service.generate_and_store_summary(CRAWL_ID)


# ── generate_and_store_summary ────────────────────────────────────────────────

@pytest.mark.unit
class TestGenerateAndStoreSummary:

    def test_returns_false_when_disabled(self):
        assert _run(_make_db(), ai_enabled=False) is False

    def test_does_not_call_claude_when_disabled(self):
        urlopen = _make_urlopen(json.dumps({"content": [{"text": json.dumps(SAMPLE_SUMMARY)}]}))
        _run(_make_db(), urlopen_mock=urlopen, ai_enabled=False)
        urlopen.assert_not_called()

    def test_returns_true_when_already_cached(self):
        m = _make_db(cached_summary=json.dumps(SAMPLE_SUMMARY))
        assert _run(m) is True

    def test_does_not_call_claude_when_cached(self):
        m = _make_db(cached_summary=json.dumps(SAMPLE_SUMMARY))
        urlopen = _make_urlopen("{}")
        _run(m, urlopen_mock=urlopen)
        urlopen.assert_not_called()

    def test_returns_false_when_crawl_not_found(self):
        m = _make_db(job=None)
        urlopen = _make_urlopen("{}")
        assert _run(m, urlopen_mock=urlopen) is False

    def test_returns_true_on_success(self):
        m = _make_db()
        body = json.dumps({"content": [{"text": json.dumps(SAMPLE_SUMMARY)}]})
        assert _run(m, urlopen_mock=_make_urlopen(body)) is True

    def test_stores_summary_when_successful(self):
        m = _make_db()
        body = json.dumps({"content": [{"text": json.dumps(SAMPLE_SUMMARY)}]})
        _run(m, urlopen_mock=_make_urlopen(body))
        m.set_crawl_ai_summary.assert_called_once()
        stored_arg = m.set_crawl_ai_summary.call_args[0][1]
        assert "overall_health" in stored_arg

    def test_returns_false_on_http_error(self):
        m = _make_db()
        def raise_http(*a, **kw):
            e = urllib.error.HTTPError(url="", code=429, msg="Too Many Requests", hdrs={}, fp=None)
            e.read = lambda: b'{"error": "rate_limit"}'
            raise e
        assert _run(m, urlopen_mock=raise_http) is False
        m.set_crawl_ai_summary.assert_not_called()

    def test_returns_false_on_invalid_claude_json(self):
        m = _make_db()
        body = json.dumps({"content": [{"text": "this is not valid JSON {{{"}]})
        assert _run(m, urlopen_mock=_make_urlopen(body)) is False


# ── _collect_crawl_context ────────────────────────────────────────────────────

@pytest.mark.unit
class TestCollectCrawlContext:

    def _collect(self, db_mock):
        from backend.services import ai_summary_service
        with patch("backend.services.ai_summary_service.db", db_mock):
            return ai_summary_service._collect_crawl_context(CRAWL_ID)

    def test_returns_none_when_job_not_found(self):
        assert self._collect(_make_db(job=None)) is None

    def test_returns_dict_on_success(self):
        assert isinstance(self._collect(_make_db()), dict)

    def test_includes_core_fields(self):
        result = self._collect(_make_db())
        for key in ("root_url", "total_scanned", "total_violations", "avg_pass_rate", "site_score"):
            assert key in result

    def test_includes_severity_breakdown(self):
        assert "severity_breakdown" in self._collect(_make_db())

    def test_top_issue_types_capped_at_5(self):
        intel = {
            **SAMPLE_INTEL,
            "top_issue_types": [{"id": f"rule-{i}"} for i in range(10)],
        }
        result = self._collect(_make_db(intel=intel))
        assert len(result["top_issue_types"]) <= 5

    def test_regression_count_none_when_no_comparison(self):
        m = _make_db(regressions={"has_comparison": False, "regressions": []})
        assert self._collect(m)["regression_count"] is None

    def test_regression_count_set_when_comparison_exists(self):
        m = _make_db(regressions={
            "has_comparison": True,
            "regressions": [{"url": "a"}, {"url": "b"}],
        })
        assert self._collect(m)["regression_count"] == 2


# ── _call_claude ──────────────────────────────────────────────────────────────

@pytest.mark.unit
class TestCallClaude:

    def _call(self, urlopen_mock):
        from backend.services import ai_summary_service
        with patch("urllib.request.urlopen", urlopen_mock), \
             patch("backend.services.ai_summary_service.Config") as cfg:
            cfg.AI_SUMMARY_MODEL = "claude-haiku-4-5-20251001"
            cfg.ANTHROPIC_API_KEY = "test-key"
            return ai_summary_service._call_claude({"root_url": "https://example.com"})

    def test_returns_dict_on_success(self):
        body = json.dumps({"content": [{"text": json.dumps(SAMPLE_SUMMARY)}]})
        result = self._call(_make_urlopen(body))
        assert isinstance(result, dict)
        assert "overall_health" in result

    def test_returns_none_on_http_error(self):
        def raise_http(*a, **kw):
            e = urllib.error.HTTPError(url="", code=500, msg="Server Error", hdrs={}, fp=None)
            e.read = lambda: b'{"error":"internal"}'
            raise e
        assert self._call(raise_http) is None

    def test_returns_none_on_invalid_json_in_text(self):
        body = json.dumps({"content": [{"text": "not valid json {{{"}]})
        assert self._call(_make_urlopen(body)) is None

    def test_returns_none_on_connection_error(self):
        def raise_conn(*a, **kw):
            raise ConnectionError("timeout")
        assert self._call(raise_conn) is None

    def test_sends_api_key_header(self):
        body = json.dumps({"content": [{"text": json.dumps(SAMPLE_SUMMARY)}]})
        urlopen = _make_urlopen(body)
        self._call(urlopen)
        urlopen.assert_called_once()
        req = urlopen.call_args[0][0]
        # urllib.request.Request stores headers as a dict
        assert req.get_header("X-api-key") == "test-key"
