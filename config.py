import os


def _int_env(name: str, default: int) -> int:
    """Parse an int env var, tolerating unset OR blank-string values (e.g. an
    empty field left in a hosting dashboard) by falling back to default."""
    raw = (os.getenv(name) or "").strip()
    return int(raw) if raw else default


def _parse_int_list(value: str, default: str) -> list[int]:
    raw = os.getenv(value, default)
    return [int(item) for item in (raw or "").split(",") if item.strip().isdigit()]


class Config:
    REDIS_URL = os.getenv("REDIS_URL", "")
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    SCAN_QUEUE_NAME = os.getenv("SCAN_QUEUE_NAME", "ada_scan_queue")
    SCAN_WORKER_MAX_WORKERS = _int_env("SCAN_WORKER_MAX_WORKERS", 2)
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    APP_ENV = os.getenv("APP_ENV", os.getenv("FLASK_ENV", "development"))
    IS_PRODUCTION = APP_ENV.lower() == "production"
    SCAN_TIMEOUT_SECONDS = _int_env("SCAN_TIMEOUT_SECONDS", 300)
    SCAN_JOB_RETRY_MAX = _int_env("SCAN_JOB_RETRY_MAX", 2)
    SCAN_JOB_RETRY_INTERVALS = _parse_int_list("SCAN_JOB_RETRY_INTERVALS", "15,30")
    SCAN_JOB_RESULT_TTL = _int_env("SCAN_JOB_RESULT_TTL", 86400)
    SCAN_JOB_FAILURE_TTL = _int_env("SCAN_JOB_FAILURE_TTL", 604800)
    ALLOW_LOCAL_QUEUE_FALLBACK = os.getenv(
        "ALLOW_LOCAL_QUEUE_FALLBACK",
        "true" if not IS_PRODUCTION else "false",
    ).lower() in ("1", "true", "yes")
    # Crawler defaults
    CRAWL_MAX_DEPTH = _int_env("CRAWL_MAX_DEPTH", 3)
    CRAWL_MAX_PAGES = _int_env("CRAWL_MAX_PAGES", 50)
    CRAWL_TIMEOUT_SECONDS = _int_env("CRAWL_TIMEOUT_SECONDS", 1800)
    # Full-site crawl ceilings (used when fullSite=true is sent from the UI)
    CRAWL_MAX_PAGES_FULL = _int_env("CRAWL_MAX_PAGES_FULL", 10000)
    CRAWL_MAX_DEPTH_FULL = _int_env("CRAWL_MAX_DEPTH_FULL", 10)
    # Email notification — crawl completion reports (all optional)
    SMTP_ENABLED = os.getenv("SMTP_ENABLED", "false").lower() in ("1", "true", "yes")
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = _int_env("SMTP_PORT", 587)
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    SMTP_FROM = os.getenv("SMTP_FROM", "")
    APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:5000")
    # Phase 3 — AI summary (Feature 2)
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    AI_SUMMARY_ENABLED = bool(os.getenv("ANTHROPIC_API_KEY", ""))
    AI_SUMMARY_MODEL = os.getenv("AI_SUMMARY_MODEL", "claude-sonnet-4-6")
    # Phase 3 — Alert thresholds (Feature 3)
    ALERT_SCORE_DROP_THRESHOLD = _int_env("ALERT_SCORE_DROP_THRESHOLD", 5)
    ALERT_VIOLATION_INCREASE_THRESHOLD = _int_env("ALERT_VIOLATION_INCREASE_THRESHOLD", 10)
    ALERT_EMAIL = os.getenv("ALERT_EMAIL", "")  # defaults to notify_email of the job
    # Phase 3 — Scheduler (Feature 1)
    SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() in ("1", "true", "yes")
    SCHEDULER_INTERVAL_SECONDS = _int_env("SCHEDULER_INTERVAL_SECONDS", 60)
    # Auth
    JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
    if IS_PRODUCTION and JWT_SECRET == "change-me-in-production-use-a-long-random-string":
        raise RuntimeError(
            "JWT_SECRET must be set to a strong random value in production. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    JWT_EXPIRE_HOURS = _int_env("JWT_EXPIRE_HOURS", 24)
    EMAIL_VERIFY_EXPIRE_HOURS = _int_env("EMAIL_VERIFY_EXPIRE_HOURS", 24)
    PASSWORD_RESET_EXPIRE_HOURS = _int_env("PASSWORD_RESET_EXPIRE_HOURS", 1)
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
    # Slack integration (OAuth bot token flow)
    SLACK_CLIENT_ID     = os.getenv("SLACK_CLIENT_ID", "")
    SLACK_CLIENT_SECRET = os.getenv("SLACK_CLIENT_SECRET", "")
    SLACK_ENABLED       = bool(os.getenv("SLACK_CLIENT_ID", ""))
