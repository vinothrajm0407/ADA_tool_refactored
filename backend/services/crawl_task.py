"""
RQ task: BFS site crawl with per-page axe accessibility scan.
One Playwright browser is opened for the entire crawl session.
"""
import json
import logging
from collections import deque
from datetime import datetime, timezone

from services import db
from services.crawler import get_root_domain, normalize_url, extract_internal_links

# Import in-memory helpers — no circular import because crawl_service only
# imports crawl_task inside a function body (not at module level).
from backend.services.crawl_service import (
    inmemory_update_crawl,
    inmemory_append_page,
    inmemory_update_page,
    inmemory_get_status,
)

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _duration(started: str, ended: str) -> float | None:
    try:
        return (
            datetime.fromisoformat(ended.replace("Z", "+00:00"))
            - datetime.fromisoformat(started.replace("Z", "+00:00"))
        ).total_seconds()
    except Exception:
        return None


def crawl_site_task(
    crawl_id: str,
    root_url: str,
    max_depth: int,
    max_pages: int,
    notify_email: str = None,
) -> dict:
    """
    BFS site crawl: navigate each page with a shared Playwright browser,
    run axe on each page, persist results to DB and in-memory fallback.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    from axe_playwright_python.sync_playwright import Axe

    started_at = _utcnow_iso()
    db.update_crawl_job_status(crawl_id, "running", started_at=started_at)
    inmemory_update_crawl(crawl_id, status="running", started_at=started_at)
    logger.info(
        "Crawl started | crawl_id=%s url=%s depth=%d pages=%d",
        crawl_id, root_url, max_depth, max_pages,
    )

    root_domain = get_root_domain(root_url)
    queue: deque[tuple[str, str | None, int]] = deque([(root_url, None, 0)])
    visited: set[str] = {normalize_url(root_url)}

    total_scanned = 0
    total_failed = 0
    axe = Axe()
    was_cancelled = False

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                ignore_https_errors=True,
            )
            pw_page = context.new_page()

            while queue and (total_scanned + total_failed) < max_pages:
                # Check for stop signal between pages (thread-pool: in-memory; RQ: DB fallback)
                current_status = inmemory_get_status(crawl_id) or db.get_crawl_job_status(crawl_id)
                if current_status == "cancelled":
                    was_cancelled = True
                    break
                url, parent_url, depth = queue.popleft()
                norm_url = normalize_url(url)

                page_base = {
                    "crawl_id": crawl_id,
                    "url": url,
                    "normalized_url": norm_url,
                    "parent_url": parent_url,
                    "depth": depth,
                    "status": "running",
                    "passes": None,
                    "violations": None,
                    "pass_rate": None,
                    "failure_reason": None,
                }
                page_id = db.save_crawl_page(
                    crawl_id, url, norm_url, parent_url, depth, status="running"
                )
                page_idx = inmemory_append_page(crawl_id, page_base)
                scanned_at = _utcnow_iso()

                try:
                    try:
                        pw_page.goto(url, wait_until="networkidle", timeout=60000)
                    except PWTimeout:
                        pass  # proceed with what loaded

                    # Discover child links on the already-loaded page
                    if depth < max_depth:
                        for link in extract_internal_links(pw_page, root_url, root_domain):
                            n = normalize_url(link)
                            if n not in visited and len(visited) < max_pages * 3:
                                visited.add(n)
                                queue.append((link, url, depth + 1))

                    # Run axe accessibility scan
                    try:
                        results = axe.run(
                            pw_page,
                            options={"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa"]}},
                        )
                    except TypeError:
                        results = axe.run(pw_page)

                    axe_data = (
                        results.response
                        if hasattr(results, "response") and results.response
                        else {}
                    )
                    vcount = len(axe_data.get("violations") or [])
                    pcount = len(axe_data.get("passes") or [])
                    total_items = vcount + pcount
                    pass_rate = int(pcount / total_items * 100) if total_items else 100

                    scan_result = {
                        "url": url,
                        "message": "ADA check completed",
                        "axeResult": axe_data,
                        "includeBestPractices": False,
                        "usedFallback": False,
                    }

                    db.update_crawl_page(
                        page_id,
                        status="scanned",
                        passes=pcount,
                        violations=vcount,
                        pass_rate=pass_rate,
                        result_payload=json.dumps(scan_result),
                        scanned_at=scanned_at,
                    )
                    inmemory_update_page(
                        crawl_id, page_idx,
                        status="scanned",
                        passes=pcount,
                        violations=vcount,
                        pass_rate=pass_rate,
                        scanned_at=scanned_at,
                    )
                    total_scanned += 1

                except Exception as exc:
                    logger.warning(
                        "Page scan failed | crawl_id=%s url=%s reason=%s",
                        crawl_id, url, exc,
                    )
                    db.update_crawl_page(
                        page_id,
                        status="failed",
                        failure_reason=str(exc)[:500],
                    )
                    inmemory_update_page(
                        crawl_id, page_idx,
                        status="failed",
                        failure_reason=str(exc)[:500],
                    )
                    total_failed += 1

                db.update_crawl_job_progress(
                    crawl_id,
                    total_discovered=len(visited),
                    total_scanned=total_scanned,
                    total_failed=total_failed,
                )
                inmemory_update_crawl(
                    crawl_id,
                    total_discovered=len(visited),
                    total_scanned=total_scanned,
                    total_failed=total_failed,
                )

            context.close()
            browser.close()

    except Exception as exc:
        failed_at = _utcnow_iso()
        db.update_crawl_job_status(
            crawl_id, "failed",
            ended_at=failed_at,
            failure_reason=str(exc)[:1000],
        )
        inmemory_update_crawl(
            crawl_id,
            status="failed",
            ended_at=failed_at,
            failure_reason=str(exc)[:1000],
        )
        logger.error(
            "Crawl failed | crawl_id=%s reason=%s", crawl_id, exc, exc_info=True
        )
        raise

    if was_cancelled:
        logger.info("Crawl cancelled | crawl_id=%s scanned=%d", crawl_id, total_scanned)
        return {"crawl_id": crawl_id, "status": "cancelled", "total_scanned": total_scanned}

    completed_at = _utcnow_iso()
    duration = _duration(started_at, completed_at)
    db.update_crawl_job_status(
        crawl_id, "completed",
        ended_at=completed_at,
        duration_seconds=duration,
    )
    inmemory_update_crawl(
        crawl_id,
        status="completed",
        ended_at=completed_at,
        duration_seconds=duration,
    )

    # Compute aggregate metrics and persist to CrawlJob.Metadata
    summary = db.finalize_crawl_summary(crawl_id)
    inmemory_update_crawl(crawl_id, **summary)

    logger.info(
        "Crawl completed | crawl_id=%s scanned=%d failed=%d duration=%.1fs",
        crawl_id, total_scanned, total_failed, duration or 0,
    )

    if notify_email:
        try:
            from backend.services.email_service import send_crawl_report
            sent = send_crawl_report(crawl_id, notify_email)
            logger.info("Email send result | sent=%s to=%s", sent, notify_email)
        except Exception as _email_exc:
            logger.error(
                "Crawl report email failed | crawl_id=%s error=%s",
                crawl_id, _email_exc, exc_info=True,
            )
    else:
        logger.info("Email skipped — notify_email is empty/None")

    # Phase 3 — AI summary (non-blocking, best-effort)
    try:
        from backend.services.ai_summary_service import generate_and_store_summary
        generate_and_store_summary(crawl_id)
    except Exception as _ai_exc:
        logger.warning("AI summary failed | crawl_id=%s error=%s", crawl_id, _ai_exc)

    # Phase 3 — Alert evaluation (non-blocking, best-effort)
    try:
        from backend.services.alert_service import evaluate_and_create_alerts
        alert_ids = evaluate_and_create_alerts(crawl_id)
        if alert_ids:
            logger.info("Alerts created | crawl_id=%s alert_ids=%s", crawl_id, alert_ids)
    except Exception as _alert_exc:
        logger.warning("Alert evaluation failed | crawl_id=%s error=%s", crawl_id, _alert_exc)

    return {
        "crawl_id": crawl_id,
        "root_url": root_url,
        "total_discovered": len(visited),
        "total_scanned": total_scanned,
        "total_failed": total_failed,
        "completed_at": completed_at,
    }
