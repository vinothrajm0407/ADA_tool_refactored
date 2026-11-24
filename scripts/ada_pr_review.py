"""GitHub Action entrypoint: scan URL(s) with the ADA backend, post the issues
as one "ADA Accessibility Review" comment on the pull request, and fail the
check if an issue at or above the severity threshold is found. Stdlib only, so
it runs on any runner with python3.

Inputs come from env (set by action.yml): ADA_API_URL, ADA_API_KEY, ADA_URLS,
ADA_BASELINE_URLS, ADA_FAIL_ON, ADA_INCLUDE_BEST_PRACTICES, GITHUB_TOKEN + the
standard GITHUB_* vars.

Stop new problems: with ADA_BASELINE_URLS (the same pages on the live site),
each page is scanned on both and only issues the PR adds can fail the check.
Old issues are listed as "already on the live site" and fixed over time.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urlunsplit

MARKER = "<!-- ada-accessibility-review -->"
SEVERITIES = ["minor", "moderate", "serious", "critical"]
MAX_ROWS = 25  # per URL; a PR comment caps at 65k characters


def _request(method, url, token, body=None, accept="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": accept,
        "User-Agent": "ada-accessibility-action"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read() or b"null")


def scan(api_url, api_key, url, best_practices, timeout=600):
    """Queue a scan, poll until done, return the scan result dict."""
    for _ in range(10):  # the backend rate-limits scans per caller
        try:
            job = _request("POST", f"{api_url}/api/scan", api_key,
                           {"url": url, "includeBestPractices": best_practices})
            break
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise RuntimeError(f"{e.code}: {e.read().decode(errors='replace')[:300]}") from None
            time.sleep(int(e.headers.get("Retry-After") or 10))
    else:
        raise RuntimeError("the ADA server kept answering 429 (too many scans)")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(5)
        status = _request("GET", f"{api_url}/api/scan/{job['jobId']}", api_key)["job"]
        if status["status"] == "completed":
            return status["result"]
        if status["status"] == "failed":
            raise RuntimeError(status.get("error") or "scan failed")
    raise RuntimeError(f"scan not finished after {timeout}s")


def violations(result):
    return ((result or {}).get("axeResult") or {}).get("violations") or []


def element_key(node):
    """The same element on two deploys: its CSS path (axe `target`), else its markup.
    ponytail: a PR that moves elements around (nth-child shifts) can make an old
    issue look new; key on markup too if that turns out noisy."""
    target = node.get("target")
    if target:
        return " ".join(map(str, target)) if isinstance(target, list) else str(target)
    return " ".join((node.get("html") or "").split())


def split_new(result, baseline):
    """(new, old): `result` as two scan results, by whether the same rule already
    flags the same element on `baseline` (the live site)."""
    seen = {(v.get("id"), element_key(n)) for v in violations(baseline) for n in v.get("nodes") or []}
    new, old = [], []
    for v in violations(result):
        nodes = v.get("nodes") or []
        for bucket, keep in ((new, False), (old, True)):
            picked = [n for n in nodes if ((v.get("id"), element_key(n)) in seen) == keep]
            if picked:
                bucket.append({**v, "nodes": picked})
    return {"axeResult": {"violations": new}}, {"axeResult": {"violations": old}}


def baseline_urls(urls, baselines):
    """The live-site page to compare each scanned page with. Same count: pair them
    in order. One: the same path on that site. None: no comparison."""
    if not baselines:
        return [None] * len(urls)
    if len(baselines) == len(urls):
        return baselines
    if len(baselines) == 1:
        base = urlsplit(baselines[0])
        return [urlunsplit((base.scheme, base.netloc) + tuple(urlsplit(u))[2:]) for u in urls]
    raise ValueError(f"baseline-urls: give 1 site or {len(urls)} pages (one per url), not {len(baselines)}")


def worst_hit(results, fail_on):
    """True if any violation is at or above the fail_on severity ("none": never)."""
    if fail_on not in SEVERITIES:
        return False
    floor = SEVERITIES.index(fail_on)
    return any(SEVERITIES.index(v.get("impact") or "minor") >= floor
               for _, result, _ in results for v in violations(result))


def _table(found):
    rank = lambda v: -SEVERITIES.index(v.get("impact") or "minor")
    found = sorted(found, key=rank)
    lines = ["| Impact | Rule | Elements | Help |", "| --- | --- | --- | --- |"]
    for v in found[:MAX_ROWS]:
        lines.append(f"| {v.get('impact') or 'minor'} | `{v['id']}` | {len(v.get('nodes') or [])} "
                     f"| [{v.get('help', '').replace('|', '/')}]({v.get('helpUrl', '')}) |")
    if len(found) > MAX_ROWS:
        lines.append(f"\n_{len(found) - MAX_ROWS} more truncated, see the ADA dashboard for the full report._")
    return lines


def build_markdown(results, fail_on, failed, compared=None):
    """results: [(url, scan_result or None, error or None)] -> markdown comment body.
    compared: {url: (new, old)} from split_new, for pages checked against the live
    site; those list the PR's new issues, and the old ones as not blocking."""
    compared = compared or {}
    lines = [MARKER, "## ADA Accessibility Review", ""]
    if compared:
        added = sum(len(violations(n)) for n, _ in compared.values())
        lines.append(f"**{added} new issue(s) in this pull request.** Issues already on the live site don't block it."
                     if added else "**No new accessibility issues in this pull request.**")
    else:
        total = sum(len(violations(r)) for _, r, _ in results)
        lines.append(f"**{total} rule violation(s) across {len(results)} page(s).**" if total
                     else "**No accessibility violations found.**")
    if failed:
        lines.append(f"\n:x: Check fails: {'new ' if compared else ''}violations at **{fail_on}** or above.")
    for url, result, error in results:
        lines += ["", f"### {url}", ""]
        if error:
            lines.append(f":warning: Could not scan: {error}")
            continue
        if url in compared:
            new, old = (violations(r) for r in compared[url])
            lines += (["**New in this PR**", ""] + _table(new)) if new else [":white_check_mark: No new issues."]
            if old:
                lines += ["", f"<details><summary>{len(old)} issue(s) already on the live site (not blocking)</summary>", ""]
                lines += _table(old) + ["", "</details>"]
            continue
        found = violations(result)
        lines += _table(found) if found else ["No violations."]
    return "\n".join(lines) + "\n"


def post_comment(body):
    """Create the ADA comment on the PR, or update the one from a previous run (no pile-up)."""
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    try:
        with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
            number = (json.load(f).get("pull_request") or {}).get("number")
    except (KeyError, OSError):
        number = None
    if not (token and repo and number):
        return  # not a pull request run: the job summary carries the report
    api = f"https://api.github.com/repos/{repo}/issues"
    try:
        comments = _request("GET", f"{api}/{number}/comments?per_page=100", token,
                            accept="application/vnd.github+json")
        mine = next((c for c in comments if MARKER in (c.get("body") or "")), None)
        if mine:
            _request("PATCH", f"{api}/comments/{mine['id']}", token, {"body": body}, "application/vnd.github+json")
        else:
            _request("POST", f"{api}/{number}/comments", token, {"body": body}, "application/vnd.github+json")
        print(f"Posted ADA review on PR #{number}")
    except urllib.error.HTTPError as e:
        print(f"::warning::Could not post PR comment ({e.code}). Grant `pull-requests: write` "
              "(not available on fork PRs).")


def main():
    api_url = os.environ["ADA_API_URL"].rstrip("/")
    api_key = os.environ["ADA_API_KEY"]
    urls = [u.strip() for u in os.environ["ADA_URLS"].replace(",", "\n").splitlines() if u.strip()]
    fail_on = (os.environ.get("ADA_FAIL_ON") or "serious").strip().lower()
    best = (os.environ.get("ADA_INCLUDE_BEST_PRACTICES") or "").lower() == "true"
    if not urls:
        sys.exit("::error::No URLs to scan: set the `urls` input")
    baselines = [u.strip() for u in (os.environ.get("ADA_BASELINE_URLS") or "").replace(",", "\n").splitlines() if u.strip()]
    try:
        bases = baseline_urls(urls, baselines)
    except ValueError as e:
        sys.exit(f"::error::{e}")

    results, compared = [], {}
    for url, base in zip(urls, bases):
        print(f"Scanning {url} ...")
        try:
            results.append((url, scan(api_url, api_key, url, best), None))
        except Exception as e:  # report it and keep scanning the rest
            print(f"::error::{url}: {e}")
            results.append((url, None, str(e)))
            continue
        if base:
            print(f"Scanning the live page {base} to tell new issues from old ...")
            try:
                compared[url] = split_new(results[-1][1], scan(api_url, api_key, base, best))
            except Exception as e:  # no comparison: every issue on this page counts, as without a baseline
                print(f"::warning::{base}: {e} — every issue on {url} counts for the check")

    # with a live-site comparison only the PR's new issues can fail the check
    blocking = [(u, compared[u][0] if u in compared else r, e) for u, r, e in results]
    failed = worst_hit(blocking, fail_on)
    body = build_markdown(results, fail_on, failed, compared)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as f:
            f.write(body)
    post_comment(body)
    if failed or any(error for _, _, error in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
