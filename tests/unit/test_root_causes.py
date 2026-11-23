"""Fix at the source: grouping one problem seen on many crawled pages into one root cause."""
from backend.services import root_causes as rc
from backend.services.auto_fix_service import pages_verified_markdown
from services.db import _repo_prefix

BTN = '<button class="icon-btn"><svg></svg></button>'


def _page(url, *violations):
    return (url, {"axeResult": {"violations": list(violations)}})


def _v(rule, *htmls, impact="critical"):
    return {"id": rule, "help": f"{rule} help", "impact": impact, "tags": ["wcag412"],
            "nodes": [{"html": h, "target": [".x"]} for h in htmls]}


def test_same_markup_on_many_pages_is_one_root_cause():
    rows = [_page(f"https://s/p{i}", _v("button-name", BTN)) for i in range(5)]
    rows.append(_page("https://s/only", _v("image-alt", "<img src=a.png>")))  # one page: not shared
    groups = rc.group_root_causes(rows)
    assert len(groups) == 1
    g = groups[0]
    assert (g["rule_id"], g["page_count"], g["occurrences"]) == ("button-name", 5, 5)
    assert g["sample"]["page_url"] == "https://s/p0"
    assert g["pages"][0]["signature"] == rc.node_signature(BTN)


def test_folder_and_its_index_html_are_one_page():
    rows = [_page("https://s/docs/", _v("label", "<input>")), _page("https://s/docs/index.html", _v("label", "<input>"))]
    assert rc.group_root_causes(rows) == []          # one page, so nothing repeats across pages
    rows.append(_page("https://s/about.html", _v("label", "<input>")))
    assert rc.group_root_causes(rows)[0]["page_count"] == 2


def test_generated_ids_and_whitespace_do_not_split_a_component():
    a = '<input id="ember12" class="search">'
    b = '<input  id="ember977"\n class="search">'
    assert rc.markup_key(a) == rc.markup_key(b)
    assert rc.markup_key('<link href="/app.css?v=123">') == rc.markup_key('<link href="/app.css?v=999">')
    assert rc.markup_key('<input id="search">') != rc.markup_key('<input id="email">')  # real ids stay
    assert rc.markup_key('<input id="q1">') != rc.markup_key('<input id="q2">')        # hand-written, numbered: different fields
    assert rc.markup_key('<nav id="nav-facade">') != rc.markup_key('<nav id="nav-decade">')  # words, not hashes
    for a, b in (('<div id=":r3:">', '<div id=":r9:">'), ('<b id="radix-:R1:">', '<b id="radix-:R7:">'),
                 ('<i aria-labelledby="mui-12 mui-13">', '<i aria-labelledby="mui-40 mui-41">'),
                 ('<p id="card-9f8e7d6c">', '<p id="card-a1b2c3d4">')):
        assert rc.markup_key(a) == rc.markup_key(b), a


def test_sorted_by_pages_then_severity_and_page_wide_skipped():
    rows = [_page("https://s/a", _v("color-contrast", "<p>x</p>", impact="serious"), _v("html-has-lang", "<html>")),
            _page("https://s/b", _v("color-contrast", "<p>x</p>", impact="serious"), _v("html-has-lang", "<html>"),
                  _v("link-name", "<a href=/></a>")),
            _page("https://s/c", _v("color-contrast", "<p>x</p>", impact="serious"), _v("link-name", "<a href=/></a>"))]
    assert [g["rule_id"] for g in rc.group_root_causes(rows)] == ["color-contrast", "link-name"]


def test_verification_sample_spreads_across_pages_and_skips_the_sample():
    g = {"sample": {"page_url": "u0"}, "pages": [{"url": f"u{i}"} for i in range(21)]}
    sample = rc.verification_sample(g, 4)
    assert sample == ["u1", "u6", "u11", "u16"] and "u0" not in sample
    assert rc.verification_sample({"sample": {"page_url": "u0"}, "pages": [{"url": "u0"}, {"url": "u1"}]}, 4) == ["u1"]


def test_pr_section_counts_only_pages_actually_checked():
    md = pages_verified_markdown([{"url": "a", "fixed": True}, {"url": "b", "fixed": False},
                                  {"url": "c", "fixed": None, "note": "not served"}], 340)
    assert "340 pages" in md and "1 of 2 clean" in md and "not checked" in md


def test_patch_dedup_matches_every_pr_of_the_repo():
    assert _repo_prefix("https://github.com/acme/my_site.git/") == "https://github.com/acme/my[_]site/%"
