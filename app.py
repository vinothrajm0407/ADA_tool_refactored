"""
Flask app: serves the built React UI and provides API routes.
ADA check runs in-process using axe-playwright-python (Playwright + axe-core).

- Local:    python app.py              (Flask dev server, port 5000)
- Production (e.g. Azure): gunicorn app:app   (Gunicorn runs this Flask app)

Setup: pip install -r requirements.txt  # includes axe-playwright-python
       python -m playwright install chromium
Run:   npm run build && python app.py
"""
import base64
import json
import logging
import os
import re
import socket
import threading
import urllib.error
import urllib.request
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Some networks (confirmed on this dev machine) return a working DNS AAAA
# record for a host but silently black-hole the actual IPv6 route to it —
# no RST, no ICMP unreachable, just silence until the OS's own connect
# timeout fires. Python's socket layer tries the first getaddrinfo() result
# (IPv6, since that's what DNS returned) and hangs for that full timeout —
# observed as a consistent ~21s delay on every single gitlab.com/bitbucket.org
# API call — before ever falling back to the IPv4 result that connects in
# under a second. curl avoids this via parallel "happy eyeballs"; Python's
# stdlib doesn't. Restricting resolution to IPv4 for the whole process
# sidesteps it entirely, with no effect on any host that resolves fine over
# IPv6 in the first place.
_original_getaddrinfo = socket.getaddrinfo
def _ipv4_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    return _original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = _ipv4_only_getaddrinfo
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
    run_assistive_modules,
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
from backend.services import report_pdf_service
from backend.services.email_service import send_report_attachment

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

    Exempts localhost — this throttle exists to stop one IP from hammering
    scans (real abuse protection for a deployed instance), but during local
    dev/demo every scan comes from the same loopback address regardless of
    who's testing what, so it was blocking rapid back-to-back scans against
    different test apps during normal local use rather than anything
    resembling abuse.
    """
    if ip in ("127.0.0.1", "::1", "localhost"):
        return False, 0
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
        # API keys (e.g. a CI pipeline) carry a fixed "ada_" prefix and are
        # never valid JWTs, so check that first and skip the JWT path entirely.
        if token.startswith("ada_"):
            user_id = db.get_user_id_by_api_key(token)
            if not user_id:
                return jsonify({"ok": False, "error": "invalid_token"}), 401
            g.current_user_id = user_id
            g.current_user_email = None
            return f(*args, **kwargs)
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
        "role": db.get_user_role(user["id"]),
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
        "role": db.get_user_role(user["id"]),
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
        "role": db.get_user_role(user["id"]),
    }})


@app.route("/api/auth/logout", methods=["POST"])
@require_auth
def api_auth_logout():
    # Stateless JWT — client drops the token; server just acknowledges.
    return jsonify({"ok": True})


# ── Protected API routes start here ───────────────────────────────────────────

def _refuse_assisted_on_hosted_server(data):
    """An assisted ("visible browser") run opens a browser window on the
    server's own screen for a person to pass a site's bot check — only possible
    when the server is the user's own computer, never on a hosted deployment."""
    if data.get("assisted") and Config.IS_PRODUCTION:
        return jsonify({"ok": False, "error": "Visible-browser scans only work when the tool runs on your own computer"}), 400
    return None


def _parse_login(data: dict):
    """Pages behind a login: {url, username, password, usernameSelector?, passwordSelector?}.
    Used for this run only — never stored or logged. Returns (login or None,
    assisted, error response or None)."""
    assisted = bool(data.get("assisted"))
    raw_login = data.get("login") if isinstance(data.get("login"), dict) else {}
    if not (raw_login.get("url") or "").strip():
        return None, assisted, None
    login = {
        "url": raw_login["url"].strip(),
        "username": (raw_login.get("username") or "").strip(),
        "password": raw_login.get("password") or "",
        "username_selector": (raw_login.get("usernameSelector") or "").strip() or None,
        "password_selector": (raw_login.get("passwordSelector") or "").strip() or None,
    }
    if not login["password"]:
        if Config.IS_PRODUCTION:
            return None, assisted, (jsonify({"ok": False, "error": "Enter the login password"}), 400)
        assisted = True  # no password: the person signs in in a window on this PC
    return login, assisted, None


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
    if refused := _refuse_assisted_on_hosted_server(data):
        return refused
    login, assisted, refused = _parse_login(data)
    if refused:
        return refused

    try:
        scan_job = create_scan_job(url, {
            "include_best_practices": include_best_practices,
            "assisted": assisted,
            "user_id": g.current_user_id,
        }, login=login)
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


_IMPORT_MAX_BYTES = 20 * 1024 * 1024  # axe JSON plus one visible-area JPEG
_AXE_LIST_KEYS = ("violations", "passes", "incomplete", "inapplicable")


@app.route("/api/scan/import", methods=["POST"])
@require_auth
def api_scan_import():
    """Save an axe-core result produced in the user's own browser (the Chrome
    extension). Used for pages our server can't load itself — e.g. sites whose
    bot protection shows our headless browser a challenge page but lets a real
    visitor through. Nothing is fetched here; the result is only validated and
    stored like a normal scan."""
    if (request.content_length or 0) > _IMPORT_MAX_BYTES:
        return jsonify({"ok": False, "error": "Scan result is too large"}), 413
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    axe = data.get("axeResult")
    if not url.startswith(("http://", "https://")):
        return jsonify({"ok": False, "error": "Only http and https pages can be saved"}), 400
    if not isinstance(axe, dict) or not all(isinstance(axe.get(k, []), list) for k in _AXE_LIST_KEYS) \
            or "violations" not in axe:
        return jsonify({"ok": False, "error": "axeResult must be an axe-core results object"}), 400

    axe_result = {k: axe[k] for k in (*_AXE_LIST_KEYS, "timestamp", "testEngine", "toolOptions",
                                      "screenshot", "screenshotType") if k in axe}
    axe_result["url"] = url
    result = {
        "url": url,
        "message": "ADA check completed in the browser extension",
        "axeResult": axe_result,
        "includeBestPractices": False,
        "usedFallback": False,
        "source": "extension",
    }
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Scan history is unavailable — database not configured"}), 503
    try:
        scan_id = db.save_scan_history(result)
    except Exception:
        logging.exception("Failed to save imported scan for %s", url)
        return jsonify({"ok": False, "error": "Could not save the scan"}), 500
    return jsonify({"ok": True, "scanId": scan_id, "result": result}), 201


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
        if refused := _refuse_assisted_on_hosted_server(data):
            return refused
        result = run_keyboard_assisted_test(url, assisted=bool(data.get("assisted")))
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
        if refused := _refuse_assisted_on_hosted_server(data):
            return refused
        result = run_color_contrast_assisted_test(url, assisted=bool(data.get("assisted")))
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
        if refused := _refuse_assisted_on_hosted_server(data):
            return refused
        result = run_page_structure_assisted_test(url, assisted=bool(data.get("assisted")))
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
        if refused := _refuse_assisted_on_hosted_server(data):
            return refused
        result = run_forms_accessibility_test(url, assisted=bool(data.get("assisted")))
        if db.is_ready():
            try:
                db.save_assistive_scan("forms", url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist forms scan: %s", _e)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# Module id -> the scan_type its single-module endpoint stores in history.
_ASSISTIVE_HISTORY_TYPE = {"keyboard": "keyboard", "color-contrast": "contrast",
                           "page-structure": "page-structure", "forms": "forms"}


@app.route("/api/assisted/run", methods=["POST"])
@require_auth
def api_assisted_run():
    """Run several Assistive Testing modules on one page load (one browser)
    instead of one load per module. Body: {url, modules: [...], assisted}.
    Returns {ok, results: {module: result}}; each module is saved to history
    exactly as its own endpoint would."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    modules = [m for m in (data.get("modules") or []) if m in _ASSISTIVE_HISTORY_TYPE]
    if not url:
        return jsonify({"ok": False, "error": "Missing or empty 'url'"}), 400
    if not modules:
        return jsonify({"ok": False, "error": f"modules must include one of: {', '.join(_ASSISTIVE_HISTORY_TYPE)}"}), 400
    if refused := _refuse_assisted_on_hosted_server(data):
        return refused
    try:
        results = run_assistive_modules(url, modules, assisted=bool(data.get("assisted")))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    if db.is_ready():
        for module, result in results.items():
            try:
                db.save_assistive_scan(_ASSISTIVE_HISTORY_TYPE[module], url, bool(result.get("passed", False)), result)
            except Exception as _e:
                logging.warning("Failed to persist %s scan: %s", module, _e)
    return jsonify({"ok": True, "results": results})


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


def _extra_pages(root_url: str, raw) -> list[str]:
    """"Pages to include" from the crawl form: full addresses or paths like
    /account (taken relative to the root URL), one per line. Same site only."""
    from urllib.parse import urljoin, urlsplit
    lines = raw if isinstance(raw, list) else str(raw or "").splitlines()
    host = urlsplit(root_url).hostname
    out = []
    for line in lines:
        line = str(line).strip()
        if not line:
            continue
        full = urljoin(root_url, line)
        if urlsplit(full).hostname != host:
            raise ValueError(f"Pages to include must be on {host}: {line}")
        if full not in out:
            out.append(full)
    return out[:200]


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
    if refused := _refuse_assisted_on_hosted_server(data):
        return refused
    login, assisted, refused = _parse_login(data)
    if refused:
        return refused
    try:
        extra_urls = _extra_pages(url, data.get("extraPages"))
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    options = {
        "assisted": assisted,
        "login": login,
        "compare_signed_out": bool(login and data.get("compareSignedOut")),
        "extra_urls": extra_urls,
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


@app.route("/api/crawl/<string:crawl_id>/page-summary", methods=["GET"])
@require_auth
def api_crawl_page_summary(crawl_id):
    """Per page: issues by impact, elements affected, auto-fixable issues.
    Separate from /pages, which is polled during a crawl and stays light;
    this one reads every stored result, so the UI asks once the crawl is done."""
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    from backend.services.auto_fix_service import RULES_WITH_FALLBACK
    from backend.services.crawl_service import page_summary
    ai = bool(Config.GEMINI_API_KEY)
    payloads = db.get_crawl_page_payloads(crawl_id)
    # what Auto Fix already did on each page — survives leaving the page, so
    # Fix all isn't offered again for issues that already have an open PR
    fixes = db.get_page_fixes(_fix_scope(), [u for u, _ in payloads])
    return jsonify({"ok": True, "pages": {
        url: page_summary(payload, ai, RULES_WITH_FALLBACK) | {"fixes": fixes.get(url, {})}
        for url, payload in payloads}})


@app.route("/api/crawl/<string:crawl_id>/pages/<int:page_id>/result", methods=["GET"])
@require_auth
def api_crawl_page_result(crawl_id, page_id):
    """Full stored axe result for one crawled page (violations with their nodes)."""
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    result = db.get_crawl_page_result(crawl_id, page_id)
    if result is None:
        return jsonify({"ok": False, "error": "No stored result for this page"}), 404
    return jsonify({"ok": True, "result": result})


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
    from services.url_validation import validate_url_for_scan
    try:  # refuse now, not on every scheduled run
        validate_url_for_scan(url)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
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


# ── Full technical audit report: download or email one run's PDF ────────────
# Covers all three run types a technical architect would want a full log
# for: a page scan, an assistive test, or a crawl.

_FULL_REPORT_BUILDERS = {
    "scan": lambda record_id: report_pdf_service.render_full_scan_report(int(record_id), g.current_user_id, _fix_scope() is None),
    "assistive": lambda record_id: report_pdf_service.render_full_assistive_report(int(record_id), g.current_user_id, _fix_scope() is None),
    "crawl": lambda record_id: report_pdf_service.render_full_crawl_report(record_id),
}


def _build_full_report_pdf(kind: str, record_id: str):
    builder = _FULL_REPORT_BUILDERS.get(kind)
    if not builder:
        return None
    try:
        return builder(record_id)
    except (TypeError, ValueError):
        return None


@app.route("/api/report/<string:kind>/<string:record_id>", methods=["GET"])
@require_auth
def api_full_report_download(kind, record_id):
    """Download the full technical audit report (PDF) for one run."""
    pdf_bytes = _build_full_report_pdf(kind, record_id)
    if pdf_bytes is None:
        return jsonify({"ok": False, "error": "Report not found or failed to generate"}), 404
    filename = f"audit-report-{kind}-{record_id}.pdf"
    return Response(pdf_bytes, mimetype="application/pdf",
                     headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.route("/api/report/<string:kind>/<string:record_id>/email", methods=["POST"])
@require_auth
def api_full_report_email(kind, record_id):
    """Email the full technical audit report (PDF) for one run."""
    data = request.get_json(silent=True) or {}
    to_email = (data.get("email") or "").strip()
    if not to_email:
        return jsonify({"ok": False, "error": "email is required"}), 400
    pdf_bytes = _build_full_report_pdf(kind, record_id)
    if pdf_bytes is None:
        return jsonify({"ok": False, "error": "Report not found or failed to generate"}), 404
    filename = f"audit-report-{kind}-{record_id}.pdf"
    sent = send_report_attachment(
        to_email,
        subject=f"ADA Full Audit Report — {kind.title()} {record_id}",
        intro_html=f"<p>Attached is the full technical audit report for {kind} run <strong>{record_id}</strong>.</p>",
        pdf_bytes=pdf_bytes,
        filename=filename,
    )
    db.log_report_email(g.current_user_id, to_email, kind, record_id, bool(sent))  # Activity History
    if not sent:
        return jsonify({"ok": False, "error": "Failed to send email. Check SMTP configuration."}), 502
    return jsonify({"ok": True})


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


@app.route("/api/health-tree", methods=["GET"])
@require_auth
def api_health_tree():
    """Client-facing health report: Website -> Page -> open vs fixed issues.
    Grouped by domain since there's no separate Website entity in the schema."""
    if not db.is_ready():
        return jsonify({
            "ok": True,
            "available": False,
            "websites": [],
            "message": "Health tree unavailable: " + (db.init_error() or "database not configured"),
        })
    try:
        data = db.get_health_tree()
        return jsonify({"ok": True, "available": True, **data})
    except Exception as e:
        logging.exception("[DB] Failed to get health tree: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


def _open_fix(lookup, link):
    """Newest recorded fix whose PR is still open at the provider, or None.

    The DB row only knows what happened when the PR was opened — it can't tell
    that the PR was since closed, so every candidate is checked with the
    provider. Walks past closed ones (lookup(skip) excludes them) so a newer
    closed PR never hides an older one that is still open. PR urls end in
    /pull/<n> (GitHub), /merge_requests/<n> (GitLab), /pull-requests/<n>
    (Bitbucket) or /pullrequest/<n> (Azure DevOps — singular, no hyphen).
    """
    from backend.services.auto_fix_service import is_pull_request_open
    skip = []
    for _ in range(10):
        row = lookup(skip)
        if not row or row["pr_url"] in skip:
            return None
        m = _PR_NUMBER_RE.search(row["pr_url"] or "")
        if m and is_pull_request_open(link["repo_url"], link["access_token"], int(m.group(1)), link.get("provider") or "github"):
            return row
        skip.append(row["pr_url"])
    return None


def _patch_dedup(link, page_url):
    """find_duplicate callback for the Auto-Fix pipelines: an identical patch
    (file + before + after) that already has an open PR anywhere in this repo —
    five links styled by one CSS class, or one header template fixed from a
    different page. page_url is kept for callers; the match is repo-wide."""
    return lambda patch_signature: _open_fix(
        lambda skip: db.get_open_fix_by_patch(g.current_user_id, link["repo_url"], patch_signature, skip), link)


# ── Fix at the source ─────────────────────────────────────────────────────
ROOT_CAUSE_VERIFY_PAGES = 8  # ponytail: other pages re-scanned per fix (~5 s each); raise for stronger proof


def _crawl_root_causes(crawl_id):
    from backend.services.root_causes import group_root_causes
    return group_root_causes(db.get_crawl_page_payloads(crawl_id))


@app.route("/api/crawl/<string:crawl_id>/root-causes", methods=["GET"])
@require_auth
def api_crawl_root_causes(crawl_id):
    """Problems shared by several crawled pages, traced to one piece of markup —
    one Auto Fix of that markup's source fixes every page. Each carries the
    current fix (PR and approval) when there is one."""
    if not db.is_ready():
        return jsonify({"ok": False, "error": "Database not configured"}), 503
    groups = _crawl_root_causes(crawl_id)
    states = db.get_fix_states(_fix_scope(), [p["signature"] for grp in groups for p in grp["pages"]])
    from services.crawler import normalize_url
    total_pages = len({normalize_url(u) for u, _ in db.get_crawl_page_payloads(crawl_id)}) if groups else 0
    crawled_at = (db.get_crawl_job(crawl_id) or {}).get("created_at") or ""
    out = []
    for grp in groups:
        fix = next((states[(grp["rule_id"], p["signature"])] for p in grp["pages"] if (grp["rule_id"], p["signature"]) in states), None)
        if fix and fix.get("pr_state") == "merged":
            # This crawl ran after the merge and still found the problem: the fix went to a
            # branch the live site isn't built from yet (e.g. a QA branch), or isn't deployed.
            fix = {**fix, "still_live": bool(fix.get("merged_at")) and crawled_at[:19] > str(fix["merged_at"])[:19]}
        # Per root cause: a crawl can span pages of more than one connected site,
        # so the first group's answer must not decide for the rest.
        connected = bool(db.get_repo_link_for_url(grp["sample"]["page_url"], g.current_user_id))
        out.append({k: v for k, v in grp.items() if k not in ("pages", "sample")} | {
            "sample_page": grp["sample"]["page_url"], "pages": [p["url"] for p in grp["pages"][:50]],
            "fix": fix, "repo_connected": connected})
    return jsonify({"ok": True, "root_causes": out, "scanned_pages": total_pages,
                    "repo_connected": any(r["repo_connected"] for r in out)})


@app.route("/api/crawl/<string:crawl_id>/root-causes/<string:group_id>/fix", methods=["POST"])
@require_auth
def api_crawl_root_cause_fix(crawl_id, group_id):
    """Auto-Fix one root cause: locate its markup's source once, patch it, build,
    re-scan the sample page plus a spread of other affected pages, open one PR."""
    from backend.services import fix_notify
    from backend.services.auto_fix_service import run_auto_fix_batch
    from backend.services.root_causes import rule_for_fix, verification_sample
    group = next((g for g in _crawl_root_causes(crawl_id) if g["id"] == group_id), None)
    if not group:
        return jsonify({"ok": False, "error": "This root cause is no longer in the crawl results"}), 404
    page_url = group["sample"]["page_url"]
    link = db.get_repo_link_for_url(page_url, g.current_user_id)
    if not link:
        return jsonify({"ok": False, "error": "No repo connected for this site — connect one under Connected Repos"}), 404
    states = db.get_fix_states(g.current_user_id, [p["signature"] for p in group["pages"]])
    existing = next((states[(group["rule_id"], p["signature"])] for p in group["pages"]
                     if (group["rule_id"], p["signature"]) in states), None)
    if existing and existing.get("pr_url") and existing.get("pr_state") == "open" and _open_fix(
            lambda skip: None if existing["pr_url"] in skip else existing, link):
        return jsonify({"ok": True, "status": "verified", "duplicate": True, "pr_url": existing["pr_url"],
                        "steps": [{"name": "Existing fix", "ok": True, "detail": "A PR for this root cause is already open"}]})

    rule = rule_for_fix(group)
    result = run_auto_fix_batch(
        link, page_url, rule, [group["sample"]["node"]], find_duplicate=_patch_dedup(link, page_url),
        root_cause={"key": group["html"], "page_count": group["page_count"],
                    "pages": verification_sample(group, ROOT_CAUSE_VERIFY_PAGES)},
    )
    node_result = (result.get("results") or [{}])[0]
    if not result.get("duplicate"):
        checked = [r for r in result.get("pages_checked") or [] if r["fixed"] is not None]
        proof = dict(node_result.get("proof") or {})
        proof["root_cause"] = {"page_count": group["page_count"], "pages_checked": len(checked),
                               "pages_clean": sum(1 for r in checked if r["fixed"]), "crawl_id": crawl_id}
        sample_signature = next(p["signature"] for p in group["pages"] if p["url"] == page_url)
        db.save_fix(
            g.current_user_id, page_url, group["rule_id"], result.get("status", "failed"),
            result.get("branch_url"), result.get("error") or node_result.get("error"), result.get("pr_url"),
            result.get("merged", False), sample_signature, node_result.get("patch_signature"), proof,
        )
        if result.get("pr_url") and not result.get("merged"):
            fix_notify.new_fix(g.current_user_id, page_url, group["rule_id"], 1, result["pr_url"])
    return jsonify({"ok": True, "page_count": group["page_count"], **result})


@app.route("/api/auto-fix/support", methods=["GET"])
@require_auth
def api_auto_fix_support():
    """Which rules Auto-Fix can handle, so the UI can say so before a run:
    rules with a built-in fix always; every rule (and page-wide fixes) only
    when the AI key is configured."""
    from backend.services.auto_fix_service import RULES_WITH_FALLBACK
    return jsonify({"ok": True, "ai": bool(Config.GEMINI_API_KEY), "rules": sorted(RULES_WITH_FALLBACK)})


def _is_approver():
    return db.get_user_role(g.current_user_id) == "approver"


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

    from backend.services.auto_fix_service import run_auto_fix

    existing = _open_fix(lambda skip: db.get_open_fix(g.current_user_id, page_url, rule.get("id", ""), node_signature, skip), link)
    if existing:
        return jsonify({
            "ok": True, "status": "verified", "duplicate": True, "merged": False,
            "pr_url": existing["pr_url"], "branch_url": existing["branch_url"],
            "steps": [{"name": "Existing fix", "ok": True,
                       "detail": "A PR for this violation is already open and awaiting review"}],
        })

    result = run_auto_fix(link, page_url, rule, node, find_duplicate=_patch_dedup(link, page_url))

    if not result.get("duplicate"):
        db.save_fix(
            g.current_user_id, page_url, rule.get("id", ""), result.get("status", "failed"),
            result.get("branch_url"), result.get("error"), result.get("pr_url"),
            result.get("merged", False), node_signature, result.get("patch_signature"), result.get("proof"),
        )
        if result.get("pr_url") and not result.get("merged"):
            from backend.services import fix_notify
            fix_notify.new_fix(g.current_user_id, page_url, rule.get("id", ""), 1, result["pr_url"])
    return jsonify({"ok": True, **result})


@app.route("/api/auto-fix-batch", methods=["POST"])
@require_auth
def api_auto_fix_batch():
    """Same pipeline as /api/auto-fix, but for every element flagged by one
    rule on one page in a single clone/build/PR pass — see run_auto_fix_batch's
    docstring for why this replaces looping the single-element endpoint."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    body     = request.get_json(silent=True) or {}
    page_url = (body.get("page_url") or "").strip()
    rule     = body.get("rule") or {}
    nodes    = body.get("nodes") or []

    if not page_url or not rule.get("id") or not nodes:
        return jsonify({"ok": False, "error": "page_url, rule and nodes are required"}), 400

    link = db.get_repo_link_for_url(page_url, g.current_user_id)
    if not link:
        return jsonify({"ok": False, "error": "No repo connected for this site — connect one under Connected Repos"}), 404

    import hashlib
    from backend.services.auto_fix_service import run_auto_fix_batch

    rule_id = rule.get("id", "")

    # Skip any element that already has an open, unmerged PR for this exact
    # rule+element — same dedup /api/auto-fix already does for a single
    # element. This endpoint never had it, so calling it again before a PR
    # was reviewed (e.g. a CI run firing on every push) kept opening fresh
    # duplicate PRs for the same rule instead of reusing the open one.
    fixable_nodes = []
    duplicate_of = None
    for node in nodes:
        node_signature = hashlib.sha256((node.get("html") or "").encode()).hexdigest()[:32]
        existing = _open_fix(lambda skip: db.get_open_fix(g.current_user_id, page_url, rule_id, node_signature, skip), link)
        if existing:
            duplicate_of = existing
            continue
        fixable_nodes.append(node)

    if not fixable_nodes:
        return jsonify({
            "ok": True, "status": "verified", "duplicate": True, "merged": False,
            "pr_url": duplicate_of["pr_url"], "branch_url": duplicate_of["branch_url"],
            "steps": [{"name": "Existing fix", "ok": True,
                       "detail": "A PR for this violation is already open and awaiting review"}],
        })

    result = run_auto_fix_batch(link, page_url, rule, fixable_nodes, find_duplicate=_patch_dedup(link, page_url))
    node_results = result.get("results", [])

    # One Fix History row per element (all sharing the same PR) — keeps the
    # existing per-element history/dedup behavior intact even though they
    # were produced by a single batched run, not N separate ones.
    for i, node in enumerate(fixable_nodes):
        node_signature = hashlib.sha256((node.get("html") or "").encode()).hexdigest()[:32]
        node_result = node_results[i] if i < len(node_results) else {}
        status = node_result.get("status", "failed")
        was_patched = status == "patched"
        db.save_fix(
            g.current_user_id, page_url, rule_id,
            result.get("status", "failed") if was_patched else status,
            result.get("branch_url") if was_patched else None,
            node_result.get("error"),
            result.get("pr_url") if was_patched else None,
            result.get("merged", False) if was_patched else False,
            node_signature, node_result.get("patch_signature"), node_result.get("proof"),
        )

    patched = sum(1 for r in node_results if r.get("status") == "patched")
    if result.get("pr_url") and not result.get("merged") and not result.get("duplicate") and patched:
        from backend.services import fix_notify
        fix_notify.new_fix(g.current_user_id, page_url, rule_id, patched, result["pr_url"])
    return jsonify({"ok": True, **result})


MAX_PAGE_FIX_RULES = 50  # ponytail: rules per "Fix all" request; a page rarely has more distinct issues


@app.route("/api/auto-fix-page", methods=["POST"])
@require_auth
def api_auto_fix_page():
    """Fix all: every auto-fixable issue on one page in a single clone/build/
    re-scan and ONE pull request. Body: {page_url, violations: [{rule, nodes}]}.
    Elements that already have an open PR are skipped. Fix History gets one
    row per issue, all sharing the PR, so the audit trail stays per issue and
    one Approver decision covers them all."""
    if not request.is_json:
        return jsonify({"ok": False, "error": "Content-Type must be application/json"}), 400
    import hashlib
    from backend.services import fix_notify
    from backend.services.auto_fix_service import run_auto_fix_page
    body = request.get_json(silent=True) or {}
    page_url = (body.get("page_url") or "").strip()
    violations = body.get("violations") or []
    if not page_url or not isinstance(violations, list) or not violations:
        return jsonify({"ok": False, "error": "page_url and violations are required"}), 400
    link = db.get_repo_link_for_url(page_url, g.current_user_id)
    if not link:
        return jsonify({"ok": False, "error": "No repo connected for this site — connect one under Connected Repos"}), 404

    def sig(node):
        return hashlib.sha256((node.get("html") or "").encode()).hexdigest()[:32]

    # every element with markup, per rule; open[i] = that element already has an open PR
    items, already_open, sent = [], [], {}
    for v in violations[:MAX_PAGE_FIX_RULES]:
        rule = (v or {}).get("rule") or {}
        rule_id = rule.get("id")
        nodes = [n for n in (v.get("nodes") or []) if isinstance(n, dict) and (n.get("html") or "").strip()]
        if not rule_id or not nodes:
            continue
        is_open = [bool(_open_fix(lambda skip, s_=sig(n): db.get_open_fix(g.current_user_id, page_url, rule_id, s_, skip), link))
                   for n in nodes]
        sent[rule_id] = is_open
        fresh = [n for n, o in zip(nodes, is_open) if not o]
        if fresh:
            items.append((rule, fresh))
        else:
            already_open.append(rule_id)
    if not items:
        return jsonify({"ok": True, "status": "verified", "duplicate": True, "already_open": already_open,
                        "by_rule": {r: [{"rule_id": r, "status": "already_fixed", "duplicate": True}] * len(o) for r, o in sent.items()},
                        "steps": [{"name": "Existing fixes", "ok": True, "detail": "Every issue already has an open PR"}]})

    result = run_auto_fix_page(link, page_url, items, find_duplicate=_patch_dedup(link, page_url))

    # results come back in (rule, node) order — split them per rule
    flat, by_rule, i = result.get("results") or [], {}, 0
    for rule, nodes in items:
        by_rule[rule["id"]] = flat[i:i + len(nodes)]
        i += len(nodes)
    saved = 0
    if not result.get("duplicate"):
        for rule, nodes in items:
            rows = by_rule[rule["id"]]
            patched = [r for r in rows if r.get("status") == "patched"]
            if not patched and not any(r.get("status") == "failed" for r in rows):
                continue  # every element was already fixed / covered by another PR
            first = patched[0] if patched else {}
            proof = dict(next((r["proof"] for r in patched if r.get("proof")), None) or {})
            # every element this PR fixed, so a second Fix all finds them all
            # (get_open_fix), not just the first one saved as NodeSignature
            proof["page_fix"] = {"issues": len(items), "signatures": [
                sig(n) for n, r in zip(nodes, rows) if r.get("status") == "patched"]}
            failed = next((r.get("error") for r in rows if r.get("status") == "failed"), None)
            db.save_fix(
                g.current_user_id, page_url, rule["id"],
                result.get("status", "failed") if patched else "failed",
                result.get("branch_url") if patched else None,
                None if patched else (failed or result.get("error")),
                result.get("pr_url") if patched else None,
                result.get("merged", False) if patched else False,
                sig(nodes[0]), first.get("patch_signature"), proof if patched else None,
            )
            saved += 1
        if result.get("pr_url") and not result.get("merged"):
            fix_notify.new_fix(g.current_user_id, page_url, f"all {len(items)} issues on this page", 1, result["pr_url"])
    # line results up with every element the page sent (open-PR ones marked as covered)
    aligned = {}
    for rule_id, is_open in sent.items():
        it = iter(by_rule.get(rule_id, []))
        aligned[rule_id] = [{"rule_id": rule_id, "status": "already_fixed", "duplicate": True} if o
                            else next(it, {"rule_id": rule_id, "status": "failed", "error": result.get("error") or "Auto-Fix failed"})
                            for o in is_open]
    return jsonify({"ok": True, **result, "by_rule": aligned, "already_open": already_open, "issues_saved": saved})


_PR_NUMBER_RE = re.compile(r"/(?:pull|merge_requests|pull-requests|pullrequest)/(\d+)$")


def _fix_scope():
    """Whose fixes this user sees: an Approver reviews everyone's (None),
    a developer only their own."""
    return None if _is_approver() else g.current_user_id


def _refresh_fix_reviews(scope, fixes):
    """Ask the git provider who approved / merged each still-open PR and store
    it (compliance audit trail). Merged and closed PRs never change, so they
    are skipped. Returns the fixes list re-read from the DB."""
    from concurrent.futures import ThreadPoolExecutor
    from backend.services.auto_fix_service import get_pull_request_review
    todo = [f for f in fixes if f.get("pr_url") and f.get("pr_state") not in ("merged", "closed")]
    links = {}

    def one(fix):
        m = _PR_NUMBER_RE.search(fix["pr_url"])
        link = links.get(fix["page_url"]) or db.get_repo_link_for_url(fix["page_url"], fix.get("user_id") or g.current_user_id)
        if not m or not link or not link.get("access_token"):
            return
        links[fix["page_url"]] = link
        review = get_pull_request_review(link["repo_url"], link["access_token"], int(m.group(1)),
                                         link.get("provider") or "github")
        if review:
            db.update_fix_review(scope, fix["id"], review)

    if todo:
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(one, todo))
    return db.get_fixes(scope, limit=len(fixes) or 50) if todo else fixes


@app.route("/api/fixes", methods=["GET"])
@require_auth
def api_fixes_list():
    limit = request.args.get("limit", type=int) or 50
    scope = _fix_scope()
    fixes = db.get_fixes(scope, limit=limit)
    if request.args.get("refresh"):
        fixes = _refresh_fix_reviews(scope, fixes)
    return jsonify({"ok": True, "fixes": fixes, "role": "approver" if scope is None else "developer",
                    "me": g.current_user_id})


@app.route("/api/activity", methods=["GET"])
@require_auth
def api_activity():
    """Activity History: every scan, crawl, test, fix, PR review, alert, report
    and setup change as one timeline. Filters: kind, q (text), from / to
    (YYYY-MM-DD). ?format=csv or ?format=pdf to export the filtered list."""
    a = request.args
    events = db.get_activity(g.current_user_id, limit=min(a.get("limit", type=int) or 2000, 5000),
                             all_fixes=_fix_scope() is None)
    kinds = {k for k in (a.get("kind") or "").split(",") if k}
    q = (a.get("q") or "").strip().lower()
    start, end = a.get("from") or "", a.get("to") or ""
    events = [e for e in events
              if (not kinds or e["kind"] in kinds)
              and (not start or e["at"][:10] >= start) and (not end or e["at"][:10] <= end)
              and (not q or q in " ".join(str(e[k] or "") for k in ("action", "target", "result", "by", "ref")).lower())]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if a.get("format") == "csv":
        return Response(report_pdf_service.activity_csv(events), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="activity-history-{stamp}.csv"'})
    if a.get("format") == "pdf":
        pdf = report_pdf_service.render_activity_report(events, {"kind": sorted(kinds), "q": q, "from": start, "to": end})
        if not pdf:
            return jsonify({"ok": False, "error": "Could not build the activity report"}), 500
        return Response(pdf, mimetype="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="activity-history-{stamp}.pdf"'})
    return jsonify({"ok": True, "events": events})


@app.route("/api/compliance/evidence-pack", methods=["GET"])
@require_auth
def api_evidence_pack():
    """Compliance evidence pack: audit trail of every fix that opened a PR
    (issue -> fix -> approver -> date, with every review decision). Fixes an
    Approver rejected stay in, with the reason; PRs closed without any decision
    (abandoned / test PRs) are left out. ?format=csv for a spreadsheet, else PDF."""
    scope = _fix_scope()
    fixes = _refresh_fix_reviews(scope, db.get_fixes(scope, limit=1000))
    fixes = [f for f in fixes if f.get("pr_url") and (f.get("pr_state") != "closed" or f.get("approval_status") == "rejected")]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    data = report_pdf_service.evidence_pack_data(fixes, g.current_user_id, all_users=scope is None)  # adds found / WCAG to each fix
    if request.args.get("format") == "csv":
        return Response(report_pdf_service.audit_trail_csv(fixes), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="audit-trail-{stamp}.csv"'})
    pdf = report_pdf_service.render_evidence_pack(fixes, data)
    if not pdf:
        return jsonify({"ok": False, "error": "Could not build the evidence pack"}), 500
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="evidence-pack-{stamp}.pdf"'})


@app.route("/api/fixes/<int:fix_id>/review", methods=["POST"])
@require_auth
def api_fix_review(fix_id):
    """Approver decision on a fix: {"decision": "approve"|"reject"|"changes", "comment": "..."}.
    Approve merges the PR; reject closes it with the comment; changes leaves the
    PR open with the comment and sends the fix back to its developer. Every fix
    on the same PR (a batch fix) gets the same decision."""
    from backend.services import fix_notify
    from backend.services.auto_fix_service import (approve_pull_request, close_pull_request,
                                                   comment_on_pull_request, merge_pull_request)
    if not _is_approver():
        return jsonify({"ok": False, "error": "Only an Approver can approve or reject fixes"}), 403
    body = request.get_json(silent=True) or {}
    decision = body.get("decision")
    comment = (body.get("comment") or "").strip()
    if decision not in ("approve", "reject", "changes"):
        return jsonify({"ok": False, "error": "decision must be approve, reject or changes"}), 400
    if decision == "reject" and not comment:
        return jsonify({"ok": False, "error": "Give a reason when rejecting a fix"}), 400
    if decision == "changes" and not comment:
        return jsonify({"ok": False, "error": "Say what needs to change"}), 400
    fix = db.get_fix(fix_id)
    if not fix:
        return jsonify({"ok": False, "error": "Fix not found"}), 404
    if not fix["pr_url"] or fix["pr_state"] in ("merged", "closed"):
        return jsonify({"ok": False, "error": f"This fix has no open pull request ({fix['pr_state'] or 'none'})"}), 409
    m = _PR_NUMBER_RE.search(fix["pr_url"])
    # Every decision acts on the PR as the Approver's OWN git account (their
    # Connected Repos token) — never the developer's — so the approval review,
    # merge, comment and close all show who really decided.
    link = _approver_link(fix)
    if not m or not link:
        repo = fix["pr_url"][:m.start()] if m else "this repo"
        return jsonify({"ok": False, "error": f"Connect {repo} under Connected Repos with your own access token first — "
                                              "approvals and merges are made with the Approver's own account."}), 409
    provider = link.get("provider") or "github"
    me = db.get_user_by_id(g.current_user_id) or {}
    name = " ".join(x for x in (me.get("firstName"), me.get("lastName")) if x) or me.get("email")
    git_approval = None
    if decision == "approve":
        posted, why = approve_pull_request(link["repo_url"], link["access_token"], int(m.group(1)), provider,
                                           f"Approved in ADA Auto-Fix review by {name}" + (f": {comment}" if comment else ""))
        git_approval = "posted" if posted else why
        if not merge_pull_request(link["repo_url"], link["access_token"], int(m.group(1)), provider):
            hint = (" The branch needs an approving review, and your account opened this PR — the developer must "
                    "connect their own token so their PRs come from their account." if why == "own_pr" else "")
            return jsonify({"ok": False, "error": "GitHub refused the merge (conflict, failing checks or branch protection) "
                                                  f"— nothing was recorded.{hint}"}), 502
        status = "approved"
        db.review_fix(fix_id, g.current_user_id, status, comment, pr_state="merged", merged_by=name)
    elif decision == "changes":
        status = "changes_requested"
        comment_on_pull_request(link["repo_url"], link["access_token"], int(m.group(1)), provider,
                                f"Changes requested in ADA Auto-Fix review by {name}: {comment}")
        db.review_fix(fix_id, g.current_user_id, status, comment)
    else:
        status = "rejected"
        closed = close_pull_request(link["repo_url"], link["access_token"], int(m.group(1)), provider, comment)
        db.review_fix(fix_id, g.current_user_id, status, comment, pr_state="closed" if closed else None)
    db.add_fix_review(fix_id, status, g.current_user_id, comment)  # full audit trail, not just the latest decision
    fix_notify.decision(fix, status, g.current_user_id, comment)
    updated = next((f for f in db.get_fixes(None, limit=1000) if f["id"] == fix_id), None)
    return jsonify({"ok": True, "fix": updated, "git_approval": git_approval})


def _approver_link(fix):
    """The Approver's own repo connection for the repo this fix's PR is in, or None.
    Own link first (get_repo_link_for_url prefers it); must have a token and
    point at the same repo as the PR."""
    link = db.get_repo_link_for_url(fix["page_url"], g.current_user_id)
    if not link or not link.get("access_token"):
        return None
    base = link["repo_url"].strip().rstrip("/").removesuffix(".git").lower()
    return link if (fix["pr_url"] or "").lower().startswith(base + "/") else None


@app.route("/api/fixes/<int:fix_id>/resubmit", methods=["POST"])
@require_auth
def api_fix_resubmit(fix_id):
    """The developer updated the PR after "changes requested" — back to the Approver's queue."""
    from backend.services import fix_notify
    fix = db.get_fix(fix_id)
    if not fix or (fix["user_id"] != g.current_user_id and not _is_approver()):
        return jsonify({"ok": False, "error": "Fix not found"}), 404
    if fix["approval_status"] != "changes_requested" or fix["pr_state"] in ("merged", "closed"):
        return jsonify({"ok": False, "error": "Only a fix with changes requested and an open pull request can be resubmitted"}), 409
    db.resubmit_fix(fix_id)
    note = ((request.get_json(silent=True) or {}).get("comment") or "").strip()  # optional: what the developer changed
    db.add_fix_review(fix_id, "resubmitted", g.current_user_id, note)
    fix_notify.resubmitted(fix, g.current_user_id)
    updated = next((f for f in db.get_fixes(_fix_scope(), limit=1000) if f["id"] == fix_id), None)
    return jsonify({"ok": True, "fix": updated})


@app.route("/api/users", methods=["GET"])
@require_auth
def api_users_list():
    """Team & roles: an Approver gets every account and its role; a developer
    gets only their own role (no list) — the screen then explains who can change roles."""
    if not _is_approver():
        return jsonify({"ok": True, "role": "developer", "users": [], "me": g.current_user_id})
    return jsonify({"ok": True, "role": "approver", "users": db.list_users(), "me": g.current_user_id})


@app.route("/api/users/<int:user_id>/role", methods=["PUT"])
@require_auth
def api_user_role(user_id):
    """{"role": "approver"|"developer"}. An Approver can't change their own role,
    so the team can never be left without one by accident."""
    if not _is_approver():
        return jsonify({"ok": False, "error": "Only an Approver can manage roles"}), 403
    role = (request.get_json(silent=True) or {}).get("role")
    if role not in ("approver", "developer"):
        return jsonify({"ok": False, "error": "role must be approver or developer"}), 400
    if user_id == g.current_user_id:
        return jsonify({"ok": False, "error": "You can't change your own role — ask another Approver"}), 409
    if not db.set_user_role_by_id(user_id, role):
        return jsonify({"ok": False, "error": "User not found"}), 404
    return jsonify({"ok": True})


@app.route("/api/fixes/<int:fix_id>/proof", methods=["GET"])
@require_auth
def api_fix_proof(fix_id):
    """Before/after screenshots + screen-reader text for one fix (Fix History)."""
    proofs = db.get_fix_proofs(_fix_scope(), fix_id=fix_id)
    if not proofs:
        return jsonify({"ok": False, "error": "No proof recorded for this fix"}), 404
    return jsonify({"ok": True, "proof": proofs[0]})


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


@app.route("/api/api-keys", methods=["GET"])
@require_auth
def api_keys_list():
    keys = db.list_api_keys(g.current_user_id)
    return jsonify({"ok": True, "keys": keys})


def _signed_in_with_api_key():
    """Keys are managed by a signed-in person only: a leaked CI key can't mint
    more keys or revoke the owner's. (An API key login has no email.)"""
    if g.current_user_email is None:
        return jsonify({"ok": False, "error": "Sign in to manage API keys"}), 403
    return None


@app.route("/api/api-keys", methods=["POST"])
@require_auth
def api_keys_create():
    if refused := _signed_in_with_api_key():
        return refused
    data = request.get_json(silent=True) or {}
    label = (data.get("label") or "").strip()[:200]
    if not label:
        return jsonify({"ok": False, "error": "label is required"}), 400
    key = db.create_api_key(g.current_user_id, label)
    # The raw key is only ever returned here, at creation time.
    return jsonify({"ok": True, "key": key})


@app.route("/api/api-keys/<int:key_id>", methods=["DELETE"])
@require_auth
def api_keys_revoke(key_id):
    if refused := _signed_in_with_api_key():
        return refused
    ok = db.revoke_api_key(g.current_user_id, key_id)
    if not ok:
        return jsonify({"ok": False, "error": "Key not found"}), 404
    return jsonify({"ok": True})


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
# Azure DevOps repo URLs carry an org/project/repo triple rather than a flat
# owner/repo, and come in two host shapes — the current dev.azure.com and the
# legacy {org}.visualstudio.com — both routing through a literal "_git" segment.
# Unlike GitHub/GitLab/Bitbucket, Azure project names routinely contain spaces
# (URL-encoded as %20, or literal spaces if pasted from the browser bar) — the
# project group has to allow anything but a slash, not just [\w.-]. The Clone
# button's copy-paste URL also prefixes the host with "{org}@" (HTTP userinfo,
# e.g. https://myorg@dev.azure.com/myorg/proj/_git/repo) — that optional
# prefix is swallowed and ignored since the org already appears in the path.
_AZURE_REPO_RE = re.compile(
    r"^https?://(?:[\w.-]+@)?dev\.azure\.com/(?P<org>[\w.-]+)/(?P<project>[^/]+)/_git/(?P<repo>[\w.-]+?)/?$"
)
_AZURE_VSTS_REPO_RE = re.compile(
    r"^https?://(?P<org>[\w.-]+)\.visualstudio\.com/(?P<project>[^/]+)/_git/(?P<repo>[\w.-]+?)/?$"
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
    site_url        = (body.get("site_url") or "").strip()
    repo_url        = (body.get("repo_url") or "").strip()
    access_token    = (body.get("access_token") or "").strip()
    default_branch  = (body.get("default_branch") or "main").strip()
    edit_link_id    = body.get("link_id")
    is_edit         = bool(edit_link_id)
    # Set when the repo was picked from the GitHub App's own repo list
    # (api_github_app_repos) rather than a pasted URL+token — access is
    # already proven by the installation itself, no token to collect at all.
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
    az_match = None if (gh_match or gl_match or bb_match) else (_AZURE_REPO_RE.match(repo_url) or _AZURE_VSTS_REPO_RE.match(repo_url))
    if not gh_match and not gl_match and not bb_match and not az_match:
        return jsonify({"ok": False, "error": "repo_url must look like https://github.com/owner/repo, https://gitlab.com/owner/repo, https://bitbucket.org/workspace/repo, or https://dev.azure.com/org/project/_git/repo"}), 400
    provider = "github" if gh_match else "gitlab" if gl_match else "bitbucket" if bb_match else "azure"

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
        elif provider == "bitbucket":
            owner, repo = bb_match.group("owner"), bb_match.group("repo")
            repo_label = f"{owner}/{repo}"
            req = urllib.request.Request(
                f"https://api.bitbucket.org/2.0/repositories/{owner}/{repo}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "ADA-Accessibility-Intelligence",
                },
            )
        else:
            org, project, repo = az_match.group("org"), az_match.group("project"), az_match.group("repo")
            repo_label = f"{org}/{project}/{repo}"
            # Azure DevOps REST auth: Basic with an empty username, PAT as password.
            basic = base64.b64encode(f":{access_token}".encode()).decode()
            # project may arrive already percent-encoded (copied from the address
            # bar) or with a literal space (typed/pasted) — normalize via
            # unquote-then-quote so either form ends up correctly encoded once.
            project_enc = _up.quote(_up.unquote(project), safe="")
            req = urllib.request.Request(
                f"https://dev.azure.com/{org}/{project_enc}/_apis/git/repositories/{repo}?api-version=7.1",
                headers={
                    "Authorization": f"Basic {basic}",
                    "User-Agent": "ADA-Accessibility-Intelligence",
                },
            )
        try:
            with urllib.request.urlopen(req, timeout=15):
                pass
        except urllib.error.HTTPError as e:
            logging.warning("Repo link validation failed: %s %s -> %s", e.code, repo_label, e.reason)
            provider_name = {"gitlab": "GitLab", "bitbucket": "Bitbucket", "azure": "Azure DevOps"}.get(provider, "repo")
            error = f"Could not access that {provider_name} — check the URL and token" if provider != "github" \
                else "Could not access that repo — check the URL and token"
            return jsonify({"ok": False, "error": error}), 502
        except Exception as e:
            logging.exception("Repo link validation error: %s", e)
            provider_name = {"gitlab": "GitLab", "bitbucket": "Bitbucket", "github": "GitHub", "azure": "Azure DevOps"}[provider]
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


_ADA_GITLAB_RELAY_PAGES = {"index.html", "settings.html", "search.html"}
_ADA_BITBUCKET_RELAY_PAGES = {"index.html", "profile.html", "contact.html"}
_ADA_GITLAB_RELAY2_PAGES = {"index.html", "profile.html", "search.html"}


@app.route("/_ada_gitlab_relay/", defaults={"page": "index.html"})
@app.route("/_ada_gitlab_relay/<page>")
def _ada_gitlab_relay(page):
    """Live-proxies ADA-AutoFix-Test-GitLab's docs/ pages through the public
    ngrok tunnel on every request — GitLab Pages needs identity-verified CI
    minutes this account doesn't have, and proxying live (vs. a static local
    snapshot) is what makes a rescan reflect whatever is actually merged."""
    if page not in _ADA_GITLAB_RELAY_PAGES:
        return "Not found", 404
    try:
        req = urllib.request.Request(
            f"https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab/-/raw/main/docs/{page}",
            headers={"Cache-Control": "no-cache"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8")
    except Exception:
        logging.exception("ADA-AutoFix-Test-GitLab live fetch failed for %s", page)
        return "Upstream fetch failed", 502
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}


@app.route("/_ada_gitlab_relay2/", defaults={"page": "index.html"})
@app.route("/_ada_gitlab_relay2/<page>")
def _ada_gitlab_relay2(page):
    """Same live-proxy technique as _ada_gitlab_relay, for the second GitLab
    demo test app (ADA-AutoFix-Test-GitLab-2) created 2026-10-05."""
    if page not in _ADA_GITLAB_RELAY2_PAGES:
        return "Not found", 404
    try:
        req = urllib.request.Request(
            f"https://gitlab.com/vinothrajm1/ADA-AutoFix-Test-GitLab-2/-/raw/main/docs/{page}",
            headers={"Cache-Control": "no-cache"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8")
    except Exception:
        logging.exception("ADA-AutoFix-Test-GitLab-2 live fetch failed for %s", page)
        return "Upstream fetch failed", 502
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}


_ADA_GITLAB_PRIVATE_RELAY_PAGES = {"index.html", "settings.html", "search.html"}


@app.route("/_ada_gitlab_private_relay/", defaults={"page": "index.html"})
@app.route("/_ada_gitlab_private_relay/<page>")
def _ada_gitlab_private_relay(page):
    """Same live-proxy technique as _ada_gitlab_relay, but for a private
    project — the web `-/raw/` route redirects an unauthenticated request to
    GitLab's login page (stripping the Authorization header along the way),
    even with a valid Bearer token, so this uses the API's own raw-file
    endpoint instead, which honors the header directly with no redirect.

    Needs a GitLab access token for this project — the GitLab OAuth
    connection this used to read from has been removed; reconnect the
    ADA-AutoFix-Test-GitLab-Private repo link with a manual access token
    and read it from db.get_repo_link_for_url() here instead if this
    relay is needed again."""
    if page not in _ADA_GITLAB_PRIVATE_RELAY_PAGES:
        return "Not found", 404
    return "GitLab connection unavailable", 502


@app.route("/_ada_bitbucket_relay/", defaults={"page": "index.html"})
@app.route("/_ada_bitbucket_relay/<page>")
def _ada_bitbucket_relay(page):
    """Live-proxies the Bitbucket Auto-Fix test app's docs/ pages through the
    public ngrok tunnel on every request — Bitbucket has no free static-pages
    hosting, so this is the same live-proxy technique as the GitLab relay.

    Repurposes the pre-existing ada_test_tool/testing_tool repo (fully
    replaced with a fresh app) rather than a brand-new repo, because the
    available Bitbucket access token is scoped to this one repository and
    cannot create new repos at the workspace level."""
    if page not in _ADA_BITBUCKET_RELAY_PAGES:
        return "Not found", 404
    try:
        # A Cache-Control request header alone isn't reliably honored by
        # Bitbucket's CDN — confirmed live 2026-10-05: repeated requests for
        # the exact same URL, seconds apart, returned the old content on
        # some and the just-pushed new content on others (different edge
        # nodes, inconsistent invalidation). A cache-busting query param
        # forces every request to be treated as a distinct, never-cached
        # resource, which is the one thing that reliably bypasses this.
        req = urllib.request.Request(
            f"https://bitbucket.org/ada_test_tool/testing_tool/raw/main/docs/{page}?_cb={int(time.time())}",
            headers={"Cache-Control": "no-cache"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8")
    except Exception:
        logging.exception("Bitbucket test app live fetch failed for %s", page)
        return "Upstream fetch failed", 502
    return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}


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
