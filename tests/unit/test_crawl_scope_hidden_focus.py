from backend.services.auto_fix_service import _fallback_patch
from services.crawler import in_scope

ROOT = "https://x.github.io/ADA-AutoFix-Test-GitHub-2/"


def test_crawl_stays_in_project_folder():
    assert in_scope(ROOT, ROOT)
    assert in_scope("https://x.github.io/ADA-AutoFix-Test-GitHub-2", ROOT)
    assert in_scope("https://x.github.io/ADA-AutoFix-Test-GitHub-2/profile.html", ROOT)
    assert not in_scope("https://x.github.io/settings", ROOT)
    assert not in_scope("https://x.github.io/", ROOT)
    assert not in_scope("https://x.github.io/ADA-AutoFix-Test-GitHub-3/", ROOT)
    # a site at the host root is unrestricted
    assert in_scope("https://shop.com/about", "https://shop.com/")
    assert in_scope("https://shop.com/about", "https://shop.com/home")


def test_aria_hidden_focus_patches_the_button_not_the_hidden_div():
    src = '<p>x</p>\n<div aria-hidden="true" class="visually-tiny"><button>Hidden but still focusable</button></div>\n'
    node = {"html": '<div aria-hidden="true" class="visually-tiny"><button>Hidden but still focusable</button></div>'}
    patch = _fallback_patch({"id": "aria-hidden-focus"}, node, src, 2)
    assert '<button tabindex="-1">' in patch["after"]
    assert '<div aria-hidden="true" class="visually-tiny" tabindex' not in patch["after"]


def test_page_summary_counts_impact_elements_and_fixable():
    from backend.services.crawl_service import page_summary
    payload = {"axeResult": {"violations": [
        {"id": "image-alt", "impact": "critical", "nodes": [{"html": "<img>"}, {"html": "<img>"}]},
        {"id": "color-contrast", "impact": "serious", "nodes": [{"html": "<a>"}]},
        {"id": "document-title", "impact": "serious", "nodes": [{"html": ""}]},  # page-wide: needs AI
    ]}}
    s = page_summary(payload, ai=False, fallback_rules={"image-alt", "document-title"})
    assert s == {"critical": 1, "serious": 2, "moderate": 0, "minor": 0, "elements": 4, "fixable": 1}
    assert page_summary(payload, ai=True, fallback_rules=set())["fixable"] == 2
