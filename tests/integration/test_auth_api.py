"""
Integration tests for authentication API endpoints.

Endpoints covered:
  POST /api/auth/register
  POST /api/auth/login
  GET  /api/auth/verify-email
  POST /api/auth/resend-verification
  GET  /api/auth/me
  POST /api/auth/logout

Every test uses the Flask test_client — no running server, no real DB.
The db mock is patched at the module level (see conftest.py).
"""
import json
from unittest.mock import patch, MagicMock
import pytest
import bcrypt

from tests.conftest import (
    FAKE_USER, make_token, make_expired_token,
    auth_headers, TEST_JWT_SECRET, TEST_USER_ID, TEST_USER_EMAIL,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _post(client, url, body):
    return client.post(url, json=body)


def _get(client, url, headers=None, query=None):
    return client.get(url, headers=headers or {}, query_string=query or {})


# ── /api/auth/register ────────────────────────────────────────────────────────

class TestRegister:
    def test_success_returns_201(self, client, db_mock):
        db_mock.create_user.return_value = FAKE_USER
        db_mock.get_user_by_email.return_value = None  # not yet registered
        with patch("app.send_verification_email"):
            resp = _post(client, "/api/auth/register", {
                "firstName": "Alice",
                "lastName":  "Smith",
                "email":     "alice@example.com",
                "password":  "SecurePass123",
            })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["ok"] is True
        assert data["requiresVerification"] is True

    def test_missing_first_name_400(self, client):
        resp = _post(client, "/api/auth/register", {
            "lastName": "Smith",
            "email":    "alice@example.com",
            "password": "SecurePass123",
        })
        assert resp.status_code == 400
        assert resp.get_json()["ok"] is False

    def test_missing_last_name_400(self, client):
        resp = _post(client, "/api/auth/register", {
            "firstName": "Alice",
            "email":     "alice@example.com",
            "password":  "SecurePass123",
        })
        assert resp.status_code == 400

    def test_invalid_email_400(self, client):
        resp = _post(client, "/api/auth/register", {
            "firstName": "Alice",
            "lastName":  "Smith",
            "email":     "not-an-email",
            "password":  "SecurePass123",
        })
        assert resp.status_code == 400

    def test_password_too_short_400(self, client):
        resp = _post(client, "/api/auth/register", {
            "firstName": "Alice",
            "lastName":  "Smith",
            "email":     "alice@example.com",
            "password":  "short",
        })
        assert resp.status_code == 400
        assert "8" in resp.get_json()["error"]

    def test_duplicate_email_409(self, client, db_mock):
        db_mock.create_user.side_effect = ValueError("email_already_registered")
        with patch("app.send_verification_email"):
            resp = _post(client, "/api/auth/register", {
                "firstName": "Alice",
                "lastName":  "Smith",
                "email":     "existing@example.com",
                "password":  "SecurePass123",
            })
        assert resp.status_code == 409
        db_mock.create_user.side_effect = None

    def test_db_unavailable_returns_503(self, client, db_mock):
        db_mock.is_ready.return_value = False
        resp = _post(client, "/api/auth/register", {
            "firstName": "Alice",
            "lastName":  "Smith",
            "email":     "alice@example.com",
            "password":  "SecurePass123",
        })
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True

    def test_empty_password_field_400(self, client):
        resp = _post(client, "/api/auth/register", {
            "firstName": "Alice",
            "lastName":  "Smith",
            "email":     "alice@example.com",
            "password":  "",
        })
        assert resp.status_code == 400

    def test_email_normalised_to_lowercase(self, client, db_mock):
        captured = {}
        def _capture_create(fn, ln, email, ph):
            captured["email"] = email
            return FAKE_USER
        db_mock.create_user.side_effect = _capture_create
        with patch("app.send_verification_email"), \
             patch("app.db.set_verify_token"):
            _post(client, "/api/auth/register", {
                "firstName": "Alice",
                "lastName":  "Smith",
                "email":     "ALICE@EXAMPLE.COM",
                "password":  "SecurePass123",
            })
        assert captured.get("email") == "alice@example.com"
        db_mock.create_user.side_effect = None


# ── /api/auth/login ───────────────────────────────────────────────────────────

class TestLogin:
    def _valid_user_mock(self, db_mock):
        password_hash = bcrypt.hashpw(b"SecurePass123", bcrypt.gensalt()).decode()
        user = {**FAKE_USER, "passwordHash": password_hash, "emailVerified": True, "isActive": True}
        db_mock.get_user_by_email.return_value = user

    def test_success_returns_token(self, client, db_mock):
        self._valid_user_mock(db_mock)
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL,
            "password": "SecurePass123",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert "token" in data
        assert data["user"]["email"] == TEST_USER_EMAIL

    def test_wrong_password_401(self, client, db_mock):
        self._valid_user_mock(db_mock)
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL,
            "password": "WrongPassword!",
        })
        assert resp.status_code == 401
        assert resp.get_json()["ok"] is False

    def test_unknown_email_401(self, client, db_mock):
        db_mock.get_user_by_email.return_value = None
        resp = _post(client, "/api/auth/login", {
            "email":    "nobody@example.com",
            "password": "AnyPass123",
        })
        assert resp.status_code == 401

    def test_email_not_verified_403(self, client, db_mock):
        password_hash = bcrypt.hashpw(b"SecurePass123", bcrypt.gensalt()).decode()
        db_mock.get_user_by_email.return_value = {
            **FAKE_USER,
            "passwordHash":  password_hash,
            "emailVerified": False,
            "isActive":      True,
        }
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL,
            "password": "SecurePass123",
        })
        assert resp.status_code == 403
        assert resp.get_json()["error"] == "email_not_verified"

    def test_inactive_account_403(self, client, db_mock):
        password_hash = bcrypt.hashpw(b"SecurePass123", bcrypt.gensalt()).decode()
        db_mock.get_user_by_email.return_value = {
            **FAKE_USER,
            "passwordHash": password_hash,
            "isActive":     False,
        }
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL,
            "password": "SecurePass123",
        })
        assert resp.status_code == 403

    def test_missing_email_field_400(self, client):
        resp = _post(client, "/api/auth/login", {"password": "SecurePass123"})
        assert resp.status_code == 400

    def test_missing_password_field_400(self, client):
        resp = _post(client, "/api/auth/login", {"email": TEST_USER_EMAIL})
        assert resp.status_code == 400

    def test_db_unavailable_503(self, client, db_mock):
        db_mock.is_ready.return_value = False
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL,
            "password": "SecurePass123",
        })
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True

    def test_token_is_valid_jwt(self, client, db_mock):
        import jwt as _jwt
        self._valid_user_mock(db_mock)
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL,
            "password": "SecurePass123",
        })
        token = resp.get_json()["token"]
        payload = _jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert payload["email"] == TEST_USER_EMAIL

    def test_login_with_uppercase_email(self, client, db_mock):
        self._valid_user_mock(db_mock)
        resp = _post(client, "/api/auth/login", {
            "email":    TEST_USER_EMAIL.upper(),
            "password": "SecurePass123",
        })
        assert resp.status_code == 200


# ── /api/auth/verify-email ────────────────────────────────────────────────────

class TestVerifyEmail:
    def test_valid_token_success(self, client, db_mock):
        db_mock.get_user_by_verify_token.return_value = FAKE_USER
        resp = _get(client, "/api/auth/verify-email", query={"token": "abc123valid"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert "token" in data

    def test_invalid_token_400(self, client, db_mock):
        db_mock.get_user_by_verify_token.return_value = None
        resp = _get(client, "/api/auth/verify-email", query={"token": "bad-token"})
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "token_invalid"

    def test_missing_token_400(self, client):
        resp = _get(client, "/api/auth/verify-email")
        assert resp.status_code == 400

    def test_db_unavailable_503(self, client, db_mock):
        db_mock.is_ready.return_value = False
        resp = _get(client, "/api/auth/verify-email", query={"token": "tok"})
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True

    def test_marks_email_verified(self, client, db_mock):
        db_mock.get_user_by_verify_token.return_value = FAKE_USER
        _get(client, "/api/auth/verify-email", query={"token": "abc123"})
        db_mock.mark_email_verified.assert_called_once_with(TEST_USER_ID)


# ── /api/auth/resend-verification ─────────────────────────────────────────────

class TestResendVerification:
    def test_always_returns_ok_for_valid_email(self, client, db_mock):
        db_mock.get_user_by_email.return_value = {
            **FAKE_USER, "emailVerified": False, "isActive": True
        }
        db_mock.get_verify_token_issued_at.return_value = None
        with patch("app.send_verification_email"):
            resp = _post(client, "/api/auth/resend-verification", {"email": TEST_USER_EMAIL})
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_returns_ok_for_unknown_email_no_enumeration(self, client, db_mock):
        db_mock.get_user_by_email.return_value = None
        resp = _post(client, "/api/auth/resend-verification", {"email": "ghost@example.com"})
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_returns_ok_for_already_verified(self, client, db_mock):
        db_mock.get_user_by_email.return_value = {**FAKE_USER, "emailVerified": True}
        resp = _post(client, "/api/auth/resend-verification", {"email": TEST_USER_EMAIL})
        assert resp.status_code == 200

    def test_returns_ok_for_invalid_email_format(self, client):
        resp = _post(client, "/api/auth/resend-verification", {"email": "not-an-email"})
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True


# ── /api/auth/me ──────────────────────────────────────────────────────────────

class TestAuthMe:
    def test_returns_user_with_valid_token(self, client, db_mock, authed_headers):
        db_mock.get_user_by_id.return_value = FAKE_USER
        resp = _get(client, "/api/auth/me", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["user"]["email"] == TEST_USER_EMAIL

    def test_no_token_401(self, client):
        resp = _get(client, "/api/auth/me")
        assert resp.status_code == 401
        assert resp.get_json()["error"] == "missing_token"

    def test_expired_token_401(self, client, db_mock, expired_token):
        resp = _get(client, "/api/auth/me", headers=auth_headers(expired_token))
        assert resp.status_code == 401
        assert resp.get_json()["error"] == "token_expired"

    def test_invalid_token_401(self, client):
        resp = _get(client, "/api/auth/me", headers={"Authorization": "Bearer garbage.token.here"})
        assert resp.status_code == 401
        assert resp.get_json()["error"] == "invalid_token"

    def test_missing_bearer_prefix_401(self, client):
        resp = _get(client, "/api/auth/me", headers={"Authorization": make_token()})
        assert resp.status_code == 401

    def test_user_not_found_404(self, client, db_mock, authed_headers):
        db_mock.get_user_by_id.return_value = None
        resp = _get(client, "/api/auth/me", headers=authed_headers)
        assert resp.status_code == 404


# ── /api/auth/logout ──────────────────────────────────────────────────────────

class TestLogout:
    def test_logout_with_valid_token(self, client, authed_headers):
        resp = client.post("/api/auth/logout", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_logout_without_token_401(self, client):
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 401

    def test_logout_with_expired_token_401(self, client, expired_token):
        resp = client.post("/api/auth/logout", headers=auth_headers(expired_token))
        assert resp.status_code == 401
