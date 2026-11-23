from backend.services.auto_fix_service import ALREADY_FIXED, _fix_list_children, _ws_flexible, locate_source

PAGE = (
    "<html>\r\n<body>\r\n<div class=\"card\"><ul>\r\n  <li>Alpha</li>\r\n</ul></div>\r\n"
    "<div class=\"card\"><ul>\r\n  <li>Kickoff scheduled</li>\r\n"
    "  <div class=\"note\">Standalone <b>note</b></div>\r\n</ul></div>\r\n</body></html>"
)
AXE_HTML = '<ul>\n  <li>Kickoff scheduled</li>\n  <div class="note">Standalone <b>note</b></div>\n</ul>'


def test_whitespace_flexible_matches_crlf_and_no_whitespace():
    assert _ws_flexible("<ul>\n <li>a b</li>").search("<ul>\r\n\t<li>a\r\nb</li>")
    assert _ws_flexible("<ul>\n <li>x</li>").search("<ul><li>x</li>")
    assert not _ws_flexible("<li>a b</li>").search("<li>ab</li>")


def test_container_without_id_or_class_is_located_by_its_content(tmp_path):
    """Two bare <ul>s: only the element's full HTML says which one (CRLF checkout)."""
    (tmp_path / "index.html").write_bytes(PAGE.encode())
    assert locate_source(tmp_path, AXE_HTML, "list", [".card:nth-child(2) > ul"]) == ("index.html", 6)


def test_list_fix_turns_direct_non_li_children_into_li():
    text = PAGE.replace("\r\n", "\n")
    patch = _fix_list_children(text, 6)
    assert '<li class="note">Standalone <b>note</b></li>' in patch["after"]
    assert "<li>Kickoff scheduled</li>" in patch["after"] and "<b>note</b>" in patch["after"]  # nested tags untouched
    assert text.replace(patch["before"], patch["after"], 1).count("<div") == 2  # only the list child changed
    assert _fix_list_children("<ul>\n<li>a</li><script></script>\n</ul>", 1) is ALREADY_FIXED


def test_definition_list_stray_child_becomes_dd():
    from backend.services.auto_fix_service import generate_patch
    text = "<dl>\n  <dt>Sprint</dt>\n  <dd>14</dd>\n  <p>Stray</p>\n</dl>"
    patch = generate_patch({"id": "definition-list"}, {"html": text}, text, 1)
    assert patch["after"] == "<dl>\n  <dt>Sprint</dt>\n  <dd>14</dd>\n  <dd>Stray</dd>\n</dl>"


def test_object_alt_named_after_its_file():
    from backend.services.auto_fix_service import generate_patch
    text = '<p>x</p>\n<object data="/img/sales-chart.svg" type="image/svg+xml"></object>'
    patch = generate_patch({"id": "object-alt"}, {"html": '<object data="/img/sales-chart.svg">'}, text, 2)
    assert patch["after"] == '<object data="/img/sales-chart.svg" type="image/svg+xml" aria-label="Sales Chart">'
    named = '<object data="a.svg" title="A"></object>'
    assert generate_patch({"id": "object-alt"}, {"html": named}, named, 1) is ALREADY_FIXED
