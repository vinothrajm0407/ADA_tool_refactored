#!/usr/bin/env python3
"""
Run ADA (accessibility) check for a URL using Python: Playwright + axe-core.
Produces axe JSON written to output/ada_result.json, including a base64 screenshot
so the results page can show the tested page.

Requires: pip install axe-playwright-python
          python -m playwright install chromium

Usage: python scripts/run_ada_check_python.py <url>
"""
import base64
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_JSON = PROJECT_ROOT / "output" / "ada_result.json"

# Viewport for consistent screenshots; JPEG quality to keep payload size reasonable.
# Was 1280x800 — confirmed live 2026-10-08 that a narrower viewport shows fewer
# items per row on responsive grid layouts (product listings, card grids) than
# a typical desktop screen does, so a scan here caught fewer instances of the
# same repeated-component bug than axe DevTools running in a normal-width
# browser window. 1920x1080 (common desktop resolution) closes most of that gap
# without giving up a fixed, reproducible scan size.
SCREENSHOT_VIEWPORT = {"width": 1920, "height": 1080}
SCREENSHOT_JPEG_QUALITY = 85
# Each per-violation screenshot costs ~400 ms (Playwright render + JPEG encode).
# Capping at 10 eliminates the long tail on pages with many violations.
MAX_VIOLATION_SCREENSHOTS = 10


def _selector_from_node_target(target):
    """Build a Playwright selector from axe node.target (array of selectors or [frame_sel, inner_sel])."""
    if not target:
        return None
    first = target[0]
    if isinstance(first, str):
        # Single selector or first of multiple; use first so we have one clear locator
        return first
    if isinstance(first, (list, tuple)):
        parts = [p for p in first if p]
        if parts:
            # e.g. ["iframe#f", "button"] -> frame >> inner
            return " >> ".join(parts)
        if len(target) > 1:
            rest = target[1]
            if isinstance(rest, (list, tuple)) and rest:
                return " >> ".join(rest)
            if isinstance(rest, str):
                return rest
    return None


def _remove_best_practice_rules(data: dict) -> dict:
    """Remove rules tagged best-practice when toggle is off."""
    if not isinstance(data, dict):
        return {}
    for key in ("violations", "passes", "incomplete", "inapplicable"):
        rules = data.get(key) or []
        filtered = []
        for rule in rules:
            tags = rule.get("tags") if isinstance(rule, dict) else None
            if isinstance(tags, list) and "best-practice" in tags:
                continue
            filtered.append(rule)
        data[key] = filtered
    return data


def scanner_user_agent(browser, headless: bool = True) -> str:
    """The browser's normal user agent (headless or not) plus an identifying tag
    (Config.SCANNER_UA_TOKEN). Sites render as usual, and site owners can see —
    and allowlist — exactly which visits are our accessibility scans."""
    try:
        from config import Config
        token = Config.SCANNER_UA_TOKEN
    except ImportError:  # run as a standalone script
        token = "ADA-Accessibility-Scanner/1.0"
    platform = {"win32": "Windows NT 10.0; Win64; x64", "darwin": "Macintosh; Intel Mac OS X 10_15_7"}.get(sys.platform, "X11; Linux x86_64")
    return (f"Mozilla/5.0 ({platform}) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"{'HeadlessChrome' if headless else 'Chrome'}/{browser.version} Safari/537.36 {token}").strip()


_CHALLENGE_TITLES = ("just a moment", "attention required", "access denied", "security check",
                     "verify you are human", "pardon our interruption", "request unsuccessful")
_CHALLENGE_VENDORS = (("captcha-delivery.com", "DataDome"), ("_incapsula_resource", "Imperva"),
                      ("px-captcha", "PerimeterX"), ("cf-chl", "Cloudflare"), ("cloudflare", "Cloudflare"),
                      ("akamai", "Akamai"))


def bot_challenge_reason(status: int | None, title: str, html: str) -> str | None:
    """Message when the browser got a bot-protection challenge page instead of the
    site (e.g. Cloudflare's "Just a moment..."), else None. Scanning that page gives
    a meaningless near-perfect score — confirmed 2026-10-22 on a Cloudflare-protected
    store: 1 violation and "Grade A" for the challenge page, while the real page had
    real issues. A known challenge title, or a blocking status plus a vendor marker,
    counts; a vendor script alone doesn't (protected sites embed it on normal pages)."""
    t, h = (title or "").strip().lower(), (html or "").lower()
    vendor = next((name for marker, name in _CHALLENGE_VENDORS if marker in h), None)
    if not (any(t.startswith(x) for x in _CHALLENGE_TITLES) or (status in (403, 429, 503) and vendor)):
        return None
    return (f"Blocked by the site's bot protection ({vendor or 'security check'}"
            f"{f', HTTP {status}' if status else ''}): the scanner was shown a verification page, "
            "not the site, so no valid results. Ask the site owner to allowlist the scanner, then scan again.")


def page_title_and_html(page) -> tuple[str, str]:
    """Title and HTML, tolerating a page that is still navigating (a redirect,
    or a bot check handing over to the real page) — reading mid-navigation
    raises "Execution context was destroyed"."""
    for _ in range(5):
        try:
            return page.title(), page.content()
        except Exception:
            try:
                page.wait_for_load_state("domcontentloaded", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(1000)
    return "", ""


ASSISTED_VERIFY_SECONDS = 120


def wait_for_person_to_verify(page, seconds: int = ASSISTED_VERIFY_SECONDS) -> bool:
    """Assisted scan: the window is visible on the user's own screen, so the
    user can complete the site's "verify you are human" check themselves.
    Poll until the challenge page is gone. True once the real page shows."""
    import time
    page.bring_to_front()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        page.wait_for_timeout(2000)
        if not bot_challenge_reason(None, *page_title_and_html(page)):
            page.wait_for_timeout(3000)  # let the real page settle before axe runs
            return True
    return False


def load_page_checked(page, url: str, assisted: bool = False, timeout: int = 45000, settle_ms: int = 800):
    """Open url and make sure it is the real site, not a bot-protection page.
    assisted: the window is visible, so wait for the person to pass the check.
    Raises RuntimeError with a user-facing reason when blocked. Used by the
    Assistive Testing modules, which each drive their own page."""
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    response = None
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except PlaywrightTimeoutError:
        pass  # proceed with what loaded
    page.wait_for_timeout(settle_ms)
    blocked = bot_challenge_reason(response.status if response else None, *page_title_and_html(page))
    if blocked and assisted and wait_for_person_to_verify(page):
        blocked = None
    if blocked:
        raise RuntimeError(blocked)
    # Some sites redirect again shortly after load (seen on tommyjohn.com ->
    # /pages/explore), which destroys the page mid-test ("Execution context was
    # destroyed"). Wait until the address has stopped changing for 1s.
    for _ in range(10):
        before = page.url
        page.wait_for_timeout(1000)
        if page.url == before:
            break
    try:
        page.wait_for_load_state("domcontentloaded", timeout=15000)
    except Exception:
        pass


def run_axe_playwright(url: str, include_best_practices: bool = False, assisted: bool = False) -> dict:
    """assisted=True opens a visible browser window on this computer, for sites
    whose bot protection blocks headless browsers: if the site shows a
    verification page, the person at the computer completes it, then the scan
    runs on the real page. Only meaningful when the server runs on the user's
    own machine (there is no screen on a hosted server)."""
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    from axe_playwright_python.sync_playwright import Axe

    axe = Axe()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not assisted)
        context = browser.new_context(
            viewport=SCREENSHOT_VIEWPORT, ignore_https_errors=True,
            user_agent=scanner_user_agent(browser, headless=not assisted),
            # Harmless on every other site — only an ngrok-tunneled dev URL checks
            # for this header, to skip its free-tier browser-warning interstitial.
            extra_http_headers={"ngrok-skip-browser-warning": "true"},
        )
        page = context.new_page()
        # Chromium's HTTP disk cache persists across separate launch() calls
        # on this machine (confirmed live 2026-10-05: a test-app URL scanned
        # repeatedly while its content was being iterated on kept returning
        # the *first* version scanned, even after the real page had changed
        # and a plain curl of the same URL showed the new content) — a scan
        # is supposed to reflect the page as it is right now, so the cache
        # must be disabled, not just bypassed with a one-off cache-busting
        # query param that every caller would otherwise need to remember.
        page.context.new_cdp_session(page).send("Network.setCacheDisabled", {"cacheDisabled": True})
        response = None
        try:
            response = page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except PlaywrightTimeoutError:
            pass
        # Allow JS-rendered content (SPAs, lazy-loaded regions) to settle before axe runs.
        # Was 1000ms — confirmed live 2026-10-07 that heavy, carousel-filled sites
        # (e.g. a commerce homepage with a Swiper carousel per product category)
        # were still actively mounting sections at the 1s mark, so the exact same
        # URL scanned seconds apart swung from 0 violations (almost nothing mounted
        # yet) to 40 (most of it mounted) — axe DevTools doesn't have this problem
        # because it scans a tab a person already has sitting open and settled, not
        # a fresh page load. 3000ms gets our fresh-load scan much closer to that
        # same "already settled" state without reintroducing the old 5s-per-shot
        # screenshot slowness this was never about.
        #
        # Tried (2026-10-09): polling the DOM's size until it stops growing,
        # instead of a fixed wait, hoping to adapt to each page's real load
        # time. Made this specific page WORSE (0, 0, 6 across three runs,
        # vs. the fixed wait's 6-38) — some third-party scripts (ad/analytics
        # beacons) keep mutating the DOM continuously and never let it go
        # quiet, so the poll just timed out early with less loaded than the
        # plain fixed wait caught. Reverted — a fixed wait is a known,
        # predictable quantity; "wait for quiet" isn't reliable on a page
        # that's never actually quiet.
        page.wait_for_timeout(3000)
        blocked = bot_challenge_reason(response.status if response else None, *page_title_and_html(page))
        if blocked and assisted:
            blocked = None if wait_for_person_to_verify(page) else (
                f"The site's verification wasn't completed in the browser window within "
                f"{ASSISTED_VERIFY_SECONDS // 60} minutes, so the scan stopped. Run it again and complete "
                "the check in the window that opens.")
        if blocked:
            raise RuntimeError(blocked)
        # Was wcag2a/wcag2aa only — silently excluded every WCAG 2.1-specific
        # rule (confirmed live 2026-10-05: axe DevTools found autocomplete-valid,
        # a wcag21aa rule, on a page where this tool found nothing for it,
        # since that tag was never requested at all). axe DevTools' own
        # default rule selection is WCAG 2.0 A/AA + WCAG 2.1 A/AA (+ Best
        # Practices if enabled there too) — matching that exactly here is
        # what "same as axe DevTools" means, not just adding the one rule
        # that happened to get noticed.
        # wcag22aa deliberately excluded: axe DevTools defaults to WCAG 2.1 AA, and
        # including it added extra target-size findings QA couldn't reconcile (85 vs 82).
        wcag_tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
        if include_best_practices:
            try:
                results = axe.run(page, options={"runOnly": {"type": "tag", "values": wcag_tags + ["best-practice"]}})
            except TypeError:
                results = axe.run(page)
        else:
            try:
                results = axe.run(page, options={"runOnly": {"type": "tag", "values": wcag_tags}})
            except TypeError:
                results = axe.run(page)

        # Full-page screenshot so user can scroll to see entire page in modal.
        # Best-effort only: axe has already run by this point, so a slow/hung
        # page (e.g. a web font that never finishes loading) failing THIS step
        # must not throw away real, already-captured violation data — that
        # was turning a successful scan into a hard "Scan failed" for the user.
        #
        # timeout was 5000ms — confirmed 2026-09-28 that Playwright's internal
        # "waiting for fonts to load" screenshot step hangs to the full
        # timeout 100% of the time on this environment, even on a page with
        # no custom fonts at all (a genuine Playwright/Chromium bug, not slow
        # loading — every retry took exactly 5.0Xs, never less). With up to
        # 10 more of these below (one per violation screenshot), that was up
        # to ~55s of pure dead time per scan — most of the "scan takes too
        # long" complaint. Cut to 2000ms: still generous for a screenshot
        # that's genuinely just slow elsewhere, but recovers the bulk of the
        # wasted time here where it never succeeds anyway.
        # A timeout here specifically (not some other failure) means this
        # browser/page combination can't produce a screenshot at all right
        # now — every one of the up to MAX_VIOLATION_SCREENSHOTS attempts
        # below would almost certainly hang the exact same way (same root
        # cause), so skip them entirely instead of paying the timeout that
        # many more times for something that's already shown it won't work.
        screenshots_disabled = False
        try:
            full_screenshot_bytes = page.screenshot(type="jpeg", quality=SCREENSHOT_JPEG_QUALITY, full_page=True, timeout=2000)
        except PlaywrightTimeoutError:
            full_screenshot_bytes = None
            screenshots_disabled = True
        except Exception:
            full_screenshot_bytes = None

        # Per-violation screenshots: highlighted viewport capture for the first MAX_VIOLATION_SCREENSHOTS
        # violations only. Viewport (not full_page) is 5–10× faster; the overview screenshot above
        # already provides the full-page view. Only the primary node per rule is captured.
        data = results.response if hasattr(results, "response") and results.response else {}
        if not include_best_practices:
            data = _remove_best_practice_rules(data)
        violations = data.get("violations") or []
        for i, violation in enumerate(violations):
            if screenshots_disabled or i >= MAX_VIOLATION_SCREENSHOTS:
                break
            nodes = violation.get("nodes") or []
            if not nodes:
                continue
            node = nodes[0]
            target = node.get("target")
            sel = _selector_from_node_target(target)
            if not sel:
                continue
            try:
                loc = page.locator(sel).first
                loc.scroll_into_view_if_needed(timeout=3000)
                # Strong visible highlight so the element stands out in the screenshot
                loc.evaluate(
                    """el => {
                    el.style.setProperty('outline', '5px solid #dc2626');
                    el.style.setProperty('outline-offset', '3px');
                    el.style.setProperty('box-shadow', '0 0 0 6px rgba(220, 38, 38, 0.6)');
                    // Only force 'relative' when the element has no positioning of its
                    // own (position: static) — z-index is a no-op there otherwise.
                    // Elements that are already fixed/absolute/sticky/relative must be
                    // left alone, since overriding e.g. 'fixed' with 'relative' rips the
                    // element out of its viewport-anchored spot (common for floating
                    // widgets like chat launchers) and the "highlight" ends up hiding it.
                    if (window.getComputedStyle(el).position === 'static') {
                        el.style.setProperty('position', 'relative');
                    }
                    el.style.setProperty('z-index', '999999');
                }"""
                )
                # Same 2000ms as the full-page screenshot above — see that comment.
                shot_bytes = page.screenshot(type="jpeg", quality=SCREENSHOT_JPEG_QUALITY, full_page=False, timeout=2000)
                shot_b64 = base64.b64encode(shot_bytes).decode("ascii")
                # Backwards-compatible violation-level screenshot for existing UI paths
                violation["screenshot"] = shot_b64
                violation["screenshotType"] = "image/jpeg"
                # Node-level screenshot for inspect button (primary node only for performance)
                node["screenshot"] = shot_b64
                node["screenshotType"] = "image/jpeg"
                loc.evaluate(
                    """el => {
                    el.style.removeProperty('outline');
                    el.style.removeProperty('outline-offset');
                    el.style.removeProperty('box-shadow');
                    el.style.removeProperty('position');
                    el.style.removeProperty('z-index');
                }"""
                )
            except PlaywrightTimeoutError:
                # Same reasoning as the full-page screenshot above — if this
                # one hung, the rest almost certainly will too.
                screenshots_disabled = True
            except Exception:
                pass  # skip if selector fails or element not found
        context.close()
        browser.close()

    if not isinstance(data, dict):
        data = {}
    data["url"] = url
    if "timestamp" not in data:
        data["timestamp"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    if full_screenshot_bytes:
        data["screenshot"] = base64.b64encode(full_screenshot_bytes).decode("ascii")
        data["screenshotType"] = "image/jpeg"
    return data


def main():
    url = (sys.argv[1] or "").strip()
    if not url:
        print("Usage: python run_ada_check_python.py <url>", file=sys.stderr)
        sys.exit(1)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    try:
        results = run_axe_playwright(url)
    except Exception as e:
        print(f"ADA check failed: {e}", file=sys.stderr)
        raise

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(str(OUTPUT_JSON))


if __name__ == "__main__":
    main()
