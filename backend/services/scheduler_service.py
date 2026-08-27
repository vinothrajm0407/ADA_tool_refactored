"""
Scheduler Service — background thread that fires due CrawlSchedule entries.

Started once from app.py at startup. Uses a simple polling loop (no APScheduler
dependency). Checks every SCHEDULER_INTERVAL_SECONDS (default 60 s).

Concurrency guard: skips a schedule if a crawl is already running for the
same root URL, logging the skip reason.
"""
import logging
import threading
import time

from config import Config

logger = logging.getLogger(__name__)

_started = False
_lock = threading.Lock()


def start_scheduler() -> None:
    """Spawn the background scheduler thread (idempotent — safe to call multiple times)."""
    global _started
    if not Config.SCHEDULER_ENABLED:
        logger.info("Scheduler disabled (SCHEDULER_ENABLED=false)")
        return
    with _lock:
        if _started:
            return
        _started = True

    t = threading.Thread(target=_scheduler_loop, daemon=True, name="CrawlScheduler")
    t.start()
    logger.info("CrawlScheduler started (interval=%ds)", Config.SCHEDULER_INTERVAL_SECONDS)


def _scheduler_loop() -> None:
    while True:
        try:
            _tick()
        except Exception:
            logger.exception("Scheduler tick error")
        time.sleep(Config.SCHEDULER_INTERVAL_SECONDS)


def _tick() -> None:
    from services import db
    from backend.services.crawl_service import create_crawl_job

    due = db.get_due_schedules()
    if not due:
        return

    logger.info("Scheduler: %d due schedule(s) found", len(due))

    for sched in due:
        sid = sched["id"]
        url = sched["root_url"]
        freq = sched["frequency"]
        time_of_day = sched.get("time_of_day")

        if db.has_active_crawl_for_url(url):
            logger.info(
                "Scheduler: skipping schedule id=%s url=%s — crawl already active",
                sid, url,
            )
            db.mark_schedule_ran(sid, freq, time_of_day=time_of_day)  # advance NextRunAt so we don't retry in the same window
            continue

        try:
            job = create_crawl_job(url, {})
            db.mark_schedule_ran(sid, freq, time_of_day=time_of_day)
            logger.info(
                "Scheduler: triggered crawl_id=%s for schedule id=%s url=%s freq=%s",
                job.get("crawl_id"), sid, url, freq,
            )
        except Exception:
            logger.exception(
                "Scheduler: failed to create crawl for schedule id=%s url=%s", sid, url
            )
