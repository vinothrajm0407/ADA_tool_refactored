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
