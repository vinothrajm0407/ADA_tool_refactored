"""normalize_url: one page, one key — so a crawl never scans (or counts) the same page twice."""
from services.crawler import normalize_url


def test_index_page_is_the_same_as_its_folder():
    base = "https://site.io/ADA-Test/"
    assert normalize_url(base) == normalize_url(base + "index.html") == normalize_url(base + "INDEX.HTM")
    assert normalize_url("https://site.io/index.html") == normalize_url("https://site.io/") == "https://site.io/"
    assert normalize_url("https://site.io/docs/index.html#top") == normalize_url("https://site.io/docs")


def test_other_pages_stay_distinct():
    assert normalize_url("https://site.io/about.html") != normalize_url("https://site.io/")
    assert normalize_url("https://site.io/myindex.html") != normalize_url("https://site.io/")
    assert normalize_url("https://site.io/index.php") != normalize_url("https://site.io/")      # dynamic: may differ
    assert normalize_url("https://site.io/list?page=2") != normalize_url("https://site.io/list?page=1")
