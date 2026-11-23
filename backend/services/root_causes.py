"""Fix at the source: trace one problem seen on many crawled pages back to the
one shared piece of markup (a header, a footer, a card component) causing it.

A crawl stores each page's axe result. The same element rendered by a shared
template has the same markup on every page, so grouping violations by
(rule, normalized markup) finds the shared components; the Auto-Fix
pipeline then locates and patches that markup once.
"""
import hashlib
import re

_WS = re.compile(r"\s+")
# Markup that changes per page but not per component: ids a framework
# generates at render time (ember123, react-aria-5, :r3:, radix-…, mui-12,
# long hashes) and cache-busting query strings. Hand-written ids like
# "q1" or "step2" are kept — they name different elements.
_GENERATED_ID = re.compile(
    r"^(ember\d+|:r[0-9a-z]+:|react-aria\d*-\d+|radix-[\w:-]+|mui-\d+|headlessui-[\w-]+-\d+|"
    r"[a-z]+-(?=[0-9a-f]*\d)[0-9a-f]{6,}|(?=[0-9a-f]*\d)[0-9a-f]{8,}|.*\d{4,})$", re.I)
_ID_ATTR = re.compile(r'\s(id|for|aria-controls|aria-labelledby|aria-describedby)="([^"]*)"')
_CACHE_BUST = re.compile(r'(\.(?:css|js|png|jpe?g|svg|webp|gif))\?[^"\']*')


def _drop_generated_id(m: re.Match) -> str:
    return "" if all(_GENERATED_ID.match(v) for v in m.group(2).split()) and m.group(2).strip() else m.group(0)
MAX_PAGES_STORED = 500  # ponytail: per root cause, enough for Fix History rows; raise for very large sites


def markup_key(html: str) -> str:
    """Same component, same key — even when the page gave it a different generated id."""
    s = _WS.sub(" ", html or "").strip()
    s = _ID_ATTR.sub(_drop_generated_id, s)
    return _CACHE_BUST.sub(r"\1", s)


def node_signature(html: str) -> str:
    """Matches app.py's per-element signature for Auto-Fix dedup (sha256 of the raw html)."""
    return hashlib.sha256((html or "").encode()).hexdigest()[:32]


def group_id(rule_id: str, key: str) -> str:
    return hashlib.sha256(f"{rule_id}\n{key}".encode()).hexdigest()[:16]


def group_root_causes(rows, min_pages: int = 2) -> list[dict]:
    """rows: [(page_url, axe_result_payload_dict)]. Returns root causes shared by at
    least `min_pages` pages, most pages first. Page-wide violations (no markup)
    are left out — they have no single element to trace."""
    groups: dict[str, dict] = {}
    for page_url, payload in rows:
        axe = (payload or {}).get("axeResult") or {}
        for v in axe.get("violations") or []:
            rule_id = v.get("id")
            if not rule_id:
                continue
            for node in v.get("nodes") or []:
                html = (node or {}).get("html") or ""
                key = markup_key(html)
                if not key or key.startswith("<html"):
                    continue
                gid = group_id(rule_id, key)
                g = groups.get(gid)
                if g is None:
                    g = groups[gid] = {
                        "id": gid, "rule_id": rule_id, "help": v.get("help"), "description": v.get("description"),
                        "impact": v.get("impact"), "tags": v.get("tags") or [], "help_url": v.get("helpUrl"),
                        "html": key, "target": node.get("target"), "occurrences": 0, "_pages": {},
                        # the first page seen is where Auto-Fix locates and verifies the fix
                        "sample": {"page_url": page_url, "node": node},
                    }
                g["occurrences"] += 1
                g["_pages"].setdefault(page_url, node_signature(html))
    out = []
    for g in groups.values():
        pages = g.pop("_pages")
        if len(pages) < min_pages:
            continue
        g["page_count"] = len(pages)
        g["pages"] = [{"url": u, "signature": s} for u, s in list(pages.items())[:MAX_PAGES_STORED]]
        out.append(g)
    impact_rank = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
    out.sort(key=lambda g: (-g["page_count"], impact_rank.get(g["impact"] or "minor", 4), -g["occurrences"]))
    return out


def rule_for_fix(group: dict) -> dict:
    """The rule dict the Auto-Fix pipeline expects (same shape as a scan violation)."""
    return {"id": group["rule_id"], "help": group.get("help"), "description": group.get("description"),
            "impact": group.get("impact"), "tags": group.get("tags"), "helpUrl": group.get("help_url"),
            "nodes": [group["sample"]["node"]]}


def verification_sample(group: dict, size: int) -> list[str]:
    """Other affected pages to re-scan against the patched build, spread across the
    list rather than the first N (often one site section)."""
    urls = [p["url"] for p in group["pages"] if p["url"] != group["sample"]["page_url"]]
    if len(urls) <= size:
        return urls
    step = len(urls) / size
    return [urls[int(i * step)] for i in range(size)]
