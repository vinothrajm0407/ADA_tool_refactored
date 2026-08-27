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
        context = browser.new_context(viewport=SCREENSHOT_VIEWPORT, ignore_https_errors=True)
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except PlaywrightTimeoutError:
            pass
        # Allow JS-rendered content (SPAs, lazy-loaded regions) to settle before axe runs.
        page.wait_for_timeout(1000)
        if include_best_practices:
            try:
                results = axe.run(page, options={"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "best-practice"]}})
            except TypeError:
                results = axe.run(page)
        else:
            try:
                results = axe.run(page, options={"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa"]}})
            except TypeError:
                results = axe.run(page)

        # Full-page screenshot so user can scroll to see entire page in modal
        full_screenshot_bytes = page.screenshot(type="jpeg", quality=SCREENSHOT_JPEG_QUALITY, full_page=True)

        # Per-violation screenshots: highlighted viewport capture for the first MAX_VIOLATION_SCREENSHOTS
        # violations only. Viewport (not full_page) is 5–10× faster; the overview screenshot above
        # already provides the full-page view. Only the primary node per rule is captured.
        data = results.response if hasattr(results, "response") and results.response else {}
        if not include_best_practices:
            data = _remove_best_practice_rules(data)
        violations = data.get("violations") or []
        for i, violation in enumerate(violations):
            if i >= MAX_VIOLATION_SCREENSHOTS:
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
                shot_bytes = page.screenshot(type="jpeg", quality=SCREENSHOT_JPEG_QUALITY, full_page=False)
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
            except Exception:
                pass  # skip if selector fails or element not found
        context.close()
        browser.close()

    if not isinstance(data, dict):
        data = {}
    data["url"] = url
    if "timestamp" not in data:
        data["timestamp"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
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
