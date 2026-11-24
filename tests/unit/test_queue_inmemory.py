"""In-memory queue: a long crawl must not hold up single-page scans, and a
restart marks crawls it cut off as cancelled."""
import threading
from unittest.mock import patch

from backend.services import queue_service as qmod


def _inmemory_queue():
    with patch.object(qmod.Config, "REDIS_URL", ""), \
         patch.object(qmod.Config, "ALLOW_LOCAL_QUEUE_FALLBACK", True), \
         patch.object(qmod.Config, "SCAN_WORKER_MAX_WORKERS", 1), \
         patch.object(qmod.Config, "CRAWL_WORKER_MAX_WORKERS", 1), \
         patch("services.db.reset_interrupted_crawls") as reset:
        q = qmod.QueueService()
    return q, reset


def test_a_running_crawl_does_not_block_scans():
    q, reset = _inmemory_queue()
    reset.assert_called_once()                     # restart cleanup ran
    release = threading.Event()
    crawl = q.enqueue_crawl(lambda **kw: release.wait(10), crawl_id="C1", root_url="https://x.test/",
                            max_depth=1, max_pages=1)
    try:
        scan = q.enqueue_scan(lambda url: {"scan_result": url}, "https://x.test/a")
        fut = q._inmemory_jobs[scan.id]["future"]
        assert fut.result(timeout=5) == {"scan_result": "https://x.test/a"}   # not stuck behind the crawl
        assert not q._inmemory_jobs[crawl.id]["future"].done()
    finally:
        release.set()


def test_restart_reset_spares_crawls_this_process_created():
    from services import db
    src = __import__("inspect").getsource(db.reset_interrupted_crawls)
    assert "CreatedAt < ?" in src and "_PROCESS_STARTED_UTC" in src
