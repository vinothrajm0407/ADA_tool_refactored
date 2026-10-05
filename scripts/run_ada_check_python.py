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

# Viewport for consistent screenshots; JPEG quality to keep payload size reasonable
SCREENSHOT_VIEWPORT = {"width": 1280, "height": 800}
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


def run_axe_playwright(url: str, include_best_practices: bool = False) -> dict:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    from axe_playwright_python.sync_playwright import Axe

    axe = Axe()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport=SCREENSHOT_VIEWPORT, ignore_https_errors=True,
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
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except PlaywrightTimeoutError:
            pass
        # Allow JS-rendered content (SPAs, lazy-loaded regions) to settle before axe runs.
        page.wait_for_timeout(1000)
        # Was wcag2a/wcag2aa only — silently excluded every WCAG 2.1-specific
        # rule (confirmed live 2026-10-05: axe DevTools found autocomplete-valid,
        # a wcag21aa rule, on a page where this tool found nothing for it,
        # since that tag was never requested at all). axe DevTools' own
        # default rule selection is WCAG 2.0 A/AA + WCAG 2.1 A/AA (+ Best
        # Practices if enabled there too) — matching that exactly here is
        # what "same as axe DevTools" means, not just adding the one rule
        # that happened to get noticed.
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
