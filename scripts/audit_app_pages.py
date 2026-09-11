#!/usr/bin/env python3
"""
Self-audit: run the project's own accessibility checker (axe-core via Playwright,
same axe_playwright_python lib as scripts/run_ada_check_python.py) against this
app's own local dev-server pages, authenticated as the real test account.

No GitHub/Auto-Fix pipeline involved — this only produces a JSON report for
manual review, matching the "direct axe scan, fix source directly" approach.

Usage: python scripts/audit_app_pages.py [--out output/self_audit_baseline.json]
"""
import json
import sys
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_URL = "http://127.0.0.1:5000"
FRONTEND_URL = "http://localhost:5175"
TEST_EMAIL = "vinothrajm@unitedtechno.com"
TEST_PASSWORD = "Testing@123"

# (label, path, requires_auth)
PAGES = [
    ("Landing",           "/",                 False),
    ("Login",             "/login",            False),
    ("Dashboard",         "/dashboard",        True),
    ("Run Audit",         "/new-scan",         True),
    ("Scan History",      "/scan-history",     True),
    ("Schedules",         "/crawl-schedules",  True),
    ("Notifications",     "/alerts",           True),
    ("Assistive Testing", "/assistive-test",   True),
    ("WCAG Reference",    "/wcag-reference",   True),
    ("Channels & Apps",   "/integrations",     True),
    ("Settings",          "/settings",         True),
]

AXE_OPTIONS = {"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa"]}}


def login():
    data = json.dumps({"email": TEST_EMAIL, "password": TEST_PASSWORD}).encode()
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/auth/login", data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read())
    if not body.get("ok"):
        raise RuntimeError(f"Login failed: {body}")
    return body["user"], body["token"]


def run(themes=("light", "dark")):
    from playwright.sync_api import sync_playwright
    from axe_playwright_python.sync_playwright import Axe

    user, token = login()
    auth_payload = json.dumps({"user": user, "token": token})

    axe = Axe()
    results = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        for theme in themes:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            # ada-tool-theme is the real localStorage key AppContext.jsx reads on
            # boot — same persistence mechanism a real user's theme toggle uses.
            ctx.add_init_script(
                f'window.sessionStorage.setItem("ada_auth", JSON.stringify({auth_payload}));'
                f'window.localStorage.setItem("ada-tool-theme", "{theme}");'
            )
            page = ctx.new_page()

            # Connected Repos has no direct URL — reach it via sidebar nav from Dashboard.
            page.goto(f"{FRONTEND_URL}/dashboard", wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(500)
            try:
                page.get_by_role("button", name="Connected Repos").click()
                page.wait_for_timeout(500)
                axe_result = axe.run(page, options=AXE_OPTIONS)
                data = axe_result.response if hasattr(axe_result, "response") else {}
                results.append(_summarize(f"Connected Repos [{theme}]", "/repo-links (via sidebar)", data))
            except Exception as e:
                results.append({"page": f"Connected Repos [{theme}]", "path": "/repo-links (via sidebar)", "error": str(e)})

            for label, path, needs_auth in PAGES:
                url = f"{FRONTEND_URL}{path}"
                tagged_label = f"{label} [{theme}]"
                try:
                    page.goto(url, wait_until="networkidle", timeout=30000)
                    page.wait_for_timeout(600)
                    axe_result = axe.run(page, options=AXE_OPTIONS)
                    data = axe_result.response if hasattr(axe_result, "response") else {}
                    results.append(_summarize(tagged_label, path, data))
                    print(f"scanned {tagged_label:30s} {path}")
                except Exception as e:
                    results.append({"page": tagged_label, "path": path, "error": str(e)})
                    print(f"FAILED  {tagged_label:30s} {path}: {e}")

            ctx.close()

        browser.close()

    return results


def _summarize(label, path, axe_data):
    violations = axe_data.get("violations", []) if isinstance(axe_data, dict) else []
    by_impact = {}
    rules = []
    for v in violations:
        impact = v.get("impact") or "unknown"
        node_count = len(v.get("nodes", []))
        by_impact[impact] = by_impact.get(impact, 0) + node_count
        rules.append({
            "id": v.get("id"),
            "impact": impact,
            "help": v.get("help"),
            "nodes": node_count,
            "targets": [n.get("target") for n in v.get("nodes", [])[:5]],
        })
    return {
        "page": label,
        "path": path,
        "violation_rule_count": len(violations),
        "violation_node_count": sum(by_impact.values()),
        "by_impact": by_impact,
        "rules": rules,
    }


def main():
    out_path = PROJECT_ROOT / "output" / "self_audit_baseline.json"
    if len(sys.argv) > 2 and sys.argv[1] == "--out":
        out_path = Path(sys.argv[2])

    results = run()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, indent=2))

    total_rules = sum(r.get("violation_rule_count", 0) for r in results)
    total_nodes = sum(r.get("violation_node_count", 0) for r in results)
    print(f"\nSaved: {out_path}")
    print(f"Total: {total_rules} distinct violated rules, {total_nodes} violating nodes across {len(results)} pages\n")
    for r in results:
        if "error" in r:
            print(f"  {r['page']:20s} ERROR: {r['error']}")
        else:
            impact_str = ", ".join(f"{k}={v}" for k, v in sorted(r["by_impact"].items()))
            print(f"  {r['page']:20s} {r['violation_rule_count']:2d} rules  ({impact_str or 'none'})")


if __name__ == "__main__":
    main()
