"""_CrawlState: the shared queue the crawl's worker threads pull pages from."""
import threading
from unittest.mock import patch

from backend.services import crawl_task
from backend.services.crawl_task import _CrawlState


def _state(max_pages=3):
    return _CrawlState("CRAWL-T", "https://s.com/", "s.com", max_depth=2, max_pages=max_pages, assisted=False)


@patch.object(crawl_task, "inmemory_get_status", return_value="running")
@patch.object(crawl_task, "db")
def test_page_budget_and_no_duplicates(db, _status):
    c = _state(max_pages=3)
    assert c.next_page() == ("https://s.com/", None, 0)
    c.add_links(["https://s.com/a", "https://s.com/a/", "https://s.com/b", "https://s.com/c"], "https://s.com/", 1)
    c.finish_page(True)
    got = [c.next_page()[0], c.next_page()[0]]
    assert got == ["https://s.com/a", "https://s.com/b"]          # /a/ was a duplicate of /a
    assert c.next_page() is None                                  # 3-page budget used, /c never claimed
    c.finish_page(True); c.finish_page(False)
    assert (c.scanned, c.failed) == (2, 1)


@patch.object(crawl_task, "inmemory_get_status", return_value="running")
@patch.object(crawl_task, "db")
def test_idle_worker_waits_for_links_from_a_busy_one(db, _status):
    c = _state(max_pages=5)
    c.next_page()                                                 # worker A busy on the root page
    out = []
    t = threading.Thread(target=lambda: out.append(c.next_page()))
    t.start()                                                     # worker B: queue empty, A still busy -> waits
    t.join(0.3); assert t.is_alive()
    c.add_links(["https://s.com/x"], "https://s.com/", 1)         # A finds a link
    t.join(2); assert out == [("https://s.com/x", "https://s.com/", 1)]


@patch.object(crawl_task, "db")
def test_cancel_and_finish(db):
    c = _state()
    with patch.object(crawl_task, "inmemory_get_status", return_value="cancelled"):
        assert c.next_page() is None and c.cancelled
    c2 = _state()
    with patch.object(crawl_task, "inmemory_get_status", return_value="running"):
        c2.next_page(); c2.finish_page(True)
        assert c2.next_page() is None                             # nothing queued, nobody busy -> done


def test_settle_stops_once_the_page_stops_growing():
    from unittest.mock import MagicMock
    page = MagicMock()
    page.evaluate.side_effect = [500, 900, 905]          # grew, then stable
    crawl_task._settle(page)
    page.wait_for_load_state.assert_called_once_with("load", timeout=5000)
    assert page.wait_for_timeout.call_count == 2        # 1s after first count, 1s after growth


def test_settle_is_capped_and_survives_a_redirect():
    from unittest.mock import MagicMock
    page = MagicMock()
    page.evaluate.side_effect = [100, RuntimeError("Execution context was destroyed"), 300, 600, 1200]  # keeps growing
    crawl_task._settle(page)
    assert page.wait_for_timeout.call_count == 5        # hard cap: at most 5s after load
