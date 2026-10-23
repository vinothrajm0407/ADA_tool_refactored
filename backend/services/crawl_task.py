"""
RQ task: BFS site crawl with per-page axe accessibility scan.
One Playwright browser is opened for the entire crawl session.
"""
import json
import logging
import threading
from collections import deque
from datetime import datetime, timezone

from config import Config
from services import db
from services.crawler import get_root_domain, normalize_url, extract_internal_links
from scripts.run_ada_check_python import (
    bot_challenge_reason, page_title_and_html, scanner_user_agent, wait_for_person_to_verify,
)

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


def _aggregate_crawl_violations(crawl_id: str, max_pages: int = 60) -> list[dict]:
    """
    Tally violations by rule id across every scanned page in the crawl, for the
    full-detail Slack/Teams report. Reads each page's stored axe result (already
    persisted by save_scan_history during the crawl) rather than re-scanning.
    Best-effort: any DB error here must not break crawl completion.
    """
    tally: dict[str, dict] = {}
    try:
        pages = db.get_crawl_pages(crawl_id)[:max_pages]
        for page in pages:
            try:
                result = db.get_crawl_page_result(crawl_id, page["id"])
            except Exception:
                continue
            for v in ((result or {}).get("axeResult") or {}).get("violations") or []:
                rule_id = v.get("id", "")
                if not rule_id:
                    continue
                entry = tally.setdefault(rule_id, {
                    "rule_id": rule_id,
                    "impact": v.get("impact"),
                    "description": v.get("description") or v.get("help"),
                    "wcag_tags": [t for t in (v.get("tags") or []) if t.startswith("wcag")],
                    "help_url": v.get("helpUrl"),
                    "affected_count": 0,
                    "pages_affected": 0,
                    "example_selector": None,
                })
                entry["affected_count"] += len(v.get("nodes") or [])
                entry["pages_affected"] += 1
                if not entry["example_selector"]:
                    entry["example_selector"] = (((v.get("nodes") or [{}])[0]).get("target") or [None])[0]
    except Exception:
        logger.exception("Failed to aggregate crawl violations for %s", crawl_id)
    return sorted(tally.values(), key=lambda e: e["affected_count"], reverse=True)


def _duration(started: str, ended: str) -> float | None:
    try:
        return (
            datetime.fromisoformat(ended.replace("Z", "+00:00"))
            - datetime.fromisoformat(started.replace("Z", "+00:00"))
        ).total_seconds()
    except Exception:
        return None


class _CrawlState:
    """Shared by the crawl's worker threads: the BFS queue, what's been seen,
    and the counters. Every read-modify-write goes through `lock`."""

    def __init__(self, crawl_id, root_url, root_domain, max_depth, max_pages, assisted, fast=False):
        self.crawl_id, self.root_url, self.root_domain = crawl_id, root_url, root_domain
        self.max_depth, self.max_pages, self.assisted, self.fast = max_depth, max_pages, assisted, fast
        self.queue: deque[tuple[str, str | None, int]] = deque([(root_url, None, 0)])
        self.visited: set[str] = {normalize_url(root_url)}
        self.claimed = self.scanned = self.failed = self.active = 0
        self.cancelled = False
        self.error: Exception | None = None
        self.lock = threading.Lock()
        self.more_work = threading.Condition(self.lock)

    def next_page(self):
        """The next (url, parent_url, depth) to scan, or None when the crawl is
        done: page budget used, cancelled, or nothing queued and no worker
        still scanning (a busy worker may yet add links)."""
        while True:
            status = inmemory_get_status(self.crawl_id) or db.get_crawl_job_status(self.crawl_id)
            with self.lock:
                if status == "cancelled":
                    self.cancelled = True
                if self.cancelled or self.error or self.claimed >= self.max_pages:
                    return None
                if self.queue:
                    self.claimed += 1
                    self.active += 1
                    return self.queue.popleft()
                if self.active == 0:
                    return None
                self.more_work.wait(timeout=1.0)

    def add_links(self, links, parent_url, depth):
        with self.lock:
            for link in links:
                n = normalize_url(link)
                if n not in self.visited and len(self.visited) < self.max_pages * 3:
                    self.visited.add(n)
                    self.queue.append((link, parent_url, depth))
            self.more_work.notify_all()

    def finish_page(self, ok: bool):
        with self.lock:
            self.active -= 1
            if ok:
                self.scanned += 1
            else:
                self.failed += 1
            progress = dict(total_discovered=len(self.visited), total_scanned=self.scanned, total_failed=self.failed)
            self.more_work.notify_all()
        db.update_crawl_job_progress(self.crawl_id, **progress)
        inmemory_update_crawl(self.crawl_id, **progress)


def _crawl_worker(c: _CrawlState) -> None:
    """One browser; scans pages from the shared queue until the crawl is done."""
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    from axe_playwright_python.sync_playwright import Axe
    try:
        with sync_playwright() as p:
            # assisted: a visible window on this computer, so a person can pass a
            # site's bot check (usually once — the clearance cookie then covers
            # the rest of the crawl). Same idea as the assisted page scan.
            browser = p.chromium.launch(headless=not c.assisted)
            context = browser.new_context(
                # Matches the single-page scan path's viewport (see
                # scripts/run_ada_check_python.py) — a narrower viewport
                # shows fewer items per row on responsive grid layouts,
                # under-catching repeated-component bugs vs. a normal
                # desktop-width browser window.
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True,
                user_agent=scanner_user_agent(browser, headless=not c.assisted),
            )
            pw_page = context.new_page()
            axe = Axe()
            while (item := c.next_page()) is not None:
                url, parent_url, depth = item
                c.finish_page(_scan_one_page(c, pw_page, axe, PWTimeout, url, parent_url, depth))
            context.close()
            browser.close()
    except Exception as exc:  # e.g. the browser failed to start: stops the whole crawl
        with c.lock:
            c.error = c.error or exc
            c.more_work.notify_all()


def _settle(pw_page, fast: bool) -> None:
    """Let JavaScript-rendered content appear before axe runs.

    Default: a fixed 3s. fast: wait for the page's load event (max 5s) plus
    1s — measured 2026-10-23 on 20 pages: 1.7-2.4x quicker, identical results
    on 18/20, but on one heavy site (booking.com) it missed issues that render
    late. So it's an opt-in "Fast crawl", not the default."""
    if not fast:
        pw_page.wait_for_timeout(3000)
        return
    try:
        pw_page.wait_for_load_state("load", timeout=5000)
    except Exception:
        pass
    pw_page.wait_for_timeout(1000)


def _scan_one_page(c: _CrawlState, pw_page, axe, PWTimeout, url, parent_url, depth) -> bool:
    """Load, check and axe-scan one page, and persist it. True if scanned."""
    crawl_id = c.crawl_id
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
    with c.lock:
        page_id = db.save_crawl_page(
            crawl_id, url, norm_url, parent_url, depth, status="running"
        )
        page_idx = inmemory_append_page(crawl_id, page_base)
    scanned_at = _utcnow_iso()

    try:
        try:
            # domcontentloaded + a short settle, not networkidle —
            # networkidle waits for 500ms of zero network activity,
            # which real sites with analytics beacons, ad trackers,
            # or polling never actually reach, so it was routinely
            # burning most of the 60s timeout on every single page.
            # Matches the single-page scan path's own approach.
            # A "poll until the DOM stops growing" variant was
            # tried and reverted here too (see that file's comment)
            # — unreliable on pages with continuous third-party
            # script churn that never actually goes quiet.
            response = pw_page.goto(url, wait_until="domcontentloaded", timeout=30000)
            _settle(pw_page, c.fast)
        except PWTimeout:
            response = None  # proceed with what loaded
        # A bot-protection challenge page is not the site — fail this
        # page with the reason instead of scoring the challenge page.
        blocked = bot_challenge_reason(response.status if response else None,
                                       *page_title_and_html(pw_page))
        if blocked and c.assisted and wait_for_person_to_verify(pw_page):
            blocked = None
        if blocked:
            raise RuntimeError(blocked)

        # Discover child links on the already-loaded page
        if depth < c.max_depth:
            c.add_links(extract_internal_links(pw_page, c.root_url, c.root_domain), url, depth + 1)

        # Run axe accessibility scan — same tag set as the single-page
        # scan path (scripts/run_ada_check_python.py): WCAG 2.0 A/AA,
        # 2.1 A/AA, and 2.2 AA. Missing the 2.1 tags here once made a
        # crawled page under-report violations compared to scanning
        # that exact same URL from Run Audit (confirmed live
        # 2026-10-05: root page showed 4 violations via crawl, 7 via
        # single-page scan) — keep this list in sync with that path.
        try:
            results = axe.run(
                pw_page,
                options={"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]}},
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
        return True

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
        return False


def crawl_site_task(
    crawl_id: str,
    root_url: str,
    max_depth: int,
    max_pages: int,
    notify_email: str = None,
    user_id: int = None,
    assisted: bool = False,
    fast: bool = False,
) -> dict:
    """
    BFS site crawl: CRAWL_CONCURRENCY worker threads, each with its own
    Playwright browser, take pages from a shared queue, run axe on each and
    persist results to DB and the in-memory fallback.
    """
    started_at = _utcnow_iso()
    db.update_crawl_job_status(crawl_id, "running", started_at=started_at)
    inmemory_update_crawl(crawl_id, status="running", started_at=started_at)
    logger.info(
        "Crawl started | crawl_id=%s url=%s depth=%d pages=%d",
        crawl_id, root_url, max_depth, max_pages,
    )

    root_domain = get_root_domain(root_url)
    c = _CrawlState(crawl_id, root_url, root_domain, max_depth, max_pages, assisted, fast)
    # Several pages at once, each worker with its own browser: about half of a
    # page's time is the fixed settle wait (measured 2026-10-22), so scanning
    # one page at a time left the machine idle. An assisted crawl keeps a single
    # visible window, since a person may be verifying in it.
    workers = 1 if assisted else max(1, Config.CRAWL_CONCURRENCY)

    try:
        threads = [threading.Thread(target=_crawl_worker, args=(c,), daemon=True,
                                    name=f"crawl-{crawl_id}-{n}") for n in range(workers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        if c.error:
            raise c.error
        visited, total_scanned, total_failed, was_cancelled = c.visited, c.scanned, c.failed, c.cancelled

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

    # Phase 3 — report delivery (non-blocking, best-effort). Runs after the AI
    # summary step above so the Executive Summary PDF can include it when
    # available. The PDF is sent to Slack as a single file+comment message;
    # Teams always gets its rich-text card (no file-attachment capability),
    # and Slack only falls back to that card if the PDF wasn't delivered.
    if user_id:
        try:
            violations_detail = _aggregate_crawl_violations(crawl_id)
            score = summary.get("site_score") if summary.get("site_score") is not None else "—"
            pass_rate = summary.get("avg_pass_rate") if summary.get("avg_pass_rate") is not None else "—"
            violations = summary.get("total_violations", 0)

            from backend.services.notify_service import auto_share_report, has_slack_integration, send_report_pdf
            pdf_sent = False
            if has_slack_integration(user_id):
                from backend.services.report_pdf_service import render_crawl_executive_summary
                pdf_bytes = render_crawl_executive_summary(crawl_id)
                if pdf_bytes:
                    comment = f"*ADA Crawl Report — {root_url}*\nScore: {score}/100 · Pass rate: {pass_rate}% · Violations: {violations}"
                    pdf_sent = send_report_pdf(user_id, f"executive-summary-{crawl_id}.pdf", pdf_bytes,
                                                reference=crawl_id, initial_comment=comment)

            auto_share_report(user_id, "crawl_summary", {
                "url": root_url,
                "score": score,
                "violations": violations,
                "pass_rate": pass_rate,
                "pages": total_scanned,
                "violations_detail": violations_detail,
                "crawl_id": crawl_id,
                "reference": crawl_id,
                "skip_slack_card": pdf_sent,
            })
        except Exception as _notify_exc:
            logger.warning("Report delivery failed | crawl_id=%s error=%s", crawl_id, _notify_exc)

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
