"""
Crawl service: create crawl jobs, poll status, list pages.

When MSSQL is unavailable the module maintains an in-memory fallback store so
that the frontend can still poll status and see pages as they are scanned.
"""
import logging
import uuid
from datetime import datetime, timezone

from config import Config
from services import db
from backend.services.scan_service import get_queue_service
from services.url_validation import validate_url_for_scan

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ── In-memory fallback (used when MSSQL is not configured) ──────────────────
_inmemory_crawls: dict[str, dict] = {}
_inmemory_pages: dict[str, list] = {}


def inmemory_update_crawl(crawl_id: str, **fields) -> None:
    if crawl_id in _inmemory_crawls:
        _inmemory_crawls[crawl_id].update(fields)


def inmemory_append_page(crawl_id: str, page: dict) -> int:
    """Append a page dict and return its index (used as page_id for updates)."""
    bucket = _inmemory_pages.setdefault(crawl_id, [])
    bucket.append(dict(page))
    return len(bucket) - 1


def inmemory_update_page(crawl_id: str, page_idx: int, **fields) -> None:
    bucket = _inmemory_pages.get(crawl_id, [])
    if 0 <= page_idx < len(bucket):
        bucket[page_idx].update(fields)


def inmemory_get_pages(crawl_id: str) -> list[dict]:
    return list(_inmemory_pages.get(crawl_id, []))


def inmemory_get_status(crawl_id: str) -> str | None:
    return _inmemory_crawls.get(crawl_id, {}).get("status")


def cancel_crawl_job(crawl_id: str) -> bool:
    """Mark a running/pending crawl as cancelled. Returns True if the job existed."""
    record = _inmemory_crawls.get(crawl_id) or db.get_crawl_job(crawl_id)
    if not record:
        return False
    ended_at = _utcnow_iso()
    db.update_crawl_job_status(crawl_id, "cancelled", ended_at=ended_at)
    inmemory_update_crawl(crawl_id, status="cancelled", ended_at=ended_at)
    return True


# ── Service functions ────────────────────────────────────────────────────────

def _new_crawl_id() -> str:
    return f"CRAWL-{uuid.uuid4().hex[:12].upper()}"


def create_crawl_job(root_url: str, options: dict | None = None) -> dict:
    """
    Persist a CrawlJob row then enqueue the crawl task.
    Falls back to an in-memory record when the database is unavailable.
    """
    from backend.services.crawl_task import crawl_site_task

    validate_url_for_scan(root_url)
    options = options or {}
    if options.get("compare_signed_out") and options.get("login"):
        # Two linked crawls, run side by side: signed out and logged in, so the
        # results page can compare the same site both ways.
        out_id, in_id = _new_crawl_id(), _new_crawl_id()
        base = {**options, "compare_signed_out": False}
        create_crawl_job(root_url, {**base, "login": None, "crawl_id": out_id,
                                    "pair": {"crawl_id": in_id, "role": "signed_out"}})
        logged_in = create_crawl_job(root_url, {**base, "crawl_id": in_id,
                                                "pair": {"crawl_id": out_id, "role": "logged_in"}})
        return {**logged_in, "pair_crawl_id": out_id}
    full_site = bool(options.get("full_site", False))
    notify_email = (options.get("notify_email") or "").strip() or None
    user_id = options.get("user_id")
    assisted = bool(options.get("assisted"))
    login = options.get("login")
    if login:
        validate_url_for_scan(login["url"])
    if full_site:
        max_depth = Config.CRAWL_MAX_DEPTH_FULL
        max_pages = Config.CRAWL_MAX_PAGES_FULL
    else:
        max_depth = max(1, min(int(options.get("max_depth") or Config.CRAWL_MAX_DEPTH), 100))
        max_pages = max(1, min(int(options.get("max_pages") or Config.CRAWL_MAX_PAGES), 500))

    # Kept with the crawl so Re-crawl can log in again — the password never is.
    saved_login = {"assisted": assisted, **({"login": {k: login.get(k) for k in
                   ("url", "username", "username_selector", "password_selector")}} if login else {})}
    extra_urls = options.get("extra_urls") or []
    for u in extra_urls:
        validate_url_for_scan(u)
    if extra_urls:
        saved_login["extra_urls"] = extra_urls
    pair = options.get("pair")  # {"crawl_id": the other crawl, "role": this crawl's role}
    if pair:
        saved_login["pair"] = pair
    crawl_id = options.get("crawl_id") or _new_crawl_id()
    created_at = _utcnow_iso()

    # Always attempt DB write (no-op when DB unavailable)
    db.save_crawl_job(
        crawl_id=crawl_id,
        root_url=root_url,
        max_depth=max_depth,
        max_pages=max_pages,
        status="pending",
        created_at=created_at,
        notify_email=notify_email,
        metadata=saved_login,
    )

    # In-memory fallback: seed the record so status polling works immediately
    _inmemory_crawls[crawl_id] = {
        "crawl_id": crawl_id,
        "root_url": root_url,
        "max_depth": max_depth,
        "max_pages": max_pages,
        "status": "pending",
        "total_discovered": 0,
        "total_scanned": 0,
        "total_failed": 0,
        "created_at": created_at,
        "started_at": None,
        "ended_at": None,
        "duration_seconds": None,
        "failure_reason": None,
        "notify_email": notify_email,
        **saved_login,
    }

    qs = get_queue_service()
    job = qs.enqueue_crawl(
        crawl_site_task,
        crawl_id=crawl_id,
        root_url=root_url,
        max_depth=max_depth,
        max_pages=max_pages,
        notify_email=notify_email,
        user_id=user_id,
        assisted=assisted,
        login=login,
        paired=bool(pair),
        extra_urls=extra_urls,
    )
    rq_job_id = str(getattr(job, "id", "")) or None

    logger.info(
        "Crawl job created | crawl_id=%s url=%s rq_job_id=%s",
        crawl_id, root_url, rq_job_id,
    )
    return {
        "crawl_id": crawl_id,
        "root_url": root_url,
        "max_depth": max_depth,
        "max_pages": max_pages,
        "status": "pending",
        "rq_job_id": rq_job_id,
        "notify_email": notify_email,
        "created_at": created_at,
    }


def get_crawl_status(crawl_id: str) -> dict | None:
    result = db.get_crawl_job(crawl_id)
    if result is None:
        # Fall back to in-memory record (DB unavailable or job not persisted)
        return _inmemory_crawls.get(crawl_id)
    return result


def get_crawl_pages(crawl_id: str) -> list[dict]:
    pages = db.get_crawl_pages(crawl_id)
    if not pages:
        return inmemory_get_pages(crawl_id)
    return pages
