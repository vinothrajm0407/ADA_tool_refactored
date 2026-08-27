"""
Central test configuration and fixtures for the ADA accessibility tool.

Strategy:
- `app.py` is imported once at module level (with empty MSSQL/Redis so init_db
  and scheduler are no-ops).  Then per-test, we patch `app.db` (the name bound
  inside app.py) and `Config.JWT_SECRET` to point at our mocks.
- Flask test_client() for all API tests — no running server needed.
- JWT tokens are generated with the same HS256 algorithm as production.
- Rate-limit store is cleared between tests via autouse fixture.
"""
import os
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, patch as _patch

import jwt
import pytest

# ── Force test environment BEFORE any app import ─────────────────────────────
os.environ["JWT_SECRET"]        = "test-secret-key-for-pytest-do-not-use-in-prod"
os.environ["APP_ENV"]           = "testing"
os.environ["MSSQL_CONN_STR"]   = ""   # disable DB connection
os.environ["REDIS_URL"]         = ""   # disable Redis
os.environ["ANTHROPIC_API_KEY"] = ""   # disable Claude
os.environ["SMTP_ENABLED"]      = "false"
os.environ["SCHEDULER_ENABLED"] = "false"  # don't start daemon thread

# ── Import app once; init_db() + scheduler are no-ops with empty env vars ─────
import services.db as _real_db      # registers db on services package
import app as _app_module           # imports with empty config

# ── Shared constants ──────────────────────────────────────────────────────────
TEST_JWT_SECRET = "test-secret-key-for-pytest-do-not-use-in-prod"
TEST_USER_ID    = 1
TEST_USER_EMAIL = "test@example.com"

FAKE_USER = {
    "id":            TEST_USER_ID,
    "firstName":     "Test",
    "lastName":      "User",
    "email":         TEST_USER_EMAIL,
    "passwordHash":  "$2b$12$KIX1yB4JZ1K2Z3L4M5N6OO1234567890abcdefghijklmnopqrstuv",
    "emailVerified": True,
    "isActive":      True,
    "createdAt":     "2026-01-01T00:00:00Z",
}


# ── Token helpers ─────────────────────────────────────────────────────────────

def make_token(user_id: int = TEST_USER_ID, email: str = TEST_USER_EMAIL,
               expire_delta: timedelta = timedelta(hours=24)) -> str:
    """Generate a valid HS256 JWT matching the production _make_token() shape."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub":   str(user_id),
        "email": email,
        "iat":   now,
        "exp":   now + expire_delta,
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def make_expired_token(user_id: int = TEST_USER_ID, email: str = TEST_USER_EMAIL) -> str:
    return make_token(user_id, email, expire_delta=timedelta(hours=-1))


def auth_headers(token: str = None) -> dict:
    return {"Authorization": f"Bearer {token or make_token()}"}


# ── DB mock factory ───────────────────────────────────────────────────────────

def build_db_mock() -> MagicMock:
    m = MagicMock()
    m.is_ready.return_value       = True
    m.is_enabled.return_value     = True
    m.init_error.return_value     = ""
    m.get_user_by_email.return_value = FAKE_USER
    m.get_user_by_id.return_value    = FAKE_USER
    m.get_user_by_verify_token.return_value = None
    m.create_user.return_value    = FAKE_USER
    m.get_scan_history.return_value   = []
    m.get_scan_result.return_value    = None
    m.get_prev_scan_summary_for_url.return_value = None
    m.get_scan_trends.return_value    = {"data": [], "summary": {}}
    m.get_assistive_scans.return_value = []
    m.save_assistive_scan.return_value = 1
    m.get_all_crawl_jobs.return_value  = []
    m.get_crawl_violation_intel.return_value = {}
    m.get_crawl_regressions.return_value     = {}
    m.compare_crawls.return_value            = None
    m.get_crawl_score_timeline.return_value  = []
    m.get_crawl_schedules.return_value       = []
    m.create_crawl_schedule.return_value     = {"id": 1, "url": "https://example.com", "frequency": "weekly"}
    m.update_crawl_schedule.return_value     = True
    m.delete_crawl_schedule.return_value     = True
    m.get_crawl_schedule.return_value        = {"id": 1, "root_url": "https://example.com", "frequency": "weekly",
                                                 "enabled": True, "name": None, "time_of_day": None}
    m.has_active_crawl_for_url.return_value  = False
    m.get_active_crawl_id_for_url.return_value = None
    m.get_schedule_runs.return_value         = []
    m.parse_time_of_day.side_effect          = lambda v: v or None
    m.get_crawl_ai_summary.return_value      = None
    m.get_alerts.return_value                = []
    m.get_unacknowledged_alert_count.return_value = 0
    m.acknowledge_alert.return_value         = True
    m.get_page_trends.return_value           = {"has_comparison": False}
    m.get_violation_intel.return_value       = {
        "severity_breakdown": {"critical": 0, "serious": 0, "moderate": 0, "minor": 0},
        "top_issue_types":    [],
        "wcag_breakdown":     [],
    }
    m.get_regression_candidates.return_value = []
    m.set_verify_token.return_value          = None
    m.mark_email_verified.return_value       = None
    m.get_verify_token_issued_at.return_value = None
    return m


# ── App fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture()
def db_mock():
    """Fresh DB mock per test."""
    return build_db_mock()


@pytest.fixture()
def app(db_mock):
    """
    Flask test app with:
    - app.db patched to db_mock (covers all db.xxx calls in app.py)
    - Config.JWT_SECRET patched to TEST_JWT_SECRET
    """
    _app_module.app.config["TESTING"] = True
    with patch.object(_app_module, "db", db_mock), \
         patch.object(_app_module.Config, "JWT_SECRET", TEST_JWT_SECRET):
        yield _app_module.app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def clear_rate_limit():
    """Reset in-process rate-limit store before every test."""
    with _app_module._rate_limit_lock:
        _app_module._rate_limit_store.clear()
    yield


# ── Convenience fixtures ──────────────────────────────────────────────────────

@pytest.fixture()
def token():
    return make_token()


@pytest.fixture()
def expired_token():
    return make_expired_token()


@pytest.fixture()
def authed_headers(token):
    return auth_headers(token)


@pytest.fixture()
def fresh_db_mock():
    return build_db_mock()
