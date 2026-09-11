"""
Flask app: serves the built React UI and provides API routes.
ADA check runs in-process using axe-playwright-python (Playwright + axe-core).

- Local:    python app.py              (Flask dev server, port 5000)
- Production (e.g. Azure): gunicorn app:app   (Gunicorn runs this Flask app)

Setup: pip install -r requirements.txt  # includes axe-playwright-python
       python -m playwright install chromium
Run:   npm run build && python app.py
"""
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.request
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
import bcrypt
import jwt
from croniter import croniter
from flask import Flask, Response, jsonify, g, request, send_from_directory
from config import Config
from services.url_processor import (
    run_keyboard_assisted_test,
    run_color_contrast_assisted_test,
    run_page_structure_assisted_test,
    run_forms_accessibility_test,
)
from services import db
from backend.services import create_scan_job, get_scan_status
from backend.services.scan_service import get_queue_service
from backend.services.auth_utils import generate_verify_token
from backend.services.email_service import send_verification_email, send_password_reset_email
from backend.services.crawl_service import (
    create_crawl_job,
    get_crawl_status,
    get_crawl_pages,
    cancel_crawl_job,
)

# Create database and table automatically if MSSQL_CONN_STR is set (Azure, AWS, or local)
db.init_db()

# Phase 3: start background crawl scheduler (daemon thread, no-op if disabled)
from backend.services.scheduler_service import start_scheduler as _start_scheduler
_start_scheduler()

logging.basicConfig(level=logging.INFO)

app = Flask(__name__, static_folder=None)

# Directory containing the built React app (npm run build)
DIST = Path(__file__).resolve().parent / "dist"

# Minimum seconds between scan submissions from the same IP.
# NOTE: In-process only — not shared across Gunicorn workers, which is
# acceptable for an internal tool.
SCAN_RATE_LIMIT_SECONDS = 15
_rate_limit_store: dict[str, float] = {}
_rate_limit_lock = threading.Lock()


def _check_scan_rate_limit(ip: str) -> tuple[bool, int]:
    """Return (is_limited, retry_after_seconds) for the given client IP.

    On the first call from an IP (or after the window expires) the timestamp
    is recorded and (False, 0) is returned.  Subsequent calls within the window
    return (True, seconds_remaining).
    """
    now = time.monotonic()
    with _rate_limit_lock:
        elapsed = now - _rate_limit_store.get(ip, 0.0)
        if elapsed < SCAN_RATE_LIMIT_SECONDS:
            return True, int(SCAN_RATE_LIMIT_SECONDS - elapsed) + 1
        _rate_limit_store[ip] = now
        # Lazy eviction: remove entries older than 2× the window
        cutoff = now - SCAN_RATE_LIMIT_SECONDS * 2
        expired = [k for k, v in _rate_limit_store.items() if v < cutoff]
        for k in expired:
            del _rate_limit_store[k]
        return False, 0


def _get_request_id() -> str:
    return getattr(g, "request_id", None) or uuid.uuid4().hex


@app.before_request
def attach_request_id():
    g.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex


@app.before_request
def handle_preflight():
    """Answer OPTIONS preflight requests from the browser extension."""
    if request.method != "OPTIONS":
        return
    origin = request.headers.get("Origin", "")
    if _is_allowed_origin(origin):
        resp = Response()
        _set_cors_headers(resp, origin)
        return resp, 204


@app.after_request
def add_request_id_header(response: Response):
    response.headers["X-Request-ID"] = _get_request_id()
    # Attach CORS headers to every response so the extension popup can read them.
    origin = request.headers.get("Origin", "")
    if _is_allowed_origin(origin):
        _set_cors_headers(response, origin)
    return response


# ── CORS helpers ────────────────────────────────────────────────────────
# Allow the Vite dev server and any Chrome extension origin.
# In production, restrict _ALLOWED_ORIGINS to your deployed domain.
_ALLOWED_ORIGINS: set[str] = {
    "http://localhost:5173",   # Vite dev server (web app)
    "http://localhost:5000",   # Flask dev server (same-origin API calls)
}


def _is_allowed_origin(origin: str) -> bool:
    return origin in _ALLOWED_ORIGINS or origin.startswith("chrome-extension://")


def _set_cors_headers(response: Response, origin: str) -> None:
    response.headers["Access-Control-Allow-Origin"]      = origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"]     = (
        "Content-Type, Authorization, X-Request-ID"
    )
    response.headers["Access-Control-Allow-Methods"] = (
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    )


def _queue_health() -> dict:
    try:
        queue = get_queue_service()
        return queue.health_check()
    except Exception as exc:
        logging.warning("Queue health check failed: %s", exc)
        return {
            "backend": "unavailable",
            "connected": False,
            "queue_name": None,
            "redis_url": None,
            "error": str(exc),
        }


def _history_unavailable_payload() -> dict:
    reason = db.init_error() or "Database persistence is not configured"
    return {
        "ok": True,
        "available": False,
        "items": [],
        "message": (
            "Scan history is unavailable until MSSQL is configured. "
            f"Reason: {reason}"
        ),
    }


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _make_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=Config.JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm="HS256")


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"ok": False, "error": "missing_token"}), 401
        token = auth_header[7:].strip()
        try:
            payload = jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return jsonify({"ok": False, "error": "token_expired"}), 401
        except jwt.InvalidTokenError as exc:
            logging.warning("JWT decode failed | error=%s | token_prefix=%s", exc, token[:30])
            return jsonify({"ok": False, "error": "invalid_token"}), 401
        g.current_user_id = int(payload["sub"])
        g.current_user_email = payload["email"]
        return f(*args, **kwargs)
    return decorated


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    data = request.get_json(silent=True) or {}
    first_name = (data.get("firstName") or "").strip()
    last_name  = (data.get("lastName") or "").strip()
    email      = (data.get("email") or "").strip().lower()
    password   = data.get("password") or ""

    if not first_name or not last_name:
        return jsonify({"ok": False, "error": "First name and last name are required"}), 400
    if not email or "@" not in email:
        return jsonify({"ok": False, "error": "A valid email address is required"}), 400
    if len(password) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        user = db.create_user(first_name, last_name, email, password_hash)
    except ValueError as e:
        if "email_already_registered" in str(e):
            return jsonify({"ok": False, "error": "An account with this email already exists"}), 409
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Registration failed: %s", e)
        return jsonify({"ok": False, "error": "Registration failed"}), 500

    # Generate and store verification token
    verify_token  = generate_verify_token()
    expiry_hours  = Config.EMAIL_VERIFY_EXPIRE_HOURS
    expiry_utc    = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    db.set_verify_token(user["id"], verify_token, expiry_utc)
    send_verification_email(user, verify_token, expiry_hours)

    return jsonify({"ok": True, "requiresVerification": True}), 201


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"ok": False, "error": "Email and password are required"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    user = db.get_user_by_email(email)
    if not user:
        return jsonify({"ok": False, "error": "Invalid email or password"}), 401
    if not user["isActive"]:
        return jsonify({"ok": False, "error": "Account is inactive"}), 403
    if not bcrypt.checkpw(password.encode(), user["passwordHash"].encode()):
        return jsonify({"ok": False, "error": "Invalid email or password"}), 401
    if not user["emailVerified"]:
        return jsonify({"ok": False, "error": "email_not_verified"}), 403

    token = _make_token(user["id"], user["email"])
    return jsonify({"ok": True, "token": token, "user": {
        "id": user["id"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
        "emailVerified": True,
    }})


@app.route("/api/auth/verify-email", methods=["GET"])
def api_auth_verify_email():
    token = (request.args.get("token") or "").strip()
    if not token:
        return jsonify({"ok": False, "error": "token_invalid"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    user = db.get_user_by_verify_token(token)
    if not user:
        return jsonify({"ok": False, "error": "token_invalid"}), 400

    db.mark_email_verified(user["id"])
    jwt_token = _make_token(user["id"], user["email"])
    return jsonify({"ok": True, "token": jwt_token, "user": {
        "id": user["id"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
        "emailVerified": True,
    }})


@app.route("/api/auth/resend-verification", methods=["POST"])
def api_auth_resend_verification():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    # Always return success to prevent email enumeration
    _GENERIC_OK = jsonify({"ok": True, "message": "If that address is registered, a new verification link has been sent."})

    if not email or "@" not in email:
        return _GENERIC_OK

    if not db.is_ready():
        return _GENERIC_OK

    user = db.get_user_by_email(email)
    if not user or not user["isActive"] or user["emailVerified"]:
        return _GENERIC_OK

    # Rate-limit: reject if a token was issued less than 60 seconds ago
    existing_expiry = db.get_verify_token_issued_at(user["id"])
    if existing_expiry:
        issued_at_estimate = existing_expiry - timedelta(hours=Config.EMAIL_VERIFY_EXPIRE_HOURS)
        if (datetime.now(timezone.utc) - issued_at_estimate.replace(tzinfo=timezone.utc)).total_seconds() < 60:
            return _GENERIC_OK

    verify_token = generate_verify_token()
    expiry_hours = Config.EMAIL_VERIFY_EXPIRE_HOURS
    expiry_utc   = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    db.set_verify_token(user["id"], verify_token, expiry_utc)
    send_verification_email(user, verify_token, expiry_hours)
    return _GENERIC_OK


@app.route("/api/auth/forgot-password", methods=["POST"])
def api_auth_forgot_password():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    # Always return success to prevent email enumeration
    _GENERIC_OK = jsonify({"ok": True, "message": "If that address is registered, a password reset link has been sent."})

    if not email or "@" not in email:
        return _GENERIC_OK

    if not db.is_ready():
        return _GENERIC_OK

    user = db.get_user_by_email(email)
    if not user or not user["isActive"]:
        return _GENERIC_OK

    # Rate-limit: reject if a token was issued less than 60 seconds ago
    existing_expiry = db.get_reset_token_issued_at(user["id"])
    if existing_expiry:
        issued_at_estimate = existing_expiry - timedelta(hours=Config.PASSWORD_RESET_EXPIRE_HOURS)
        if (datetime.now(timezone.utc) - issued_at_estimate.replace(tzinfo=timezone.utc)).total_seconds() < 60:
            return _GENERIC_OK

    reset_token  = generate_verify_token()
    expiry_hours = Config.PASSWORD_RESET_EXPIRE_HOURS
    expiry_utc   = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    db.set_reset_token(user["id"], reset_token, expiry_utc)
    send_password_reset_email(user, reset_token, expiry_hours)
    return _GENERIC_OK


@app.route("/api/auth/reset-password", methods=["POST"])
def api_auth_reset_password():
    data         = request.get_json(silent=True) or {}
    token        = (data.get("token") or "").strip()
    new_password = data.get("newPassword") or ""

    if not token:
        return jsonify({"ok": False, "error": "token_invalid"}), 400
    if len(new_password) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters"}), 400

    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not available"}), 503

    user = db.get_user_by_reset_token(token)
    if not user:
        return jsonify({"ok": False, "error": "token_invalid"}), 400

    password_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    db.reset_user_password(user["id"], password_hash)
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
@require_auth
def api_auth_me():
    user = db.get_user_by_id(g.current_user_id)
    if not user:
        return jsonify({"ok": False, "error": "User not found"}), 404
    return jsonify({"ok": True, "user": {
        "id": user["id"],
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
    }})


@app.route("/api/auth/logout", methods=["POST"])
@require_auth
def api_auth_logout():
    # Stateless JWT — client drops the token; server just acknowledges.
    return jsonify({"ok": True})


# ── Protected API routes start here ───────────────────────────────────────────

@app.route("/api/scan", methods=["POST"])
@require_auth
def api_scan():
    """Queue a scan job and return a job id so the client can poll status."""
    limited, retry_after = _check_scan_rate_limit(request.remote_addr or "unknown")
    if limited:
        return jsonify({"ok": False, "error": f"Too many requests. Please wait {retry_after}s before starting another scan."}), 429, {"Retry-After": str(retry_after)}

    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    include_best_practices = bool(data.get("includeBestPractices"))
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400

    try:
        scan_job = create_scan_job(url, {
            "include_best_practices": include_best_practices,
            "user_id": g.current_user_id,
        })
        return jsonify({"ok": True, "jobId": scan_job["job_id"], "status": scan_job["status"]}), 202
    except ValueError as e:
        logging.warning("Invalid scan request: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Failed to enqueue scan via /api/scan: %s", e)
        return jsonify({"ok": False, "error": "Unable to queue scan"}), 500


@app.route("/api/scan/<string:job_id>", methods=["GET"])
@require_auth
def api_scan_status(job_id):
    """Return the current status of a queued scan job."""
    try:
        job = get_scan_status(job_id)
    except Exception as e:
        logging.exception("Error fetching scan status: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve job status"}), 500

    if job is None:
        return jsonify({"ok": False, "error": "Scan job not found"}), 404

    # Normalize for the frontend: map RQ's 'finished' → 'completed' and unwrap scan_result
    if job.get("status") == "finished":
        job["status"] = "completed"
        raw = job.get("result")
        if isinstance(raw, dict) and "scan_result" in raw:
            job["result"] = raw["scan_result"]

    return jsonify({"ok": True, "job": job})


@app.route("/health/live", methods=["GET"])
def health_live():
    return jsonify({"status": "ok", "request_id": _get_request_id()})


@app.route("/health/ready", methods=["GET"])
def health_ready():
    queue_health = _queue_health()
    database_ready = db.is_ready()
    status = "ok" if queue_health.get("connected") and database_ready else "unavailable"
    code = 200 if status == "ok" else 503
    return (
        jsonify(
            {
                "status": status,
                "request_id": _get_request_id(),
                "queue": queue_health,
                "database": {"available": database_ready},
            }
        ),
        code,
    )


@app.route("/api/history", methods=["GET"])
@require_auth
def api_history():
    """Return scan history from the database (MSSQL)."""
    if not db.is_ready():
        return jsonify(_history_unavailable_payload())
    try:
        limit = request.args.get("limit", type=int) or 500
        items = db.get_scan_history(limit=limit)
        return jsonify({"ok": True, "available": True, "items": items})
    except Exception as e:
        logging.exception("[DB] Failed to get scan history: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/history/<int:scan_id>", methods=["GET"])
@require_auth
def api_history_result(scan_id):
    """Return the full stored result for a scan."""
    if not db.is_ready():
        return jsonify({
            "ok": False,
            "error": _history_unavailable_payload()["message"],
        }), 503
    try:
        result = db.get_scan_result(scan_id)
        if result is None:
            return jsonify({"ok": False, "error": "Scan not found or no result stored"}), 404
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        logging.exception("[DB] Failed to get scan result: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/history/prev-scan", methods=["GET"])
@require_auth
def api_history_prev_scan():
    """Return the most recent previous scan summary for a given URL."""
    url = (request.args.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "url parameter required"}), 400
    if not db.is_ready():
        return jsonify({"ok": True, "scan": None})
    try:
        scan = db.get_prev_scan_summary_for_url(url)
        return jsonify({"ok": True, "scan": scan})
    except Exception as e:
        logging.exception("[DB] Failed to get prev scan for url: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/keyboard", methods=["POST"])
@require_auth
def api_assisted_keyboard():
    """Run automated keyboard checks for a URL and return pass/fail details."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    try:
        result = run_keyboard_assisted_test(url)
        if db.is_ready():
            try:
                db.save_assistive_scan("keyboard", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist keyboard scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/color-contrast", methods=["POST"])
@require_auth
def api_assisted_color_contrast():
    """Run automated color contrast checks for a URL and return pass/fail details."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    try:
        result = run_color_contrast_assisted_test(url)
        if db.is_ready():
            try:
                db.save_assistive_scan("contrast", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist contrast scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/page-structure", methods=["POST"])
@require_auth
def api_assisted_page_structure():
    """Run page structure checks (headings + landmarks) for a URL."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    try:
        result = run_page_structure_assisted_test(url)
        if db.is_ready():
            try:
                db.save_assistive_scan("page-structure", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist page-structure scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assisted/forms", methods=["POST"])
@require_auth
def api_assisted_forms():
    """Run forms accessibility checks (labels, autocomplete, fieldsets) for a URL."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    try:
        result = run_forms_accessibility_test(url)
        if db.is_ready():
            try:
                db.save_assistive_scan("forms", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist forms scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/assistive-history", methods=["GET"])
@require_auth
def api_assistive_history():
    """Return assistive scan history (keyboard + contrast) from the database."""
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "items": [],
            "message": "Assistive scan history is unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        scan_type = (request.args.get("scan_type") or "").strip() or None
        url_filter = (request.args.get("url") or "").strip() or None
        from_date = (request.args.get("from") or "").strip() or None
        to_date = (request.args.get("to") or "").strip() or None
        limit = request.args.get("limit", type=int) or 200
        items = db.get_assistive_scans(
            scan_type=scan_type,
            url=url_filter,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
        )
        return jsonify({"ok": True, "available": True, "items": items})
    except Exception as e:
        logging.exception("[DB] Failed to get assistive history: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/trends", methods=["GET"])
@require_auth
def api_trends():
    """
    Return time-bucketed scan aggregates for the trends dashboard.

    Query params:
      granularity  daily | weekly | monthly   (default: daily)
      days         integer convenience param  (default: 30)
      from         YYYY-MM-DD start date      (overrides days)
      to           YYYY-MM-DD end date        (default: today)
    """
    if not db.is_ready():
        return jsonify({
            "ok": False,
            "available": False,
            "data": [],
            "summary": None,
            "message": "Trend data unavailable: " + (db.init_error() or "database not configured"),
        })

    granularity = request.args.get("granularity", "daily").strip().lower()
    if granularity not in ("daily", "weekly", "monthly"):
        granularity = "daily"

    # Resolve date range
    from_param = (request.args.get("from") or "").strip()
    to_param = (request.args.get("to") or "").strip()

    if not from_param:
        try:
            days = max(1, min(int(request.args.get("days", 30)), 365))
        except (ValueError, TypeError):
            days = 30
        from datetime import date, timedelta
        from_param = (date.today() - timedelta(days=days - 1)).isoformat()

    try:
        result = db.get_scan_trends(
            granularity=granularity,
            start_date=from_param or None,
            end_date=to_param or None,
        )
        return jsonify({
            "ok": True,
            "available": True,
            "granularity": granularity,
            "period": {"from": from_param, "to": to_param or None},
            "data": result["data"],
            "summary": result["summary"],
        })
    except Exception as e:
        logging.exception("Failed to fetch trend data: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl", methods=["POST"])
@require_auth
def api_crawl_create():
    """Queue a multi-page site crawl job."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    try:
        data = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    logging.info("Crawl API received | keys=%s notifyEmail=%r", list(data.keys()), data.get("notifyEmail"))
    options = {
        "max_depth": data.get("maxDepth"),
        "max_pages": data.get("maxPages"),
        "full_site": bool(data.get("fullSite", False)),
        "notify_email": (data.get("notifyEmail") or "").strip() or None,
        "user_id": g.current_user_id,
    }
    try:
        job = create_crawl_job(url, options)
        return jsonify({"ok": True, **job}), 202
    except ValueError as e:
        logging.warning("Invalid crawl request: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        logging.exception("Failed to create crawl job: %s", e)
        return jsonify({"ok": False, "error": "Unable to start crawl"}), 500


@app.route("/api/crawl/<string:crawl_id>", methods=["GET"])
@require_auth
def api_crawl_status(crawl_id):
    """Return the status of a crawl job."""
    try:
        job = get_crawl_status(crawl_id)
    except Exception as e:
        logging.exception("Error fetching crawl status: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve crawl status"}), 500
    if job is None:
        return jsonify({"ok": False, "error": "Crawl job not found"}), 404
    return jsonify({"ok": True, "job": job})


@app.route("/api/crawl/<string:crawl_id>/stop", methods=["POST"])
@require_auth
def api_crawl_stop(crawl_id):
    """Cancel a running or pending crawl job."""
    try:
        found = cancel_crawl_job(crawl_id)
    except Exception as e:
        logging.exception("Error stopping crawl: %s", e)
        return jsonify({"ok": False, "error": "Unable to stop crawl"}), 500
    if not found:
        return jsonify({"ok": False, "error": "Crawl job not found"}), 404
    return jsonify({"ok": True, "crawl_id": crawl_id, "status": "cancelled"})


@app.route("/api/crawl/<string:crawl_id>/pages", methods=["GET"])
@require_auth
def api_crawl_pages(crawl_id):
    """Return all scanned pages for a crawl job."""
    try:
        pages = get_crawl_pages(crawl_id)
    except Exception as e:
        logging.exception("Error fetching crawl pages: %s", e)
        return jsonify({"ok": False, "error": "Unable to retrieve crawl pages"}), 500
    return jsonify({"ok": True, "crawl_id": crawl_id, "pages": pages, "count": len(pages)})


@app.route("/api/crawls", methods=["GET"])
@require_auth
def api_crawls_list():
    """Return recent crawl jobs from the database, ordered newest first."""
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "items": [],
            "message": "Crawl history unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        limit = request.args.get("limit", type=int) or 25
        items = db.get_all_crawl_jobs(limit=limit)
        return jsonify({"ok": True, "available": True, "items": items})
    except Exception as e:
        logging.exception("[DB] Failed to get crawl jobs: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl/<string:crawl_id>/intelligence", methods=["GET"])
@require_auth
def api_crawl_intelligence(crawl_id):
    """WCAG breakdown, severity distribution, and top issue types for a specific crawl."""
    if not db.is_ready():
        return jsonify({"ok": False, "available": False,
                        "message": "Database not configured"}), 200
    try:
        intel = db.get_crawl_violation_intel(crawl_id)
        return jsonify({"ok": True, "available": True, **intel})
    except Exception as e:
        logging.exception("Error getting crawl intelligence: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl/<string:crawl_id>/regressions", methods=["GET"])
@require_auth
def api_crawl_regressions(crawl_id):
    """Compare crawl_id pages against the previous completed crawl for the same root URL."""
    if not db.is_ready():
        return jsonify({"ok": False, "available": False,
                        "message": "Database not configured"}), 200
    try:
        data = db.get_crawl_regressions(crawl_id)
        return jsonify({"ok": True, **data})
    except Exception as e:
        logging.exception("Error getting crawl regressions: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawls/compare", methods=["GET"])
@require_auth
def api_crawls_compare():
    """Side-by-side comparison of two crawls. Query params: a=<crawl_id>&b=<crawl_id>"""
    crawl_id_a = (request.args.get("a") or "").strip()
    crawl_id_b = (request.args.get("b") or "").strip()
    if not crawl_id_a or not crawl_id_b:
        return jsonify({"ok": False, "error": "Query params 'a' and 'b' are required"}), 400
    if crawl_id_a == crawl_id_b:
        return jsonify({"ok": False, "error": "Cannot compare a crawl with itself"}), 400
    if not db.is_ready():
        return jsonify({"ok": False, "available": False,
                        "message": "Database not configured"}), 200
    try:
        result = db.compare_crawls(crawl_id_a, crawl_id_b)
        if result is None:
            return jsonify({"ok": False, "error": "One or both crawl IDs not found"}), 404
        return jsonify({"ok": True, **result})
    except Exception as e:
        logging.exception("Error comparing crawls: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawls/timeline", methods=["GET"])
@require_auth
def api_crawls_timeline():
    """Score history for all completed crawls of a root URL. Query param: url=<root_url>"""
    root_url = (request.args.get("url") or "").strip()
    if not root_url:
        return jsonify({"ok": False, "error": "Query param 'url' is required"}), 400
    if not db.is_ready():
        return jsonify({"ok": False, "available": False, "data": [],
                        "message": "Database not configured"}), 200
    try:
        limit = request.args.get("limit", type=int) or 20
        data = db.get_crawl_score_timeline(root_url, limit=limit)
        return jsonify({"ok": True, "url": root_url, "data": data, "count": len(data)})
    except Exception as e:
        logging.exception("Error getting crawl timeline: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Phase 3: Crawl Schedules (Feature 1) ──────────────────────────────────────

@app.route("/api/crawl-schedules", methods=["GET"])
@require_auth
def api_crawl_schedules_list():
    if not db.is_ready():
        return jsonify({"ok": True, "available": False, "items": [],
                        "message": "Database not configured"}), 200
    try:
        items = db.get_crawl_schedules(g.current_user_id)
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        logging.exception("Failed to list crawl schedules: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl-schedules", methods=["POST"])
@require_auth
def api_crawl_schedules_create():
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    frequency = (data.get("frequency") or "weekly").strip().lower()
    name = (data.get("name") or "").strip() or None
    time_of_day = db.parse_time_of_day(data.get("timeOfDay"))
    schedule_type = (data.get("scheduleType") or "simple").strip().lower()
    cron_expression = (data.get("cronExpression") or "").strip() or None
    if not url:
        return jsonify({"ok": False, "error": "Missing 'url'"}), 400
    if schedule_type not in ("simple", "cron"):
        schedule_type = "simple"
    if schedule_type == "cron":
        if not cron_expression or not croniter.is_valid(cron_expression):
            return jsonify({"ok": False, "error": "Invalid cron expression"}), 400
    if frequency not in ("hourly", "daily", "weekly", "monthly"):
        frequency = "weekly"
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    try:
        sched = db.create_crawl_schedule(
            url, frequency, name=name, time_of_day=time_of_day, user_id=g.current_user_id,
            schedule_type=schedule_type, cron_expression=cron_expression,
        )
        return jsonify({"ok": True, "schedule": sched}), 201
    except Exception as e:
        logging.exception("Failed to create crawl schedule: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl-schedules/<int:schedule_id>", methods=["PATCH"])
@require_auth
def api_crawl_schedules_update(schedule_id):
    data = request.get_json(silent=True) or {}
    kwargs = {}
    if "enabled" in data:
        kwargs["enabled"] = bool(data["enabled"])
    if "frequency" in data:
        kwargs["frequency"] = str(data["frequency"])
    if "name" in data:
        kwargs["name"] = (data.get("name") or "").strip() or None
    if "timeOfDay" in data:
        kwargs["time_of_day"] = db.parse_time_of_day(data.get("timeOfDay"))
    if "scheduleType" in data:
        schedule_type = str(data["scheduleType"]).strip().lower()
        cron_expression = (data.get("cronExpression") or "").strip() or None
        if schedule_type == "cron" and (not cron_expression or not croniter.is_valid(cron_expression)):
            return jsonify({"ok": False, "error": "Invalid cron expression"}), 400
        kwargs["schedule_type"] = schedule_type
        kwargs["cron_expression"] = cron_expression
    elif "cronExpression" in data:
        cron_expression = (data.get("cronExpression") or "").strip() or None
        if cron_expression and not croniter.is_valid(cron_expression):
            return jsonify({"ok": False, "error": "Invalid cron expression"}), 400
        kwargs["cron_expression"] = cron_expression
    if not kwargs:
        return jsonify({"ok": False, "error": "Nothing to update"}), 400
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    ok = db.update_crawl_schedule(schedule_id, g.current_user_id, **kwargs)
    return jsonify({"ok": ok})


@app.route("/api/crawl-schedules/<int:schedule_id>", methods=["DELETE"])
@require_auth
def api_crawl_schedules_delete(schedule_id):
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    ok = db.delete_crawl_schedule(schedule_id, g.current_user_id)
    return jsonify({"ok": ok})


@app.route("/api/crawl-schedules/<int:schedule_id>/run-now", methods=["POST"])
@require_auth
def api_crawl_schedules_run_now(schedule_id):
    """Trigger a schedule's crawl immediately, without disturbing its next automatic run."""
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    sched = db.get_crawl_schedule(schedule_id, g.current_user_id)
    if not sched:
        return jsonify({"ok": False, "error": "Schedule not found"}), 404
    if db.has_active_crawl_for_url(sched["root_url"]):
        return jsonify({"ok": False, "error": "A crawl is already running for this URL"}), 409
    try:
        job = create_crawl_job(sched["root_url"], {"user_id": g.current_user_id})
        return jsonify({"ok": True, "crawl_id": job["crawl_id"]}), 201
    except Exception as e:
        logging.exception("Failed to run schedule now: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl-schedules/<int:schedule_id>/stop", methods=["POST"])
@require_auth
def api_crawl_schedules_stop(schedule_id):
    """Cancel the in-progress crawl currently running for this schedule, if any."""
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    sched = db.get_crawl_schedule(schedule_id, g.current_user_id)
    if not sched:
        return jsonify({"ok": False, "error": "Schedule not found"}), 404
    crawl_id = db.get_active_crawl_id_for_url(sched["root_url"])
    if not crawl_id:
        return jsonify({"ok": False, "error": "No active run for this schedule"}), 404
    try:
        cancel_crawl_job(crawl_id)
        return jsonify({"ok": True, "crawl_id": crawl_id, "status": "cancelled"})
    except Exception as e:
        logging.exception("Failed to stop schedule run: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/crawl-schedules/<int:schedule_id>/runs", methods=["GET"])
@require_auth
def api_crawl_schedules_runs(schedule_id):
    """Return the most recent crawl runs for this schedule."""
    if not db.is_ready():
        return jsonify({"ok": True, "available": False, "items": []})
    sched = db.get_crawl_schedule(schedule_id, g.current_user_id)
    if not sched:
        return jsonify({"ok": False, "error": "Schedule not found"}), 404
    limit = request.args.get("limit", type=int) or 5
    items = db.get_schedule_runs(sched["root_url"], limit=limit)
    return jsonify({"ok": True, "items": items})


# ── Phase 3: AI Summary (Feature 2) ───────────────────────────────────────────

@app.route("/api/crawl/<string:crawl_id>/summary", methods=["GET"])
@require_auth
def api_crawl_ai_summary(crawl_id):
    if not db.is_ready():
        return jsonify({"ok": False, "available": False, "message": "Database not configured"}), 200
    import json as _json
    raw = db.get_crawl_ai_summary(crawl_id)
    if raw is None:
        # Trigger generation on demand if API key is present
        from backend.services.ai_summary_service import generate_and_store_summary
        try:
            generate_and_store_summary(crawl_id)
            raw = db.get_crawl_ai_summary(crawl_id)
        except Exception as e:
            logging.warning("On-demand AI summary failed: %s", e)
    if raw is None:
        return jsonify({"ok": True, "available": False, "summary": None})
    try:
        summary = _json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        summary = {"overall_health": raw}
    return jsonify({"ok": True, "available": True, "summary": summary})


# ── Phase 3: Alerts (Feature 3) ────────────────────────────────────────────────

@app.route("/api/alerts", methods=["GET"])
@require_auth
def api_alerts_list():
    if not db.is_ready():
        return jsonify({"ok": True, "available": False, "items": [],
                        "message": "Database not configured"}), 200
    try:
        status_filter = request.args.get("status") or None
        limit = request.args.get("limit", type=int) or 50
        items = db.get_alerts(status=status_filter, limit=limit)
        unread = db.get_unacknowledged_alert_count()
        return jsonify({"ok": True, "items": items, "unread_count": unread})
    except Exception as e:
        logging.exception("Failed to list alerts: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/alerts/<int:alert_id>/acknowledge", methods=["PATCH"])
@require_auth
def api_alerts_acknowledge(alert_id):
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    ok = db.acknowledge_alert(alert_id)
    return jsonify({"ok": ok})


@app.route("/api/alerts/unread-count", methods=["GET"])
@require_auth
def api_alerts_unread_count():
    if not db.is_ready():
        return jsonify({"ok": True, "count": 0})
    return jsonify({"ok": True, "count": db.get_unacknowledged_alert_count()})


# ── Phase 3: Page Trends (Feature 6) ──────────────────────────────────────────

@app.route("/api/crawl/<string:crawl_id>/page-trends", methods=["GET"])
@require_auth
def api_crawl_page_trends(crawl_id):
    if not db.is_ready():
        return jsonify({"ok": True, "has_comparison": False}), 200
    try:
        data = db.get_page_trends(crawl_id)
        return jsonify({"ok": True, **data})
    except Exception as e:
        logging.exception("Error getting page trends: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/violations/summary", methods=["GET"])
@require_auth
def api_violations_summary():
    """Aggregate violation intelligence from recent scan payloads.

    Architecture note: regression detection uses only the Violations integer
    column (no JSON parsing), so it is fast regardless of payload size.
    Payload parsing is bounded by the limit param (default 100 rows).
    """
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "severity_breakdown": {"critical": 0, "serious": 0, "moderate": 0, "minor": 0},
            "top_issue_types": [],
            "wcag_breakdown": [],
            "needs_attention": [],
            "message": "Violation summary unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        limit = request.args.get("limit", type=int) or 100
        intel = db.get_violation_intel(limit=limit)
        regressions = db.get_regression_candidates()
        return jsonify({
            "ok": True,
            "available": True,
            **intel,
            "needs_attention": regressions,
        })
    except Exception as e:
        logging.exception("[DB] Failed to get violation summary: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/auto-fix", methods=["POST"])
@require_auth
def api_auto_fix():
    """Run the real Auto-Fix pipeline (locate source, patch, build, re-scan, push branch)."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    body     = request.get_json(silent=True) or {}
    page_url = (body.get("page_url") or "").strip()
    rule     = body.get("rule") or {}
    node     = body.get("node") or {}

    if not page_url or not rule.get("id"):
        return jsonify({"ok": False, "error": "page_url and rule are required"}), 400

    import hashlib
    link = db.get_repo_link_for_url(page_url, g.current_user_id)
    if not link:
        return jsonify({"ok": False, "error": "No repo connected for this site — connect one under Connected Repos"}), 404

    # Identifies which specific element this is, not just which rule — so
    # fixing several different elements flagged by the same rule on the same
    # page (e.g. via "Fix All") isn't mistaken for re-fixing the same one.
    node_signature = hashlib.sha256((node.get("html") or "").encode()).hexdigest()[:32]

    from backend.services.auto_fix_service import run_auto_fix, is_pull_request_open

    existing = db.get_open_fix(g.current_user_id, page_url, rule.get("id", ""), node_signature)
    if existing:
        # The DB row only reflects what happened when we opened that PR/MR — it
        # has no idea if it was since closed, or the repo archived. Check the
        # provider directly rather than trust a record that could be stale.
        # GitHub PR urls end in /pull/<n>, GitLab MR urls in /merge_requests/<n>,
        # Bitbucket PR urls in /pull-requests/<n>.
        pr_url_val = existing["pr_url"] or ""
        pr_match = re.search(r"/pull/(\d+)$", pr_url_val) \
            or re.search(r"/merge_requests/(\d+)$", pr_url_val) \
            or re.search(r"/pull-requests/(\d+)$", pr_url_val)
        still_open = bool(pr_match) and is_pull_request_open(
            link["repo_url"], link["access_token"], int(pr_match.group(1)), link.get("provider") or "github"
        )
        if still_open:
            return jsonify({
                "ok": True, "status": "verified", "duplicate": True, "merged": False,
                "pr_url": existing["pr_url"], "branch_url": existing["branch_url"],
                "steps": [{"name": "Existing fix", "ok": True,
                           "detail": "A PR for this violation is already open and awaiting review"}],
            })

    result = run_auto_fix(link, page_url, rule, node)

    db.save_fix(
        g.current_user_id, page_url, rule.get("id", ""), result.get("status", "failed"),
        result.get("branch_url"), result.get("error"), result.get("pr_url"),
        result.get("merged", False), node_signature,
    )
    return jsonify({"ok": True, **result})


@app.route("/api/fixes", methods=["GET"])
@require_auth
def api_fixes_list():
    limit = request.args.get("limit", type=int) or 50
    fixes = db.get_fixes(g.current_user_id, limit=limit)
    return jsonify({"ok": True, "fixes": fixes})


# ─────────────────────────────────────────────────────────────────────────────
# INTEGRATIONS  (Slack OAuth + Teams incoming webhook)
# ─────────────────────────────────────────────────────────────────────────────

def _slack_api(token: str, method: str, payload: dict) -> dict:
    """Call a Slack Web API method with a bot token."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _teams_webhook_send(webhook_url: str, payload: dict) -> bool:
    """POST an Adaptive Card payload to a Teams incoming webhook URL."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status == 200


def _report_status_emoji(pass_rate) -> str:
    try:
        rate = float(pass_rate)
    except (TypeError, ValueError):
        return "📋"
    if rate >= 90:
        return "✅"
    if rate >= 50:
        return "⚠️"
    return "❌"


def _report_url(report_type: str, context: dict) -> str:
    """Deep link into the actual scan/crawl results page, not just the app homepage."""
    base = Config.APP_BASE_URL
    if report_type == "crawl_summary" and context.get("crawl_id"):
        return f"{base}/crawl-results?crawlId={context['crawl_id']}"
    if context.get("scan_id"):
        return f"{base}/scan-history?scanId={context['scan_id']}"
    return base


_VIOLATION_IMPACT_EMOJI = {"critical": "🔴", "serious": "🟠", "moderate": "🟡", "minor": "⚪"}
_MAX_INLINE_VIOLATIONS = 15


def _violation_summary_line(v: dict) -> str:
    emoji = _VIOLATION_IMPACT_EMOJI.get((v.get("impact") or "").lower(), "⚪")
    line = f"{emoji} {v.get('rule_id', 'unknown')} ({v.get('impact') or '—'}) — {v.get('affected_count', 0)} element(s)"
    if v.get("pages_affected"):
        line += f" across {v['pages_affected']} page(s)"
    return line


def _violation_detail_lines(v: dict) -> list[str]:
    lines = []
    desc = (v.get("description") or "").strip()
    if desc:
        lines.append(desc[:280])
    tags = ", ".join(v.get("wcag_tags") or [])
    if tags:
        lines.append(f"WCAG: {tags}")
    if v.get("example_selector"):
        lines.append(f"Selector: {v['example_selector'][:80]}")
    return lines


def _build_slack_blocks(report_type: str, context: dict) -> tuple[list, str, dict | None]:
    """Return (blocks, fallback_text, overflow) for a Slack Block Kit message.
    Kept as a clean summary card — the full per-violation detail now lives in
    the auto-attached Executive Summary PDF (see report_pdf_service.py /
    notify_service.send_report_pdf) instead of being dumped inline here.
    overflow is always None for Slack now; kept in the return shape so
    existing callers don't need to change how they unpack it."""
    url       = context.get("url", "—")
    score     = context.get("score", "—")
    violations = context.get("violations", "—")
    pass_rate = context.get("pass_rate", "—")
    pages     = context.get("pages")
    note      = context.get("note", "")
    emoji     = _report_status_emoji(pass_rate)

    if report_type == "crawl_summary":
        title = f"{emoji} ADA Crawl Report — {url}"
        fields = [
            {"type": "mrkdwn", "text": f"*Pages Scanned*\n{pages or '—'}"},
            {"type": "mrkdwn", "text": f"*Avg Score*\n{score}/100"},
            {"type": "mrkdwn", "text": f"*Violations*\n{violations}"},
            {"type": "mrkdwn", "text": f"*Pass Rate*\n{pass_rate}%"},
        ]
    elif report_type == "score_card":
        title = f"{emoji} ADA Score Card — {url}"
        fields = [
            {"type": "mrkdwn", "text": f"*Accessibility Score*\n{score}/100"},
            {"type": "mrkdwn", "text": f"*Pass Rate*\n{pass_rate}%"},
        ]
    else:  # scan_summary
        title = f"{emoji} ADA Scan Summary — {url}"
        fields = [
            {"type": "mrkdwn", "text": f"*Score*\n{score}/100"},
            {"type": "mrkdwn", "text": f"*Pass Rate*\n{pass_rate}%"},
            {"type": "mrkdwn", "text": f"*Violations*\n{violations}"},
        ]

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{emoji} ADA Accessibility Report — {url}", "emoji": True}},
        {"type": "section", "fields": fields},
    ]
    if note:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"_{note}_"}})
    return blocks, title, None


def _slack_upload_file(token: str, channel_id: str, filename: str, content: str | bytes,
                        initial_comment: str | None = None) -> bool:
    """Upload a file to Slack and share it into a channel — used both for the
    violations-overflow .txt attachment (see _build_slack_blocks) and the
    auto-generated Executive Summary PDF (see report_pdf_service.py).
    Uses files.getUploadURLExternal -> PUT upload -> files.completeUploadExternal,
    Slack's current upload flow (the older files.upload method is deprecated).
    Every failure is logged with Slack's actual error reason (e.g. missing_scope) —
    this used to fail silently, which is exactly how a missing files:write scope
    went unnoticed until someone checked why no file was arriving."""
    import urllib.parse as _up
    try:
        data_bytes = content.encode("utf-8") if isinstance(content, str) else content
        form = _up.urlencode({"filename": filename, "length": len(data_bytes)}).encode()
        req = urllib.request.Request(
            "https://slack.com/api/files.getUploadURLExternal",
            data=form,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            init = json.loads(resp.read())
        if not init.get("ok"):
            logging.error("Slack files.getUploadURLExternal failed: %s", init)
            return False
        put_req = urllib.request.Request(init["upload_url"], data=data_bytes, method="POST")
        with urllib.request.urlopen(put_req, timeout=15) as resp:
            resp.read()
        complete_payload = {
            "files": [{"id": init["file_id"], "title": filename}],
            "channel_id": channel_id,
        }
        if initial_comment:
            complete_payload["initial_comment"] = initial_comment
        complete = _slack_api(token, "files.completeUploadExternal", complete_payload)
        if not complete.get("ok"):
            logging.error("Slack files.completeUploadExternal failed: %s", complete)
        return bool(complete.get("ok"))
    except Exception:
        logging.exception("Slack file upload failed")
        return False


def _build_teams_card(report_type: str, context: dict) -> dict:
    """Return a Teams Adaptive Card webhook payload — full report content inline,
    not just a link (mirrors _build_slack_blocks)."""
    url        = context.get("url", "—")
    score      = context.get("score", "—")
    violations = context.get("violations", "—")
    pass_rate  = context.get("pass_rate", "—")
    pages      = context.get("pages")
    note       = context.get("note", "")
    violations_detail = context.get("violations_detail") or []
    emoji      = _report_status_emoji(pass_rate)
    report_url = _report_url(report_type, context)

    if report_type == "crawl_summary":
        facts = [
            {"title": "Pages Scanned", "value": str(pages or "—")},
            {"title": "Avg Score",     "value": f"{score}/100"},
            {"title": "Violations",    "value": str(violations)},
            {"title": "Pass Rate",     "value": f"{pass_rate}%"},
        ]
    elif report_type == "score_card":
        facts = [
            {"title": "Accessibility Score", "value": f"{score}/100"},
            {"title": "Pass Rate",           "value": f"{pass_rate}%"},
        ]
    else:
        facts = [
            {"title": "Score",      "value": f"{score}/100"},
            {"title": "Violations", "value": str(violations)},
            {"title": "Pass Rate",  "value": f"{pass_rate}%"},
        ]

    body = [
        {"type": "TextBlock", "size": "Large", "weight": "Bolder",
         "text": f"{emoji} ADA Accessibility Report", "wrap": True},
        {"type": "TextBlock", "text": url, "weight": "Bolder", "wrap": True},
        {"type": "FactSet", "facts": facts},
    ]
    if violations_detail:
        shown = violations_detail[:_MAX_INLINE_VIOLATIONS]
        body.append({"type": "TextBlock", "text": f"Issues found ({len(violations_detail)}):",
                     "weight": "Bolder", "wrap": True, "spacing": "Medium"})
        for v in shown:
            text = "  \n".join([_violation_summary_line(v), *_violation_detail_lines(v)])
            body.append({"type": "TextBlock", "text": text, "wrap": True, "spacing": "Small"})
        remaining = len(violations_detail) - len(shown)
        if remaining > 0:
            body.append({"type": "TextBlock", "text": f"+{remaining} more issue(s) not shown",
                         "isSubtle": True, "wrap": True})
    if note:
        body.append({"type": "TextBlock", "text": note, "isSubtle": True, "wrap": True})
    body.append({"type": "TextBlock", "text": f"Reference: {report_url}", "isSubtle": True, "wrap": True, "spacing": "Medium"})

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.2",
                "body": body,
            },
        }],
    }


def _oauth_result_html(success: bool, event_type: str = "", workspace_name: str = "",
                       error: str = "") -> str:
    if success:
        return f"""<!DOCTYPE html><html><head><title>Connected</title></head><body>
<script>
try {{
  window.opener.postMessage(
    {{type: "{event_type}", workspaceName: {json.dumps(workspace_name)}}},
    "*"
  );
}} catch(e) {{}}
setTimeout(() => window.close(), 500);
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:80px">
  Connected! You can close this window.</p>
</body></html>"""
    return f"""<!DOCTYPE html><html><head><title>Error</title></head><body>
<script>
try {{
  window.opener.postMessage({{type: "ada_oauth_error", error: {json.dumps(error)}}},
    "*");
}} catch(e) {{}}
setTimeout(() => window.close(), 3000);
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:80px;color:#c0392b">
  {error}<br><small>You can close this window.</small></p>
</body></html>"""


@app.route("/api/integrations", methods=["GET"])
@require_auth
def api_integrations_list():
    integrations = db.get_integrations(g.current_user_id)
    return jsonify({"ok": True, "integrations": integrations})


@app.route("/api/integrations/<int:integration_id>", methods=["DELETE"])
@require_auth
def api_integration_delete(integration_id):
    ok = db.delete_integration(integration_id, g.current_user_id)
    if not ok:
        return jsonify({"ok": False, "error": "Integration not found"}), 404
    return jsonify({"ok": True})


@app.route("/api/integrations/<int:integration_id>/channels", methods=["GET"])
@require_auth
def api_integration_channels_list(integration_id):
    integration = db.get_integration(integration_id, g.current_user_id)
    if not integration:
        return jsonify({"ok": False, "error": "Integration not found"}), 404
    channels = db.get_integration_channels(integration_id)
    return jsonify({"ok": True, "channels": channels})


@app.route("/api/integrations/<int:integration_id>/channels", methods=["POST"])
@require_auth
def api_integration_channel_add(integration_id):
    integration = db.get_integration(integration_id, g.current_user_id)
    if not integration:
        return jsonify({"ok": False, "error": "Integration not found"}), 404
    body = request.get_json(silent=True) or {}
    channel_id   = body.get("channel_id", "").strip()
    channel_name = body.get("channel_name", "").strip()
    purpose      = body.get("purpose")
    webhook_url  = body.get("webhook_url")
    if not channel_id or not channel_name:
        return jsonify({"ok": False, "error": "channel_id and channel_name are required"}), 400
    db.save_integration_channel(integration_id, channel_id, channel_name, purpose, webhook_url)
    return jsonify({"ok": True})


@app.route("/api/integrations/<int:integration_id>/channels/<channel_id>", methods=["DELETE"])
@require_auth
def api_integration_channel_delete(integration_id, channel_id):
    integration = db.get_integration(integration_id, g.current_user_id)
    if not integration:
        return jsonify({"ok": False, "error": "Integration not found"}), 404
    db.delete_integration_channel(integration_id, channel_id)
    return jsonify({"ok": True})


@app.route("/api/integrations/deliveries", methods=["GET"])
@require_auth
def api_integration_deliveries():
    limit = request.args.get("limit", type=int) or 20
    deliveries = db.get_integration_deliveries(g.current_user_id, limit=limit)
    return jsonify({"ok": True, "deliveries": deliveries})


# ── Slack OAuth ───────────────────────────────────────────────────────────────

@app.route("/api/integrations/slack/start", methods=["GET"])
@require_auth
def api_slack_start():
    if not Config.SLACK_ENABLED:
        return jsonify({"ok": False, "error": "Slack integration is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET."}), 400
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    import urllib.parse as _up
    state = _up.quote(token, safe="")
    redirect_uri = f"{Config.APP_BASE_URL}/api/integrations/slack/callback"
    auth_url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={Config.SLACK_CLIENT_ID}"
        f"&scope=chat%3Awrite%2Cchannels%3Aread%2Cgroups%3Aread%2Cfiles%3Awrite"
        f"&redirect_uri={_up.quote(redirect_uri, safe='')}"
        f"&state={state}"
    )
    return jsonify({"ok": True, "auth_url": auth_url})


@app.route("/api/integrations/slack/callback", methods=["GET"])
def api_slack_callback():
    code  = request.args.get("code", "")
    state = request.args.get("state", "")
    error = request.args.get("error", "")

    if error:
        return _oauth_result_html(False, error=f"Slack authorization cancelled: {error}")

    try:
        import urllib.parse as _up
        token = _up.unquote(state)
        payload = jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except Exception:
        return _oauth_result_html(False, error="Invalid state parameter. Please try again.")

    if not Config.SLACK_ENABLED:
        return _oauth_result_html(False, error="Slack integration not configured on this server.")

    # Exchange code for access token
    try:
        import urllib.parse as _up
        import urllib.request
        redirect_uri = f"{Config.APP_BASE_URL}/api/integrations/slack/callback"
        form_data = _up.urlencode({
            "client_id":     Config.SLACK_CLIENT_ID,
            "client_secret": Config.SLACK_CLIENT_SECRET,
            "code":          code,
            "redirect_uri":  redirect_uri,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://slack.com/api/oauth.v2.access",
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        logging.exception("Slack token exchange failed: %s", e)
        return _oauth_result_html(False, error="Failed to connect to Slack. Please try again.")

    if not data.get("ok"):
        return _oauth_result_html(False, error=data.get("error", "Slack authorization failed"))

    workspace_id   = data["team"]["id"]
    workspace_name = data["team"]["name"]
    access_token   = data["access_token"]

    try:
        db.save_integration(
            user_id=user_id,
            platform="slack",
            workspace_id=workspace_id,
            workspace_name=workspace_name,
            access_token=access_token,
        )
    except Exception as e:
        logging.exception("Failed to save Slack integration: %s", e)
        return _oauth_result_html(False, error="Connected to Slack but failed to save. Please try again.")

    return _oauth_result_html(True, event_type="ada_slack_connected", workspace_name=workspace_name)


@app.route("/api/integrations/slack/<int:integration_id>/channels/available", methods=["GET"])
@require_auth
def api_slack_channels_available(integration_id):
    """List all public+private channels the bot can see in the workspace."""
    integration = db.get_integration(integration_id, g.current_user_id)
    if not integration or integration["platform"] != "slack":
        return jsonify({"ok": False, "error": "Slack integration not found"}), 404
    try:
        result = _slack_api(
            integration["access_token"],
            "conversations.list",
            {"types": "public_channel,private_channel", "limit": 200, "exclude_archived": True},
        )
        if not result.get("ok"):
            return jsonify({"ok": False, "error": result.get("error", "Failed to list channels")}), 400
        channels = [
            {"id": c["id"], "name": c["name"], "is_private": c.get("is_private", False)}
            for c in result.get("channels", [])
        ]
        channels.sort(key=lambda c: c["name"])
        return jsonify({"ok": True, "channels": channels})
    except Exception as e:
        logging.exception("Failed to list Slack channels: %s", e)
        return jsonify({"ok": False, "error": "Could not reach Slack API"}), 502


@app.route("/api/integrations/slack/<int:integration_id>/test", methods=["POST"])
@require_auth
def api_slack_test(integration_id):
    integration = db.get_integration(integration_id, g.current_user_id)
    if not integration or integration["platform"] != "slack":
        return jsonify({"ok": False, "error": "Integration not found"}), 404
    body = request.get_json(silent=True) or {}
    channel_id = body.get("channel_id")
    if not channel_id:
        return jsonify({"ok": False, "error": "channel_id required"}), 400
    try:
        result = _slack_api(integration["access_token"], "chat.postMessage", {
            "channel": channel_id,
            "text": "ADA is now connected to this channel.",
            "blocks": [
                {"type": "section", "text": {"type": "mrkdwn",
                 "text": "*ADA Accessibility Intelligence* is now connected to this channel.\nYou will receive accessibility reports and alerts here."}},
            ],
        })
        if not result.get("ok"):
            return jsonify({"ok": False, "error": result.get("error", "Failed to send test message")}), 400
        return jsonify({"ok": True})
    except Exception as e:
        logging.exception("Slack test message failed: %s", e)
        return jsonify({"ok": False, "error": "Could not reach Slack API"}), 502


# ── Teams (incoming webhook) ──────────────────────────────────────────────────

@app.route("/api/integrations/teams/connect", methods=["POST"])
@require_auth
def api_teams_connect():
    body        = request.get_json(silent=True) or {}
    webhook_url = body.get("webhook_url", "").strip()
    channel_name = body.get("channel_name", "").strip()
    workspace_name = body.get("workspace_name", "Teams").strip()

    if not webhook_url or not channel_name:
        return jsonify({"ok": False, "error": "webhook_url and channel_name are required"}), 400
    if not webhook_url.startswith("https://"):
        return jsonify({"ok": False, "error": "Webhook URL must start with https://"}), 400

    # Send test message to validate the webhook
    test_payload = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard", "version": "1.2",
                "body": [{"type": "TextBlock", "weight": "Bolder",
                          "text": "ADA Accessibility Intelligence is now connected to this channel."}],
            },
        }],
    }
    try:
        ok = _teams_webhook_send(webhook_url, test_payload)
        if not ok:
            return jsonify({"ok": False, "error": "Webhook test failed — check the URL and try again"}), 400
    except Exception as e:
        logging.exception("Teams webhook test failed: %s", e)
        return jsonify({"ok": False, "error": "Could not reach the Teams webhook URL"}), 400

    # Save integration + channel
    import uuid as _uuid
    workspace_id   = f"teams_{_uuid.uuid4().hex[:12]}"
    integration_id = db.save_integration(
        user_id=g.current_user_id,
        platform="teams",
        workspace_id=workspace_id,
        workspace_name=workspace_name,
        access_token=None,
    )
    channel_id = f"ch_{_uuid.uuid4().hex[:12]}"
    db.save_integration_channel(
        integration_id=integration_id,
        channel_id=channel_id,
        channel_name=channel_name,
        purpose=None,
        webhook_url=webhook_url,
    )
    return jsonify({"ok": True, "integration_id": integration_id})


# ── Repo Links (Auto-Fix source repo) ──────────────────────────────────────────

_GITHUB_REPO_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$"
)
# GitLab repos can live under nested subgroups (gitlab.com/team/subteam/project),
# unlike GitHub's flat owner/repo — capture the whole path after gitlab.com/.
_GITLAB_REPO_RE = re.compile(
    r"^https?://gitlab\.com/(?P<path>[\w.-]+(?:/[\w.-]+)+?)(?:\.git)?/?$"
)
# Bitbucket workspaces are flat like GitHub (no nested subgroups) — same shape,
# different host. Repo group is lazy on the single segment directly (like
# GitHub's), not on a repeated group (like GitLab's) — that repeated-group
# form is what let ".git" get swallowed into the path there.
_BITBUCKET_REPO_RE = re.compile(
    r"^https?://bitbucket\.org/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$"
)


@app.route("/api/repo-links", methods=["GET"])
@require_auth
def api_repo_links_list():
    links = db.get_repo_links(g.current_user_id)
    return jsonify({"ok": True, "links": links})


@app.route("/api/repo-links", methods=["POST"])
@require_auth
def api_repo_links_create():
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    body = request.get_json(silent=True) or {}
    site_url       = (body.get("site_url") or "").strip()
    repo_url       = (body.get("repo_url") or "").strip()
    access_token   = (body.get("access_token") or "").strip()
    default_branch = (body.get("default_branch") or "main").strip()
    edit_link_id   = body.get("link_id")
    is_edit        = bool(edit_link_id)

    if not site_url or not repo_url:
        return jsonify({"ok": False, "error": "site_url and repo_url are required"}), 400
    if not access_token and not is_edit:
        return jsonify({"ok": False, "error": "site_url, repo_url and access_token are required"}), 400

    import urllib.parse as _up
    parsed_site = _up.urlparse(site_url)
    domain = parsed_site.netloc
    if not domain:
        return jsonify({"ok": False, "error": "site_url must be a full URL, e.g. https://example.com"}), 400

    gh_match = _GITHUB_REPO_RE.match(repo_url)
    gl_match = None if gh_match else _GITLAB_REPO_RE.match(repo_url)
    bb_match = None if (gh_match or gl_match) else _BITBUCKET_REPO_RE.match(repo_url)
    if not gh_match and not gl_match and not bb_match:
        return jsonify({"ok": False, "error": "repo_url must look like https://github.com/owner/repo, https://gitlab.com/owner/repo, or https://bitbucket.org/workspace/repo"}), 400
    provider = "github" if gh_match else "gitlab" if gl_match else "bitbucket"

    # Only validate against the provider's API when a new token was actually
    # submitted — editing e.g. just the default branch shouldn't cost a
    # network round-trip against a token that isn't changing.
    if access_token:
        import urllib.request
        import urllib.error
        if provider == "github":
            owner, repo = gh_match.group("owner"), gh_match.group("repo")
            repo_label = f"{owner}/{repo}"
            req = urllib.request.Request(
                f"https://api.github.com/repos/{owner}/{repo}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "ADA-Accessibility-Intelligence",
                },
            )
        elif provider == "gitlab":
            # The regex's path group can swallow a trailing ".git" whole when
            # there's only one segment after the namespace (e.g. "owner/repo.git")
            # — "." is a valid path character, so the lazy repetition never needs
            # to exclude it. Strip it explicitly rather than fight the regex.
            repo_label = gl_match.group("path").removesuffix(".git")
            encoded_path = _up.quote(repo_label, safe="")
            req = urllib.request.Request(
                f"https://gitlab.com/api/v4/projects/{encoded_path}",
                headers={
                    "PRIVATE-TOKEN": access_token,
                    "User-Agent": "ADA-Accessibility-Intelligence",
                },
            )
        else:
            owner, repo = bb_match.group("owner"), bb_match.group("repo")
            repo_label = f"{owner}/{repo}"
            req = urllib.request.Request(
                f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "ADA-Accessibility-Intelligence",
                },
            )
        try:
            with urllib.request.urlopen(req, timeout=15):
                pass
        except urllib.error.HTTPError as e:
            logging.warning("Repo link validation failed: %s %s -> %s", e.code, repo_label, e.reason)
            provider_name = {"gitlab": "GitLab", "bitbucket": "Bitbucket"}.get(provider, "repo")
            error = f"Could not access that {provider_name} — check the URL and token" if provider != "github" \
                else "Could not access that repo — check the URL and token"
            return jsonify({"ok": False, "error": error}), 502
        except Exception as e:
            logging.exception("Repo link validation error: %s", e)
            provider_name = {"gitlab": "GitLab", "bitbucket": "Bitbucket", "github": "GitHub"}[provider]
            return jsonify({"ok": False, "error": f"Could not reach {provider_name} — try again"}), 502

    try:
        link_id = db.save_repo_link(
            g.current_user_id, domain, site_url, repo_url, default_branch, "react", access_token or None,
            path_prefix=parsed_site.path, provider=provider,
            link_id=int(edit_link_id) if edit_link_id else None,
        )
    except ValueError:
        return jsonify({"ok": False, "error": "Repo link not found"}), 404
    return jsonify({"ok": True, "id": link_id}), 201


@app.route("/api/repo-links/<int:link_id>", methods=["DELETE"])
@require_auth
def api_repo_links_delete(link_id):
    ok = db.delete_repo_link(link_id, g.current_user_id)
    if not ok:
        return jsonify({"ok": False, "error": "Repo link not found"}), 404
    return jsonify({"ok": True})


# ── Send report ───────────────────────────────────────────────────────────────

@app.route("/api/integrations/send", methods=["POST"])
@require_auth
def api_integration_send():
    body           = request.get_json(silent=True) or {}
    integration_id = body.get("integration_id")
    channel_id     = body.get("channel_id")
    report_type    = body.get("report_type", "scan_summary")
    context        = body.get("context", {})
    note           = body.get("note", "")
    context["note"] = note

    if not integration_id or not channel_id:
        return jsonify({"ok": False, "error": "integration_id and channel_id are required"}), 400

    integration = db.get_integration(int(integration_id), g.current_user_id)
    if not integration:
        return jsonify({"ok": False, "error": "Integration not found"}), 404

    channels = db.get_integration_channels(int(integration_id))
    channel  = next((c for c in channels if c["channel_id"] == channel_id), None)
    if not channel:
        return jsonify({"ok": False, "error": "Channel not found"}), 404

    if not context.get("violations_detail"):
        try:
            if context.get("scan_id"):
                scan_result = db.get_scan_result(int(context["scan_id"]))
                context["violations_detail"] = [
                    {
                        "rule_id": v.get("id", ""),
                        "impact": v.get("impact"),
                        "description": v.get("description") or v.get("help"),
                        "wcag_tags": [t for t in (v.get("tags") or []) if t.startswith("wcag")],
                        "affected_count": len(v.get("nodes") or []),
                        "example_selector": (((v.get("nodes") or [{}])[0]).get("target") or [None])[0],
                        "help_url": v.get("helpUrl"),
                    }
                    for v in ((scan_result or {}).get("axeResult") or {}).get("violations") or []
                ]
            elif context.get("crawl_id"):
                from backend.services.crawl_task import _aggregate_crawl_violations
                context["violations_detail"] = _aggregate_crawl_violations(context["crawl_id"])
        except Exception:
            logging.exception("Failed to backfill violation detail for manual send")

    try:
        if integration["platform"] == "slack":
            blocks, fallback, overflow = _build_slack_blocks(report_type, context)
            result = _slack_api(integration["access_token"], "chat.postMessage", {
                "channel": channel_id,
                "text": fallback,
                "blocks": blocks,
            })
            success = result.get("ok", False)
            err_msg = None if success else result.get("error", "Unknown error")
            if success and overflow:
                _slack_upload_file(integration["access_token"], channel_id, overflow["filename"], overflow["content"])
        else:  # teams
            payload = _build_teams_card(report_type, context)
            success = _teams_webhook_send(channel["webhook_url"], payload)
            err_msg = None if success else "Webhook delivery failed"

        db.log_integration_delivery(
            integration_id=int(integration_id),
            channel_id=channel_id,
            channel_name=channel["channel_name"],
            report_type=report_type,
            status="success" if success else "failed",
            error_msg=err_msg,
            reference=context.get("reference"),
        )
        if not success:
            return jsonify({"ok": False, "error": err_msg}), 400
        return jsonify({"ok": True})
    except Exception as e:
        logging.exception("Integration send failed: %s", e)
        db.log_integration_delivery(
            integration_id=int(integration_id),
            channel_id=channel_id,
            channel_name=channel["channel_name"],
            report_type=report_type,
            status="failed",
            error_msg=str(e),
        )
        return jsonify({"ok": False, "error": "Delivery failed — check connection settings"}), 500


@app.route("/_ada_test_fixture")
def _ada_test_fixture():
    """Temporary: serves the GitLab Auto-Fix test page through the public ngrok
    tunnel, since the scanner's SSRF guard blocks private/loopback addresses —
    remove this route once GitLab testing is done."""
    fixture_path = Path(
        r"C:\Users\utlap\AppData\Local\Temp\claude\c--Users-utlap-Desktop-UI-Design--2--UI-Design"
        r"\71d6f8fd-3d28-4afe-a059-d22f7a1bd2ad\scratchpad\ada_test_lab_artifact.html"
    )
    return fixture_path.read_text(encoding="utf-8"), 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/_ada_test_fixture2")
def _ada_test_fixture2():
    """Temporary: serves the wider ada-test-app fixture (GitLab copy) through the
    public ngrok tunnel — same reason as _ada_test_fixture above."""
    fixture_path = Path(
        r"C:\Users\utlap\AppData\Local\Temp\claude\c--Users-utlap-Desktop-UI-Design--2--UI-Design"
        r"\71d6f8fd-3d28-4afe-a059-d22f7a1bd2ad\scratchpad\ada_test_app_fixture.html"
    )
    return fixture_path.read_text(encoding="utf-8"), 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/_ada_test_fixture3")
def _ada_test_fixture3():
    """Temporary: serves the wider ada-test-app fixture (Bitbucket copy) through
    the public ngrok tunnel — Bitbucket has no free static-pages hosting, same
    reason as _ada_test_fixture2 above for GitLab."""
    fixture_path = Path(
        r"C:\Users\utlap\AppData\Local\Temp\claude\c--Users-utlap-Desktop-UI-Design--2--UI-Design"
        r"\71d6f8fd-3d28-4afe-a059-d22f7a1bd2ad\scratchpad\ada_test_app_fixture_bitbucket.html"
    )
    return fixture_path.read_text(encoding="utf-8"), 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/_ada_test_fixture4")
def _ada_test_fixture4():
    """Temporary: serves the ada-test-clean fixture (GitLab, zero-violation
    baseline) through the public ngrok tunnel — same reason as
    _ada_test_fixture2 above."""
    fixture_path = Path(
        r"C:\Users\utlap\AppData\Local\Temp\claude\c--Users-utlap-Desktop-UI-Design--2--UI-Design"
        r"\71d6f8fd-3d28-4afe-a059-d22f7a1bd2ad\scratchpad\ada_test_clean_fixture.html"
    )
    return fixture_path.read_text(encoding="utf-8"), 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_ui(path):
    """Serve the React app: index.html for routes that are not static files."""
    if not DIST.is_dir():
        return (
            "<p>React app not built. Run: <code>npm run build</code></p>",
            503,
        )
    if path and (DIST / path).is_file():
        return send_from_directory(DIST, path)
    return send_from_directory(DIST, "index.html")


if __name__ == "__main__":
    # use_reloader=False: the file-watcher reloader has been flaky on this
    # machine, restarting on unrelated changes (even inside .venv) and
    # dropping any request in flight — fatal for a long-running Auto-Fix
    # call. debug=True is kept for error tracebacks; restart manually after
    # code changes instead.
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
