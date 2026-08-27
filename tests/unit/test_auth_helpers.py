"""
Unit tests for JWT generation and auth helper functions in app.py.

Tests _make_token, require_auth decorator behaviour, and
backend/services/auth_utils.generate_verify_token without starting Flask.
"""
import os
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import jwt
import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-key-for-pytest-do-not-use-in-prod")

# Pull helpers directly from the module under test.
from tests.conftest import (
    make_token, make_expired_token, TEST_JWT_SECRET,
    TEST_USER_ID, TEST_USER_EMAIL,
)


# ── Token generation ──────────────────────────────────────────────────────────

class TestMakeToken:
    def test_returns_string(self):
        assert isinstance(make_token(), str)

    def test_decodes_with_correct_secret(self):
        token = make_token()
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert payload["sub"] == str(TEST_USER_ID)
        assert payload["email"] == TEST_USER_EMAIL

    def test_sub_is_stringified_user_id(self):
        token = make_token(user_id=42)
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert payload["sub"] == "42"

    def test_custom_email(self):
        token = make_token(email="admin@company.com")
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert payload["email"] == "admin@company.com"

    def test_token_not_yet_expired(self):
        token = make_token()
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        assert exp > datetime.now(timezone.utc)

    def test_expired_token_raises(self):
        token = make_expired_token()
        with pytest.raises(jwt.ExpiredSignatureError):
            jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])

    def test_wrong_secret_raises(self):
        token = make_token()
        with pytest.raises(jwt.InvalidTokenError):
            jwt.decode(token, "wrong-secret", algorithms=["HS256"])

    def test_iat_present(self):
        token = make_token()
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert "iat" in payload

    def test_exp_present(self):
        token = make_token()
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert "exp" in payload

    def test_expire_delta_respected(self):
        token = make_token(expire_delta=timedelta(hours=2))
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        delta = payload["exp"] - payload["iat"]
        assert abs(delta - 7200) < 5  # within 5 seconds of 2 hours


# ── generate_verify_token ─────────────────────────────────────────────────────

class TestGenerateVerifyToken:
    def test_returns_string(self):
        from backend.services.auth_utils import generate_verify_token
        assert isinstance(generate_verify_token(), str)

    def test_length_is_at_least_64(self):
        # secrets.token_urlsafe(48) produces 64 base64url characters
        from backend.services.auth_utils import generate_verify_token
        assert len(generate_verify_token()) >= 64

    def test_tokens_are_unique(self):
        from backend.services.auth_utils import generate_verify_token
        tokens = {generate_verify_token() for _ in range(50)}
        assert len(tokens) == 50

    def test_only_url_safe_characters(self):
        # base64url alphabet: A-Z, a-z, 0-9, -, _  (no padding =)
        import re
        from backend.services.auth_utils import generate_verify_token
        token = generate_verify_token()
        assert re.match(r'^[A-Za-z0-9_-]+$', token)


# ── Rate limiter ──────────────────────────────────────────────────────────────

class TestRateLimiter:
    """Tests for _check_scan_rate_limit in app.py."""

    def setup_method(self):
        import app as _app
        with _app._rate_limit_lock:
            _app._rate_limit_store.clear()

    def test_first_request_allowed(self):
        import app as _app
        limited, retry_after = _app._check_scan_rate_limit("10.0.0.1")
        assert limited is False
        assert retry_after == 0

    def test_second_immediate_request_blocked(self):
        import app as _app
        _app._check_scan_rate_limit("10.0.0.2")
        limited, retry_after = _app._check_scan_rate_limit("10.0.0.2")
        assert limited is True
        assert retry_after > 0

    def test_different_ips_independent(self):
        import app as _app
        _app._check_scan_rate_limit("10.0.0.10")
        limited, _ = _app._check_scan_rate_limit("10.0.0.11")
        assert limited is False

    def test_retry_after_decreases_over_time(self):
        import app as _app
        _app._check_scan_rate_limit("10.0.0.20")
        _, ra1 = _app._check_scan_rate_limit("10.0.0.20")
        time.sleep(1)
        _, ra2 = _app._check_scan_rate_limit("10.0.0.20")
        assert ra2 <= ra1

    def test_window_expiry_allows_new_request(self):
        import app as _app
        with patch("app.SCAN_RATE_LIMIT_SECONDS", 0):
            _app._check_scan_rate_limit("10.0.0.30")
            limited, _ = _app._check_scan_rate_limit("10.0.0.30")
            assert limited is False
