"""
URL normalization, link extraction, and domain-safety utilities for the crawler.
All functions are pure / stateless — no Playwright or DB imports at module level.
"""
import re
from pathlib import PurePosixPath
from urllib.parse import urlparse, urlunparse, urljoin

# File extensions that are never web pages — skip them during crawl.
SKIP_EXTENSIONS: frozenset[str] = frozenset({
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv",
    ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".css", ".js", ".json", ".xml", ".rss", ".atom",
    ".exe", ".dmg", ".pkg", ".deb", ".rpm",
})


def get_root_domain(url: str) -> str:
    """Return the lowercased netloc (host + optional port) of a URL."""
    return urlparse(url.strip()).netloc.lower()


_INDEX_PAGE = re.compile(r"/index\.html?$", re.I)


def normalize_url(url: str) -> str:
    """
    Normalize a URL for deduplication.
    - Lowercases scheme and host
    - Removes the fragment (#section) — fragments are client-side only
    - Strips trailing slash from path (except bare root path '/')
    - Drops a trailing index.html / index.htm: /docs/ and /docs/index.html are
      the same page on static hosts, and counting both doubled the page
    - Preserves query string — ?page=1 and ?page=2 are distinct pages
    """
    url = url.strip()
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    path = _INDEX_PAGE.sub("", parsed.path).rstrip("/") or "/"
    # Reconstruct without fragment
    return urlunparse((scheme, netloc, path, parsed.params, parsed.query, ""))


def is_internal_link(href: str, root_domain: str) -> bool:
    """Return True only if href has the exact same netloc as root_domain."""
    try:
        parsed = urlparse(href)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    return parsed.netloc.lower() == root_domain


def in_scope(href: str, root_url: str) -> bool:
    """True if href sits under the start URL's folder. A crawl of
    https://x.github.io/Project/ must not wander to https://x.github.io/settings:
    that is another site on the same host, with no connected repo.
    ponytail: the folder is the start URL's own ("/Project" without a slash
    scopes to "/"), so a project site should be started with its trailing slash."""
    scope = urlparse(urljoin(root_url, ".")).path
    return (urlparse(href).path or "/").startswith(scope) or urlparse(href).path + "/" == scope


def should_skip_url(href: str) -> bool:
    """
    Return True if this URL should never be crawled:
    - Non-web scheme (mailto, tel, javascript, data, blob)
    - Binary/asset file extension
    """
    href = href.strip()
    # Quick scheme check before parsing
    for prefix in ("mailto:", "tel:", "javascript:", "data:", "blob:", "ftp:", "ftps:"):
        if href.lower().startswith(prefix):
            return True
    try:
        parsed = urlparse(href)
    except Exception:
        return True
    # Check file extension on path component
    suffix = PurePosixPath(parsed.path).suffix.lower()
    return suffix in SKIP_EXTENSIONS


def extract_internal_links(page, root_url: str, root_domain: str) -> list[str]:
    """
    Extract all internal anchor hrefs from an already-loaded Playwright page.
    Returns a list of absolute URLs that belong to the same domain.
    Skips assets, binary files, and non-web schemes.

    Args:
        page: A Playwright Page object (already navigated).
        root_url: The root URL of the crawl (used as base for relative resolution).
        root_domain: Lowercased netloc of the root URL.
    """
    try:
        hrefs = page.evaluate(
            "() => Array.from(document.querySelectorAll('a[href]'))"
            "       .map(a => a.getAttribute('href'))"
            "       .filter(h => h && h.trim().length > 0)"
        )
    except Exception:
        return []

    seen: set[str] = set()
    links: list[str] = []

    for raw in hrefs:
        if not raw:
            continue
        raw = raw.strip()

        # Resolve relative URLs against the root URL
        try:
            absolute = urljoin(root_url, raw)
        except Exception:
            continue

        if should_skip_url(absolute):
            continue

        if not is_internal_link(absolute, root_domain):
            continue

        normalized = normalize_url(absolute)
        if normalized in seen:
            continue
        seen.add(normalized)
        links.append(absolute)

    return links
