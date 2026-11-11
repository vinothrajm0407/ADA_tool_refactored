from scripts.run_ada_check_python import bot_challenge_reason


def test_cloudflare_challenge_page_is_detected():
    html = '<html><head><title>Just a moment...</title></head><body>Performing security verification <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=1"></script> cf-chl</body></html>'
    reason = bot_challenge_reason(403, "Just a moment...", html)
    assert reason and "Cloudflare" in reason and "403" in reason


def test_blocking_status_plus_vendor_marker_is_detected_even_with_odd_title():
    assert bot_challenge_reason(403, "tommyjohn.com", '<script src="https://geo.captcha-delivery.com/x.js">')


def test_normal_page_with_vendor_script_is_not_a_challenge():
    # Protected sites embed Cloudflare's script on ordinary 200 pages too.
    html = '<title>Shop</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script> cloudflare'
    assert bot_challenge_reason(200, "Shop | Tommy John", html) is None
    assert bot_challenge_reason(None, "Home", "<html></html>") is None


def test_forbidden_page_without_vendor_name_is_blocked():
    # A QA site's "Restricted Site" and eBay's "Error Page" (both HTTP 403) scored as real pages.
    assert bot_challenge_reason(403, "Restricted Site", "<body><h1>Access Restricted</h1><a href='/x'>Contact</a></body>")
    assert bot_challenge_reason(403, "Error Page | eBay", "<body>SORRY Something went wrong</body>")


def test_amazon_continue_shopping_gate_is_blocked():
    gate = '<h4>Click the button below to continue shopping</h4><form method="get" action="/errors_page/validateCaptcha">'
    assert "Amazon" in bot_challenge_reason(200, "Amazon.com", gate)


def test_person_check_waits_for_real_content_not_just_the_gate_going_away():
    from scripts import run_ada_check_python as m
    pages = iter([("Amazon.com", '<form action="/errors_page/validateCaptcha">'),  # gate
                  ("", "<html><body></body></html>"),                              # gate gone, still blank
                  ("Amazon.com", '<body><a href="/deals">Deals</a></body>')])      # real store
    calls = []

    class Page:
        def bring_to_front(self): pass
        def wait_for_timeout(self, ms): calls.append(ms)
    m_page = Page()
    orig = (m.page_title_and_html, m.settle)
    m.page_title_and_html, m.settle = (lambda p: next(pages)), (lambda p: calls.append("settled"))
    try:
        assert m.wait_for_person_to_verify(m_page, seconds=60)
    finally:
        m.page_title_and_html, m.settle = orig
    assert calls == [2000, 2000, 2000, "settled"]


def test_vendor_challenge_with_ok_status_and_too_many_requests_are_blocked():
    datadome = '<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe></body></html>'
    assert bot_challenge_reason(200, "reuters.com", datadome)
    assert bot_challenge_reason(429, "Too Many Requests", "<body>Too Many Requests</body>")
    # a normal page that embeds the vendor's script still passes
    assert bot_challenge_reason(200, "News", '<script src="https://js.datadome.co/tags.js"></script><a href="/world">World</a>') is None


def test_empty_page_is_blocked_but_a_real_page_is_not():
    blank = "<html><head><script>var x=1</script><style>p{}</style></head><body> <div>&nbsp;</div></body></html>"
    assert "empty page" in bot_challenge_reason(202, "Amazon.com", blank)
    assert bot_challenge_reason(200, "Home", "<body><p>Welcome</p></body>") is None
    assert bot_challenge_reason(200, "Home", "<body><img src='hero.jpg'></body>") is None


def test_crawl_stops_after_three_blocked_pages_in_a_row(monkeypatch):
    from backend.services import crawl_task
    monkeypatch.setattr(crawl_task.db, "update_crawl_job_progress", lambda *a, **k: None)
    monkeypatch.setattr(crawl_task, "inmemory_update_crawl", lambda *a, **k: None)
    c = crawl_task._CrawlState("C1", "https://x.test/", "x.test", 3, 50, False)
    c.page_blocked("403"); c.page_blocked("403")
    c.active = 1; c.finish_page(True)  # a scanned page in between resets the count
    c.page_blocked("403"); c.page_blocked("403")
    assert c.error is None
    c.page_blocked("403")
    assert "3 pages in a row" in str(c.error) and "1 page(s) scanned" in str(c.error)


def test_scanner_user_agent_keeps_browser_ua_and_adds_tag():
    from types import SimpleNamespace
    from scripts.run_ada_check_python import scanner_user_agent
    ua = scanner_user_agent(SimpleNamespace(version="145.0.7632.6"))
    assert ua.startswith("Mozilla/5.0 (") and "HeadlessChrome/145.0.7632.6" in ua
    assert ua.endswith("ADA-Accessibility-Scanner/1.0")
